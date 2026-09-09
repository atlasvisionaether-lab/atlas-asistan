-- Cyber Lion AI — 003b geri alma (Supabase varsayılanlarına dönüş)
BEGIN;
GRANT ALL ON public.cl_scans TO anon;
GRANT ALL ON public.cl_scans TO authenticated;
COMMIT;
