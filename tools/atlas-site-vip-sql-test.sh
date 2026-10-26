#!/usr/bin/env bash
# 0023 (VIP çok sayfalı site) migration sınaması — geçici Postgres 17 (Docker), ağ yok.
#
#   bash tools/atlas-site-vip-sql-test.sh
#
# Önce 0022 uygulanır. service_role'e otomatik yetki VERİLMEZ (canlıdaki gibi) —
# 0023 kendi GRANT'ını içermeli; DELETE yetkisi yok (kaldırma = 'archived').
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=atlas-pg-vip-$$
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=t postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
P="docker exec -i $NAME psql -U postgres -q -v ON_ERROR_STOP=1"

$P <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, plan text);
CREATE TABLE services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, name text);
CREATE TABLE atlas_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, plan text, status text);
GRANT USAGE ON SCHEMA public TO service_role, authenticated, anon;
INSERT INTO organizations (id, plan) VALUES ('00000000-0000-4000-a000-00000000000a', 'vip'), ('00000000-0000-4000-a000-00000000000b', 'pro');
INSERT INTO auth.users VALUES ('00000000-0000-4000-a000-0000000000a1');
SQL
$P < supabase/migrations/0022_clinic_sites.sql
$P < supabase/migrations/0023_clinic_site_pages.sql
$P < supabase/migrations/0023_clinic_site_pages.sql   # iki kez

$P <<'SQL'
CREATE TEMP TABLE r (ad text, ok boolean);
GRANT ALL ON r TO service_role;
SET ROLE service_role;
INSERT INTO clinic_sites (organization_id, subdomain) VALUES ('00000000-0000-4000-a000-00000000000a', 'isil');
INSERT INTO r SELECT 'clinic_sites.regions varsayılan []', (SELECT regions = '[]'::jsonb FROM clinic_sites);
UPDATE clinic_sites SET regions = '[{"name":"Kadıköy","service":"Lazer","note":"x","slug":"kadikoy-lazer"}]';
INSERT INTO r SELECT 'servis rolü bölge yazar', (SELECT jsonb_array_length(regions) = 1 FROM clinic_sites);
INSERT INTO clinic_site_pages (organization_id, kind, slug, ref) VALUES ('00000000-0000-4000-a000-00000000000a', 'service', 'lazer-epilasyon', 'Lazer Epilasyon');
INSERT INTO r SELECT 'servis rolü sayfa yazar; varsayılan taslak, issues []', (SELECT status = 'draft' AND issues = '[]'::jsonb FROM clinic_site_pages);
UPDATE clinic_site_pages SET status = 'published', published_html = '<p>x</p>', approved_by = '00000000-0000-4000-a000-0000000000a1', approved_at = now();
INSERT INTO r SELECT 'servis rolü yayınlar (onay kaydıyla)', (SELECT status = 'published' AND approved_by IS NOT NULL FROM clinic_site_pages);
INSERT INTO clinic_site_pages (organization_id, kind, slug) VALUES ('00000000-0000-4000-a000-00000000000a', 'blog', 'blog-x')
  ON CONFLICT (organization_id, slug) DO UPDATE SET status = 'archived';
INSERT INTO clinic_site_pages (organization_id, kind, slug) VALUES ('00000000-0000-4000-a000-00000000000a', 'blog', 'blog-x')
  ON CONFLICT (organization_id, slug) DO UPDATE SET status = 'archived';
INSERT INTO r SELECT 'upsert (on_conflict organization_id,slug) çalışır', (SELECT status = 'archived' FROM clinic_site_pages WHERE slug = 'blog-x');
INSERT INTO r SELECT 'servis rolü VIP için plan okur', (SELECT plan = 'vip' FROM organizations WHERE id = '00000000-0000-4000-a000-00000000000a');
INSERT INTO r SELECT 'servis rolü VIP siparişlerini okur', (SELECT count(*) = 0 FROM atlas_orders);
RESET ROLE;
INSERT INTO clinic_site_pages (organization_id, kind, slug) VALUES ('00000000-0000-4000-a000-00000000000b', 'service', 'lazer-epilasyon');
INSERT INTO r SELECT 'aynı slug başka kurumda serbest', (SELECT count(*) = 2 FROM clinic_site_pages WHERE slug = 'lazer-epilasyon');
DO $$ BEGIN
  INSERT INTO clinic_site_pages (organization_id, kind, slug) VALUES ('00000000-0000-4000-a000-00000000000a', 'region', 'lazer-epilasyon');
  INSERT INTO r VALUES ('aynı kurumda aynı slug', false);
EXCEPTION WHEN unique_violation THEN INSERT INTO r VALUES ('aynı kurumda aynı slug reddedilir', true); END $$;
DO $$ DECLARE bad text; BEGIN
  FOREACH bad IN ARRAY ARRAY['-x', 'x-', 'A', 'a/b', 'a_b', 'kötü', '', repeat('a', 81)] LOOP
    BEGIN
      INSERT INTO clinic_site_pages (organization_id, kind, slug) VALUES ('00000000-0000-4000-a000-00000000000a', 'blog', bad);
      INSERT INTO r VALUES ('geçersiz slug kabul edildi: ' || bad, false);
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  INSERT INTO r VALUES ('geçersiz slug''lar reddedilir (yol/büyük harf/Türkçe/uzun)', true);
END $$;
DO $$ BEGIN
  INSERT INTO clinic_site_pages (organization_id, kind, slug) VALUES ('00000000-0000-4000-a000-00000000000a', 'landing', 'y');
  INSERT INTO r VALUES ('geçersiz tür', false);
EXCEPTION WHEN check_violation THEN INSERT INTO r VALUES ('geçersiz tür reddedilir', true); END $$;
DO $$ BEGIN
  UPDATE clinic_site_pages SET status = 'deleted' WHERE slug = 'blog-x';
  INSERT INTO r VALUES ('geçersiz durum', false);
EXCEPTION WHEN check_violation THEN INSERT INTO r VALUES ('geçersiz durum reddedilir', true); END $$;
INSERT INTO r SELECT 'servis rolü sayfa SİLEMEZ', NOT has_table_privilege('service_role', 'clinic_site_pages', 'DELETE');
INSERT INTO r SELECT 'authenticated okuyamaz', NOT has_table_privilege('authenticated', 'clinic_site_pages', 'SELECT');
INSERT INTO r SELECT 'anon okuyamaz', NOT has_table_privilege('anon', 'clinic_site_pages', 'SELECT');
INSERT INTO r SELECT 'RLS açık', (SELECT relrowsecurity FROM pg_class WHERE relname = 'clinic_site_pages');
DELETE FROM organizations WHERE id = '00000000-0000-4000-a000-00000000000a';
INSERT INTO r SELECT 'kurum silinince sayfaları da silinir', (SELECT count(*) = 0 FROM clinic_site_pages WHERE organization_id = '00000000-0000-4000-a000-00000000000a');
SELECT CASE WHEN coalesce(ok, false) THEN 'ok   ' ELSE 'HATA ' END || ad FROM r;
SELECT CASE WHEN bool_and(coalesce(ok, false)) THEN 'TÜMÜ GEÇTİ (' || count(*) || ')' ELSE 'BAŞARISIZ' END FROM r;
DO $$ BEGIN IF NOT (SELECT bool_and(coalesce(ok, false)) FROM r) THEN RAISE EXCEPTION 'sınama başarısız'; END IF; END $$;
SQL

$P < supabase/migrations/0023_clinic_site_pages_down.sql
$P -c "SELECT 1 FROM clinic_sites LIMIT 1" >/dev/null
echo "geri alma: tamam (0022 tablosu duruyor)"
