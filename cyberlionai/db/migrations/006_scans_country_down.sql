-- =============================================================================
-- Cyber Lion AI — 006 geri alma: tarama kaydındaki ülke sütunu
--
-- DİKKAT: bu dosya VERİ SİLER. Sütun düşürüldüğünde o ana kadar çözülmüş
-- bütün ülke değerleri kaybolur ve geri getirilemez — ülke, tarama anındaki
-- DNS çözümünden türetiliyor, sonradan yeniden üretilemez.
--
-- Çalıştırmadan önce yedek alın:
--   SELECT id, country, scanned_at FROM public.cl_scans WHERE country IS NOT NULL;
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS public.cl_scans_country_idx;

ALTER TABLE public.cl_scans
  DROP CONSTRAINT IF EXISTS cl_scans_country_format;

ALTER TABLE public.cl_scans
  DROP COLUMN IF EXISTS country;

COMMIT;
