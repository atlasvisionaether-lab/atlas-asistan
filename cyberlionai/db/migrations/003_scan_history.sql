-- =============================================================================
-- Cyber Lion AI — 003: Tarama geçmişi
-- PostgreSQL 15+ / Supabase
--
-- Tablolar `public` şemasında ancak `cl_` önekiyle: proje başka bir uygulamayla
-- paylaşıldığı için isim çakışması olmasın ve PostgREST üzerinden erişilebilsin.
--
-- Geri alma: db/migrations/003_scan_history_down.sql
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.cl_scans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sahiplik: ya giriş yapmış kullanıcı ya da sunucunun verdiği anonim oturum.
  user_id               UUID,
  anonymous_session_id  TEXT,

  -- Gizlilik: yalnızca normalize edilmiş host saklanır.
  -- Tam URL, path, query string ve token'lar KAYDEDİLMEZ.
  host                  TEXT NOT NULL,

  score                 SMALLINT CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  checks_total          SMALLINT NOT NULL DEFAULT 0,
  checks_passed         SMALLINT NOT NULL DEFAULT 0,
  checks_failed         SMALLINT NOT NULL DEFAULT 0,
  checks_skipped        SMALLINT NOT NULL DEFAULT 0,

  http_status           SMALLINT,
  redirects             SMALLINT,
  duration_ms           INTEGER,

  -- Yalnızca id / severity / status / note. Ham başlık değerleri (detail)
  -- bilinçli olarak yazılmaz.
  findings              JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings              TEXT[] NOT NULL DEFAULT '{}',

  scanner_version       TEXT NOT NULL,
  report_version        TEXT NOT NULL,

  error_code            TEXT,
  scanned_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Tam olarak bir sahip olmalı
  CONSTRAINT cl_scans_single_owner CHECK (
    (user_id IS NOT NULL AND anonymous_session_id IS NULL) OR
    (user_id IS NULL AND anonymous_session_id IS NOT NULL)
  ),

  -- Oturum kimliği sunucunun ürettiği 64 karakterlik onaltılık değerdir
  CONSTRAINT cl_scans_session_format CHECK (
    anonymous_session_id IS NULL OR anonymous_session_id ~ '^[0-9a-f]{64}$'
  ),

  CONSTRAINT cl_scans_host_len CHECK (char_length(host) BETWEEN 1 AND 253)
);

CREATE INDEX IF NOT EXISTS cl_scans_session_idx
  ON public.cl_scans (anonymous_session_id, scanned_at DESC)
  WHERE anonymous_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cl_scans_user_idx
  ON public.cl_scans (user_id, scanned_at DESC)
  WHERE user_id IS NOT NULL;

-- --- Satır düzeyi güvenlik ---------------------------------------------------
-- RLS açık ve varsayılan reddet. anon rolü için HİÇBİR politika yok: yayınlanan
-- anahtarla tarayıcıdan bu tabloya erişilemez. Yazma ve anonim okuma yalnızca
-- service_role kullanan kendi sunucu ucumuz üzerinden yapılır; service_role
-- RLS'i baypas eder.
ALTER TABLE public.cl_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cl_scans FORCE ROW LEVEL SECURITY;

-- Giriş yapmış kullanıcı yalnızca kendi kayıtlarını görür ve silebilir.
-- (Supabase Auth eklendiğinde devreye girer; bugün kayıtlar anonim oturumdadır.)
DROP POLICY IF EXISTS cl_scans_select_own ON public.cl_scans;
CREATE POLICY cl_scans_select_own ON public.cl_scans
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS cl_scans_delete_own ON public.cl_scans;
CREATE POLICY cl_scans_delete_own ON public.cl_scans
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- İstemciden doğrudan yazma yok: INSERT/UPDATE politikası bilerek tanımlanmadı.

COMMENT ON TABLE public.cl_scans IS
  'Cyber Lion AI tarama geçmişi. Gizlilik: yalnızca normalize host saklanır; '
  'tam URL, path, query, çerez ve ham başlık değerleri kaydedilmez.';

COMMIT;
