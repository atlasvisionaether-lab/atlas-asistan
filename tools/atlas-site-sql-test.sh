#!/usr/bin/env bash
# 0022 (klinik web sitesi) migration sınaması — geçici Postgres 17 (Docker), ağ yok.
#
#   bash tools/atlas-site-sql-test.sh
#
# Supabase rolleri ve storage.buckets taklit edilir; service_role'e otomatik
# yetki VERİLMEZ (canlıdaki gibi) — 0022 kendi GRANT'ını içermeli.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=atlas-pg-site-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=t postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
P="docker exec -i $NAME psql -U postgres -q -v ON_ERROR_STOP=1"

$P <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, name text);
GRANT USAGE ON SCHEMA public TO service_role, authenticated, anon;
INSERT INTO organizations (id) VALUES ('00000000-0000-4000-a000-00000000000a'), ('00000000-0000-4000-a000-00000000000b');
SQL
$P < supabase/migrations/0022_clinic_sites.sql
$P < supabase/migrations/0022_clinic_sites.sql   # iki kez

$P <<'SQL'
CREATE TEMP TABLE r (ad text, ok boolean);
GRANT ALL ON r TO service_role;
SET ROLE service_role;
INSERT INTO clinic_sites (organization_id, subdomain) VALUES ('00000000-0000-4000-a000-00000000000a', 'isil-guzellik');
INSERT INTO r SELECT 'servis rolü yazar/okur', (SELECT count(*) = 1 FROM clinic_sites);
UPDATE clinic_sites SET status = 'published', published_html = '<p>x</p>' WHERE subdomain = 'isil-guzellik';
INSERT INTO r SELECT 'servis rolü günceller', (SELECT status = 'published' FROM clinic_sites);
INSERT INTO r SELECT 'servis rolü hizmetleri okur', (SELECT count(*) >= 0 FROM services);
RESET ROLE;
DO $$ BEGIN
  INSERT INTO clinic_sites (organization_id, subdomain) VALUES ('00000000-0000-4000-a000-00000000000b', 'isil-guzellik');
  INSERT INTO r VALUES ('aynı alt alan iki kurumda', false);
EXCEPTION WHEN unique_violation THEN INSERT INTO r VALUES ('aynı alt alan iki kurumda reddedilir', true); END $$;
DO $$ DECLARE bad text; BEGIN
  FOREACH bad IN ARRAY ARRAY['-x-', 'AB', 'a', 'kötü', 'a_b'] LOOP
    BEGIN
      UPDATE clinic_sites SET subdomain = bad WHERE organization_id = '00000000-0000-4000-a000-00000000000a';
      INSERT INTO r VALUES ('geçersiz alt alan: ' || bad, false);
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  INSERT INTO r VALUES ('geçersiz alt alan adları reddedilir', true);
END $$;
DO $$ BEGIN
  UPDATE clinic_sites SET template = 'kotu' WHERE organization_id = '00000000-0000-4000-a000-00000000000a';
  INSERT INTO r VALUES ('geçersiz şablon', false);
EXCEPTION WHEN check_violation THEN INSERT INTO r VALUES ('geçersiz şablon reddedilir', true); END $$;
DO $$ BEGIN
  UPDATE clinic_sites SET accent = 'red' WHERE organization_id = '00000000-0000-4000-a000-00000000000a';
  INSERT INTO r VALUES ('geçersiz renk', false);
EXCEPTION WHEN check_violation THEN INSERT INTO r VALUES ('geçersiz renk reddedilir', true); END $$;
INSERT INTO r SELECT 'servis rolü SİLEMEZ', NOT has_table_privilege('service_role', 'clinic_sites', 'DELETE');
INSERT INTO r SELECT 'authenticated okuyamaz', NOT has_table_privilege('authenticated', 'clinic_sites', 'SELECT');
INSERT INTO r SELECT 'anon okuyamaz', NOT has_table_privilege('anon', 'clinic_sites', 'SELECT');
INSERT INTO r SELECT 'kova: herkese açık, 2 MB, yalnız jpeg/png/webp', (SELECT public AND file_size_limit = 2097152 AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'] FROM storage.buckets WHERE id = 'clinic-sites');
DELETE FROM organizations WHERE id = '00000000-0000-4000-a000-00000000000a';
INSERT INTO r SELECT 'kurum silinince sitesi de silinir', (SELECT count(*) = 0 FROM clinic_sites);
SELECT CASE WHEN coalesce(ok, false) THEN 'ok   ' ELSE 'HATA ' END || ad FROM r;
SELECT CASE WHEN bool_and(coalesce(ok, false)) THEN 'TÜMÜ GEÇTİ (' || count(*) || ')' ELSE 'BAŞARISIZ' END FROM r;
DO $$ BEGIN IF NOT (SELECT bool_and(coalesce(ok, false)) FROM r) THEN RAISE EXCEPTION 'sınama başarısız'; END IF; END $$;
SQL

$P < supabase/migrations/0022_clinic_sites_down.sql
echo "geri alma: tamam"
