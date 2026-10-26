#!/usr/bin/env bash
# 0020 (çok kanallı asistan) migration sınaması — geçici Postgres 17 (Docker), ağ yok.
#
#   bash tools/atlas-channels-sql-test.sh
#
# Supabase'in auth.uid(), rolleri ve pg_net'i (net.http_post) taklit edilir;
# canlıda messages.channel'a elle eklenmiş bir kısıt olabileceği için test o
# kısıtla başlar. Sınananlar: gelen mesaj RPC'si (müşteri açma/yeniden kullanma,
# tekrar eden mesajın bir kez yazılması, kurum izolasyonu, eski Twilio WhatsApp
# müşterisi), giden tetikleyici (yalnız bağlı kanalda, gizli değerle),
# gönderim gizli değeri, benzersiz bot/numara, yetkiler, kurulum adımı, geri alma.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=atlas-pg-channels-$$
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
  full_name text NOT NULL, phone text, wa_id text, consent_channel text, last_message_at timestamptz, created_at timestamptz DEFAULT now());
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
$P < supabase/migrations/0020_channels.sql   # iki kez: idempotent mi?

$P <<'SQL'
\set A '00000000-0000-4000-a000-00000000000a'
\set B '00000000-0000-4000-a000-00000000000b'
CREATE TEMP TABLE r (ad text, ok boolean);
INSERT INTO r SELECT 'eski kanal kısıtı telegram/instagramı kapsıyor', pg_get_constraintdef(oid) ~ 'telegram' AND pg_get_constraintdef(oid) ~ 'web_widget'
  FROM pg_constraint WHERE conname = 'messages_channel_check';

-- Gelen: yeni Telegram müşterisi, ardından aynı mesaj tekrar
INSERT INTO r SELECT 'telegram: yeni mesaj yazıldı', atlas_channel_inbound(:'A', 'telegram', '111', 'Ayşe Y', 'Merhaba', '111:1', now()) IS NOT NULL;
INSERT INTO r SELECT 'telegram: aynı mesaj tekrar → yazılmadı', atlas_channel_inbound(:'A', 'telegram', '111', 'Ayşe Y', 'Merhaba', '111:1', now()) IS NULL;
INSERT INTO r SELECT 'telegram: ikinci mesaj aynı müşteriye', atlas_channel_inbound(:'A', 'telegram', '111', null, 'Fiyat?', '111:2', now()) IS NOT NULL;
INSERT INTO r SELECT 'telegram: tek müşteri, adı korunur', (SELECT count(*) = 1 AND min(full_name) = 'Ayşe Y' FROM customers WHERE organization_id = :'A' AND external_channel = 'telegram');
INSERT INTO r SELECT 'telegram: iki mesaj', (SELECT count(*) FROM messages WHERE organization_id = :'A' AND channel = 'telegram') = 2;
-- Kurum izolasyonu: aynı sohbet kimliği başka kurumda ayrı müşteri
INSERT INTO r SELECT 'izolasyon: B kurumu ayrı müşteri açar', atlas_channel_inbound(:'B', 'telegram', '111', 'X', 'Selam', '111:1', now()) IS NOT NULL;
INSERT INTO r SELECT 'izolasyon: A müşterisi B''de görünmez', (SELECT count(DISTINCT organization_id) FROM customers WHERE external_id = '111') = 2;
-- Eski Twilio WhatsApp müşterisi yeniden kullanılır
INSERT INTO r SELECT 'whatsapp: eski wa_id müşterisi kullanıldı', atlas_channel_inbound(:'A', 'whatsapp', '905321112233', 'Yeni Ad', 'Merhaba', 'wamid.1', now()) IS NOT NULL;
INSERT INTO r SELECT 'whatsapp: yeni müşteri açılmadı, dış kimlik yazıldı', (SELECT count(*) = 1 AND bool_and(external_id = '905321112233') FROM customers WHERE wa_id = '905321112233');
-- (fonksiyonun eklediği satır aynı ifadedeki alt sorguya görünmez: kontrol ayrı ifadede)
INSERT INTO r SELECT 'whatsapp: yeni numara yazıldı', atlas_channel_inbound(:'A', 'whatsapp', '905339998877', null, 'Selam', 'wamid.2', now()) IS NOT NULL;
INSERT INTO r SELECT 'whatsapp: yeni numara → ad ve telefon +numara', (SELECT full_name = '+905339998877' AND phone = '+905339998877' AND wa_id = '905339998877' FROM customers WHERE external_id = '905339998877');
INSERT INTO r SELECT 'instagram: mesaj yazıldı', atlas_channel_inbound(:'A', 'instagram', '17841400000', null, 'Merhaba', 'mid.1', now()) IS NOT NULL;
INSERT INTO r SELECT 'instagram: adsız müşteri etiketi', (SELECT full_name = 'Instagram kullanıcısı' FROM customers WHERE external_id = '17841400000');

-- Giden: bağlantı yokken tetikleyici çağırmaz
INSERT INTO messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type)
  SELECT :'A', id, 'telegram', 'out', 'cevap', false, 'ai' FROM customers WHERE organization_id = :'A' AND external_id = '111';
