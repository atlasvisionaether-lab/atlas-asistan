-- 0023 geri alma. DİKKAT: hizmet/bölge sayfaları ve blog yazıları silinir; ana sayfa (0022) kalır.
BEGIN;
DROP TABLE IF EXISTS public.clinic_site_pages;
ALTER TABLE public.clinic_sites DROP COLUMN IF EXISTS regions;
COMMIT;
