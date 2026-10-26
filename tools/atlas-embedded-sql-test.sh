#!/usr/bin/env bash
# 0024 (Embedded Signup + coexistence yankısı) migration sınaması — geçici Postgres 17 (Docker), ağ yok.
#
#   bash tools/atlas-embedded-sql-test.sh
#
# Önce 0020 uygulanır (tetikleyici + gelen RPC). Sınananlar: mode/account_id
# sütunları, giden tetikleyicinin yankıyı (external_id dolu) yeniden GÖNDERMEMESİ,
# atlas_channel_echo (müşteri bulma/açma, insana devretme, tekrar yazmama),
# yetkiler, idempotentlik, geri alma.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=atlas-pg-embedded-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=t postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
P="docker exec -i $NAME psql -U postgres -q -v ON_ERROR_STOP=1"

$P <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE SCHEMA net; CREATE TABLE net.calls (url text, body jsonb, headers jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (url, body, headers) RETURNING 1::bigint $$;
CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, slug text, whatsapp_number text);
CREATE TABLE users (id uuid PRIMARY KEY, organization_id uuid, role text);
CREATE TABLE services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid);
CREATE TABLE atlas_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, status text);
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL, phone text, wa_id text, consent_channel text, last_message_at timestamptz, created_at timestamptz DEFAULT now(),
  is_handled_by_human boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX customers_org_wa_idx ON customers (organization_id, wa_id) WHERE wa_id IS NOT NULL;
CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE, channel text NOT NULL, direction text NOT NULL, content text,
  is_from_customer boolean NOT NULL DEFAULT true, sender_type text NOT NULL DEFAULT 'customer', created_at timestamptz DEFAULT now(),
  CONSTRAINT messages_channel_legacy CHECK (channel IN ('whatsapp', 'web_widget')));
INSERT INTO organizations (id, name) VALUES ('00000000-0000-4000-a000-00000000000a', 'Klinik A'), ('00000000-0000-4000-a000-00000000000b', 'Klinik B');
INSERT INTO customers (id, organization_id, full_name, wa_id) VALUES ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-00000000000a', 'Eski Twilio', '905321112233');
INSERT INTO messages (organization_id, customer_id, channel, direction, content) VALUES ('00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-0000000000c1', 'web_widget', 'in', 'eski');
SQL

$P < supabase/migrations/0020_channels.sql

$P < supabase/migrations/0024_meta_embedded_signup.sql
$P < supabase/migrations/0024_meta_embedded_signup.sql   # iki kez

$P <<'SQL'
\set A '00000000-0000-4000-a000-00000000000a'
\set B '00000000-0000-4000-a000-00000000000b'
CREATE TEMP TABLE r (ad text, ok boolean);
GRANT ALL ON r TO service_role;
INSERT INTO channel_connections (organization_id, channel, status, external_id, webhook_secret) VALUES (:'A', 'whatsapp', 'connected', '1099887766', 'x');
INSERT INTO r SELECT 'mode varsayılanı manual', (SELECT mode = 'manual' FROM channel_connections);
UPDATE channel_connections SET mode = 'embedded', account_id = '102030405060';
INSERT INTO r SELECT 'embedded + WABA kimliği yazılır', (SELECT mode = 'embedded' AND account_id = '102030405060' FROM channel_connections);
DO $$ BEGIN
  UPDATE channel_connections SET mode = 'baska';
  INSERT INTO r VALUES ('geçersiz mod', false);
EXCEPTION WHEN check_violation THEN INSERT INTO r VALUES ('geçersiz mod reddedilir', true); END $$;

-- Gelen mesaj → müşteri; asistanın giden mesajı gönderilir
SELECT atlas_channel_inbound(:'A', 'whatsapp', '905551112233', 'Ayşe', 'Merhaba', 'wamid.IN1', now());
TRUNCATE net.calls;
INSERT INTO messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type)
  SELECT :'A', id, 'whatsapp', 'out', 'Merhaba Ayşe Hanım', false, 'ai' FROM customers WHERE external_id = '905551112233';
INSERT INTO r SELECT 'asistanın giden mesajı (external_id yok) gönderilir', (SELECT count(*) = 1 FROM net.calls);

