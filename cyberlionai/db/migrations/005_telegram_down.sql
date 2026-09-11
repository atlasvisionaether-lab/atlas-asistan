-- =============================================================================
-- Cyber Lion AI — 005 geri alma
--
-- Tabloları düşürür. Bildirim kuyruğundaki bekleyen kayıtlar da gider;
-- bunlar geçici operasyon verisidir, kalıcı iş kaydı değildir.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.cl_bump_activity(DATE, TEXT, TEXT);
DROP TABLE IF EXISTS public.cl_activity_counters;
DROP TABLE IF EXISTS public.cl_telegram_queue;
DROP TABLE IF EXISTS public.cl_telegram_settings;

COMMIT;
