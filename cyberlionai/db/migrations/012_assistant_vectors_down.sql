-- 012 geri alma: anlamsal arama fonksiyonu ve vektör sütunu.
-- `vector` uzantısı KALDIRILMAZ: başka bir tablo kullanıyor olabilir.
BEGIN;
DROP FUNCTION IF EXISTS public.cl_match_assistant_messages(uuid, extensions.vector, integer, bigint, double precision);
ALTER TABLE public.cl_assistant_messages DROP COLUMN IF EXISTS embedding;
COMMIT;
