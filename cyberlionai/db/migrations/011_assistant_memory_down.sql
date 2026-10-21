-- 011 geri alma: asistan hafızası, tercih ve silme sertifikası tabloları.
-- DİKKAT: sertifika tablosu silinirse verilmiş #DEL kodları artık doğrulanamaz.
BEGIN;
DROP TABLE IF EXISTS public.cl_assistant_messages;
DROP TABLE IF EXISTS public.cl_user_prefs;
DROP TABLE IF EXISTS public.cl_deletion_certificates;
COMMIT;
