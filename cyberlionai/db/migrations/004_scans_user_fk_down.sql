-- =============================================================================
-- Cyber Lion AI — 004 geri alma
--
-- Yabancı anahtarı kaldırır. Veri silinmez; yalnızca bütünlük kontrolü ve
-- cascade davranışı ortadan kalkar.
-- =============================================================================

BEGIN;

ALTER TABLE public.cl_scans DROP CONSTRAINT IF EXISTS cl_scans_user_fk;

COMMIT;
