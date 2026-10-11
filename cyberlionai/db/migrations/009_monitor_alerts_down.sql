-- =============================================================================
-- Cyber Lion AI — 009 geri alma: izleme uyarıları
--
-- DİKKAT: tabloyu ve içindeki uyarıları SİLER (tablo bu göçle doğdu).
-- Uygulama kodu tablo yokken uyarı yazamaz, izleme yine çalışır; panel
-- listesi boş döner.
-- =============================================================================

BEGIN;
DROP TABLE IF EXISTS public.monitor_alerts;
COMMIT;
