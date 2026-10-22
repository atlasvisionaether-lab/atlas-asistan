-- =============================================================================
-- Atlas Asistan — 0016 geri alma: atlas_orders tablosunu kaldır
--
-- DİKKAT: siparişleri ve fatura bilgilerini SİLER. Önce dışa aktarın.
-- =============================================================================

BEGIN;
DROP TABLE IF EXISTS public.atlas_orders;
COMMIT;
