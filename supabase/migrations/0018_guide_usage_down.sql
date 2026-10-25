-- 0018 geri alma: rehber kullanım sayacını kaldırır (yalnız zaman kayıtları; içerik yok).
BEGIN;
DROP TABLE IF EXISTS public.atlas_guide_usage;
COMMIT;