INSERT INTO r SELECT 'giden: bağlantı yokken gönderim yok', (SELECT count(*) FROM net.calls) = 0;
INSERT INTO channel_connections (organization_id, channel, status, external_id, webhook_secret) VALUES (:'A', 'telegram', 'connected', '999', 'w');
INSERT INTO messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type)
  SELECT :'A', id, 'telegram', 'out', 'cevap 2', false, 'ai' FROM customers WHERE organization_id = :'A' AND external_id = '111';
INSERT INTO r SELECT 'giden: bağlıyken gönderim ucuna gizli değerle', (SELECT count(*) = 1 AND bool_and(url = 'https://atlasasistan.com/api/atlas-channel-send'
  AND headers->>'X-Atlas-Secret' = (SELECT value FROM private.app_settings WHERE key = 'channel_send_secret') AND body ? 'message_id') FROM net.calls);
INSERT INTO r SELECT 'giden: müşteri mesajı gönderilmez', atlas_channel_inbound(:'A', 'telegram', '111', null, 'Yine', '111:3', now()) IS NOT NULL AND (SELECT count(*) FROM net.calls) = 1;
INSERT INTO messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type)
  SELECT :'A', id, 'web_widget', 'out', 'widget', false, 'ai' FROM customers WHERE organization_id = :'A' AND external_id = '111';
INSERT INTO r SELECT 'giden: web_widget gönderilmez', (SELECT count(*) FROM net.calls) = 1;

-- Gizli değer
INSERT INTO r SELECT 'gizli değer: doğru → true', atlas_check_send_secret((SELECT value FROM private.app_settings WHERE key = 'channel_send_secret'));
INSERT INTO r SELECT 'gizli değer: yanlış/boş → false', NOT atlas_check_send_secret('x') AND NOT atlas_check_send_secret(NULL) AND NOT atlas_check_send_secret('');
INSERT INTO r SELECT 'gizli değer: 64 hex', (SELECT value ~ '^[0-9a-f]{64}$' FROM private.app_settings WHERE key = 'channel_send_secret');

-- Benzersiz bot: aynı bot B kurumunda bekleyemez/bağlanamaz
DO $$ BEGIN
  INSERT INTO channel_connections (organization_id, channel, status, external_id, webhook_secret) VALUES ('00000000-0000-4000-a000-00000000000b', 'telegram', 'pending', '999', 'w2');
  INSERT INTO r VALUES ('benzersiz: aynı bot iki kurumda', false);
EXCEPTION WHEN unique_violation THEN INSERT INTO r VALUES ('benzersiz: aynı bot iki kurumda reddedildi', true); END $$;
INSERT INTO channel_connections (organization_id, channel, status, external_id, webhook_secret) VALUES (:'B', 'telegram', 'disconnected', '999', 'w3')
  ON CONFLICT (organization_id, channel) DO NOTHING;
INSERT INTO r SELECT 'benzersiz: kesilmiş bağlantı engel değil', (SELECT count(*) FROM channel_connections WHERE external_id = '999') = 2;

-- Yetkiler
INSERT INTO r SELECT 'yetki: authenticated inbound çalıştıramaz', NOT has_function_privilege('authenticated', 'atlas_channel_inbound(uuid,text,text,text,text,text,timestamptz)', 'EXECUTE');
INSERT INTO r SELECT 'yetki: anon gizli değeri soramaz', NOT has_function_privilege('anon', 'atlas_check_send_secret(text)', 'EXECUTE');
INSERT INTO r SELECT 'yetki: service_role inbound çalıştırır', has_function_privilege('service_role', 'atlas_channel_inbound(uuid,text,text,text,text,text,timestamptz)', 'EXECUTE');
INSERT INTO r SELECT 'yetki: authenticated private şemaya giremez', NOT has_schema_privilege('authenticated', 'private', 'USAGE');
INSERT INTO r SELECT 'yetki: authenticated bağlantı tablosunu okuyamaz', NOT has_table_privilege('authenticated', 'channel_connections', 'SELECT');

-- Kurulum adımı: bağlı kanal "WhatsApp/kanal" adımını tamamlar
INSERT INTO users VALUES ('00000000-0000-4000-a000-0000000000a1', :'A', 'owner');
SELECT set_config('test.uid', '00000000-0000-4000-a000-0000000000a1', false);
INSERT INTO r SELECT 'kurulum: bağlı Telegram kanal adımını tamamlar', (SELECT whatsapp FROM atlas_onboarding_status());

-- Geçersiz giriş
DO $$ BEGIN
  PERFORM atlas_channel_inbound('00000000-0000-4000-a000-00000000000a', 'sms', '1', null, 'x', null, now());
  INSERT INTO r VALUES ('geçersiz kanal reddedilir', false);
EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO r VALUES ('geçersiz kanal reddedilir', true); END $$;

-- NULL (ölçülemeyen) sınama da başarısız sayılır
SELECT CASE WHEN coalesce(ok, false) THEN 'ok   ' ELSE 'HATA ' END || ad FROM r;
SELECT CASE WHEN bool_and(coalesce(ok, false)) THEN 'TÜMÜ GEÇTİ (' || count(*) || ')' ELSE 'BAŞARISIZ: ' || count(*) FILTER (WHERE NOT coalesce(ok, false)) END FROM r;
DO $$ BEGIN IF NOT (SELECT bool_and(coalesce(ok, false)) FROM r) THEN RAISE EXCEPTION 'sınama başarısız'; END IF; END $$;
SQL

$P < supabase/migrations/0020_channels_down.sql
echo "geri alma: tamam"
