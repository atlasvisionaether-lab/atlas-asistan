-- =============================================================================
-- Atlas Asistan — 0014 geri alma: bilgi bankası yükleme ve arama
--
-- DİKKAT: kb_documents tablosunu ve ona bağlı knowledge_base parçalarını SİLER
-- (ON DELETE CASCADE). 'kb-uploads' kovasındaki dosyalar silinmez; kova
-- politikaları kaldırılır, kova boşaltılmadan silinemez (elle yapın).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS kb_uploads_insert ON storage.objects;
DROP POLICY IF EXISTS kb_uploads_select ON storage.objects;
DROP POLICY IF EXISTS kb_uploads_delete ON storage.objects;

ALTER TABLE public.assistant_settings DROP COLUMN IF EXISTS kb_enabled;

DROP FUNCTION IF EXISTS public.kb_search(uuid, text, integer);
DROP FUNCTION IF EXISTS public.kb_set_status(uuid, text);

DROP POLICY IF EXISTS knowledge_base_select ON public.knowledge_base;
DELETE FROM public.knowledge_base WHERE document_id IS NOT NULL;
DROP INDEX IF EXISTS public.knowledge_base_tsv_idx;
DROP INDEX IF EXISTS public.knowledge_base_doc_idx;
ALTER TABLE public.knowledge_base
  DROP COLUMN IF EXISTS tsv,
  DROP COLUMN IF EXISTS heading,
  DROP COLUMN IF EXISTS chunk_index,
  DROP COLUMN IF EXISTS document_id;
ALTER TABLE public.knowledge_base ALTER COLUMN organization_id DROP NOT NULL;

DROP TABLE IF EXISTS public.kb_documents;
DROP FUNCTION IF EXISTS public.kb_is_member_path(text);
DROP FUNCTION IF EXISTS public.kb_is_member(uuid);

COMMIT;