-- Yankı: telefondan yazılan
TRUNCATE net.calls;
SET ROLE service_role;
INSERT INTO r SELECT 'yankı yazıldı', atlas_channel_echo(:'A', 'whatsapp', '905551112233', 'Yarın 14:00 uygun', 'wamid.ECHO1', now()) IS NOT NULL;
INSERT INTO r SELECT 'aynı yankı tekrar → yazılmadı', atlas_channel_echo(:'A', 'whatsapp', '905551112233', 'Yarın 14:00 uygun', 'wamid.ECHO1', now()) IS NULL;
RESET ROLE;
INSERT INTO r SELECT 'yankı yeniden GÖNDERİLMEZ (tetikleyici atladı)', (SELECT count(*) = 0 FROM net.calls);
INSERT INTO r SELECT 'yankı: giden, human, aynı müşteri', (SELECT count(*) = 1 FROM messages m JOIN customers c ON c.id = m.customer_id
  WHERE m.external_id = 'wamid.ECHO1' AND m.direction = 'out' AND m.sender_type = 'human' AND NOT m.is_from_customer AND c.external_id = '905551112233');
INSERT INTO r SELECT 'yankı: müşteri insana devredildi', (SELECT is_handled_by_human FROM customers WHERE external_id = '905551112233');
INSERT INTO r SELECT 'yankı: tek müşteri kaydı', (SELECT count(*) = 1 FROM customers WHERE organization_id = :'A' AND (external_id = '905551112233' OR wa_id = '905551112233'));

-- Daha önce hiç yazmamış kişiye telefondan ilk mesaj → müşteri açılır
SELECT atlas_channel_echo(:'A', 'whatsapp', '905559998877', 'Kampanyamız başladı', 'wamid.ECHO2', now());
INSERT INTO r SELECT 'yeni kişiye yankı: müşteri açılır (+telefon, wa_id)', (SELECT count(*) = 1 FROM customers WHERE organization_id = :'A' AND wa_id = '905559998877' AND phone = '+905559998877' AND is_handled_by_human);
-- Eski (Twilio) müşteri wa_id ile bulunur
SELECT atlas_channel_echo(:'A', 'whatsapp', '905321112233', 'Merhaba', 'wamid.ECHO3', now());
INSERT INTO r SELECT 'eski Twilio müşterisi yeniden kullanılır', (SELECT count(*) = 1 FROM customers WHERE organization_id = :'A' AND wa_id = '905321112233');
-- Kurum izolasyonu
SELECT atlas_channel_echo(:'B', 'whatsapp', '905551112233', 'B kliniği', 'wamid.ECHO4', now());
INSERT INTO r SELECT 'izolasyon: B kurumunda ayrı müşteri; A''nınki etkilenmez', (SELECT count(*) = 2 FROM customers WHERE external_id = '905551112233' OR (wa_id = '905551112233'));
DO $$ BEGIN
  PERFORM atlas_channel_echo('00000000-0000-4000-a000-00000000000a', 'telegram', '1', 'x', 'id', now());
  INSERT INTO r VALUES ('telegram yankısı', false);
EXCEPTION WHEN SQLSTATE '22023' THEN INSERT INTO r VALUES ('yalnız whatsapp yankısı kabul edilir', true); END $$;
DO $$ BEGIN
  PERFORM atlas_channel_echo('00000000-0000-4000-a000-00000000000a', 'whatsapp', '905551112233', 'x', NULL, now());
  INSERT INTO r VALUES ('kimliksiz yankı', false);
EXCEPTION WHEN SQLSTATE '22023' THEN INSERT INTO r VALUES ('mesaj kimliği olmayan yankı reddedilir', true); END $$;
INSERT INTO r SELECT 'authenticated yankı yazamaz', NOT has_function_privilege('authenticated', 'atlas_channel_echo(uuid, text, text, text, text, timestamptz)', 'EXECUTE');
INSERT INTO r SELECT 'anon yankı yazamaz', NOT has_function_privilege('anon', 'atlas_channel_echo(uuid, text, text, text, text, timestamptz)', 'EXECUTE');
INSERT INTO r SELECT 'servis rolü yankı yazar', has_function_privilege('service_role', 'atlas_channel_echo(uuid, text, text, text, text, timestamptz)', 'EXECUTE');
SELECT CASE WHEN coalesce(ok, false) THEN 'ok   ' ELSE 'HATA ' END || ad FROM r;
SELECT CASE WHEN bool_and(coalesce(ok, false)) THEN 'TÜMÜ GEÇTİ (' || count(*) || ')' ELSE 'BAŞARISIZ' END FROM r;
DO $$ BEGIN IF NOT (SELECT bool_and(coalesce(ok, false)) FROM r) THEN RAISE EXCEPTION 'sınama başarısız'; END IF; END $$;
SQL

$P < supabase/migrations/0024_meta_embedded_signup_down.sql
$P -c "SELECT 1 FROM pg_proc WHERE proname = 'atlas_channel_echo'" | grep -q "0 rows" && echo "geri alma: tamam (yankı RPC'si kalktı, tetikleyici 0020 haline döndü)"
