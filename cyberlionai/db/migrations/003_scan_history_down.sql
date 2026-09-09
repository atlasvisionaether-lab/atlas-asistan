-- Cyber Lion AI — 003 geri alma
BEGIN;
DROP POLICY IF EXISTS cl_scans_delete_own ON public.cl_scans;
DROP POLICY IF EXISTS cl_scans_select_own ON public.cl_scans;
DROP TABLE IF EXISTS public.cl_scans;
COMMIT;
