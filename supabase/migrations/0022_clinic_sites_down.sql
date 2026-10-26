-- 0022 geri alma. DİKKAT: yayındaki klinik siteleri kapanır. Kovadaki görseller
-- SİLİNMEZ (Storage → clinic-sites'tan elle silinir; kova boş değilse kaldırılamaz).
BEGIN;
DROP TABLE IF EXISTS public.clinic_sites;
COMMIT;
