-- =============================================================================
-- Atlas Asistan — 0018: rehber (DeepSeek) kullanım sayacı
--
-- Yazan/okuyan: api/atlas-guide.js (servis rolü). Kullanıcı başına 24 saatte
-- GUIDE_DAILY_LIMIT (varsayılan 60) istek: kayıt herkese açık olduğu için
-- yapay zekâ maliyetini sınırlar. Soru metni TUTULMAZ, yalnız zaman.
-- Tarayıcıdan erişim YOK: RLS açık, politika yok.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.atlas_guide_usage (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_guide_usage_user_time_idx ON public.atlas_guide_usage (user_id, created_at DESC);

ALTER TABLE public.atlas_guide_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atlas_guide_usage FROM anon, authenticated;

COMMIT;
