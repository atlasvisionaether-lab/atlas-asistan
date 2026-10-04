-- =============================================================================
-- Atlas Asistan — 0014: bilgi bankası yükleme (MinerU) ve arama
--
-- Neden: knowledge_base tablosu vardı ama boştu ve otomatik cevap onu hiç
-- kullanmıyordu. Salonların fiyat listesi / broşür / politika belgeleri
-- (PDF, Word) asistanın bilmesi gereken asıl bilgi. Bu göç:
--   1. kb_documents — yüklenen her dosya ve işlenme durumu
--      (pending → processing → review → approved | rejected | failed).
--   2. knowledge_base'e belge bağı, sıra, başlık ve Türkçe tam metin arama
--      sütunu + dizini. (embedding sütunu yerinde; v1 gömme maliyeti olmadan
--      tam metin aramayla çalışır.)
--   3. Özel 'kb-uploads' kovası: yalnızca kendi kurum klasörüne yükleme.
--   4. kb_search(): yalnızca ONAYLANMIŞ belgelerin parçaları, yalnızca sunucu.
--   5. assistant_settings.kb_enabled (varsayılan KAPALI): canlı otomatik
--      cevap, salon açana kadar değişmez.
--
-- Yetki: kurum üyeliği public.users (id = auth.uid()) üzerinden. Panel
-- belgeyi YALNIZCA kb_set_status() ile onaylar/reddeder; doğrudan UPDATE
-- yetkisi yok, aksi hâlde işlenmemiş bir belge 'approved' yapılabilirdi.
-- Parçaları yalnızca işçi (servis rolü) yazar.
-- =============================================================================

BEGIN;

-- 1. Belgeler -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  file_name        text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  storage_path     text NOT NULL UNIQUE,
  mime_type        text,
  size_bytes       integer CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 10485760),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'review', 'approved', 'rejected', 'failed')),
  error            text CHECK (error IS NULL OR length(error) <= 300),
  chunk_count      integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  reviewed_at      timestamptz,
  -- Yol kurumun klasöründe olmalı: '<organization_id>/…'
  CONSTRAINT kb_documents_path_in_org CHECK (storage_path LIKE organization_id::text || '/%')
);

CREATE INDEX IF NOT EXISTS kb_documents_org_idx ON public.kb_documents (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kb_documents_pending_idx ON public.kb_documents (created_at) WHERE status = 'pending';

-- 2. Parçalar -------------------------------------------------------------------
ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.kb_documents (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chunk_index integer,
  ADD COLUMN IF NOT EXISTS heading text,
  ADD COLUMN IF NOT EXISTS tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('turkish', coalesce(heading, '') || ' ' || content)) STORED;

-- Tablo boştu (0 satır); kurumsuz parça anlamsız.
ALTER TABLE public.knowledge_base ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_base_tsv_idx ON public.knowledge_base USING gin (tsv);
CREATE INDEX IF NOT EXISTS knowledge_base_doc_idx ON public.knowledge_base (document_id, chunk_index);

-- 3. Satır güvenliği ------------------------------------------------------------
ALTER TABLE public.kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.kb_is_member(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.organization_id = p_org);
$$;
REVOKE ALL ON FUNCTION public.kb_is_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.kb_is_member(uuid) TO authenticated;

DROP POLICY IF EXISTS kb_documents_select ON public.kb_documents;
CREATE POLICY kb_documents_select ON public.kb_documents FOR SELECT TO authenticated
  USING (public.kb_is_member(organization_id));

DROP POLICY IF EXISTS kb_documents_insert ON public.kb_documents;
CREATE POLICY kb_documents_insert ON public.kb_documents FOR INSERT TO authenticated
  WITH CHECK (public.kb_is_member(organization_id) AND status = 'pending'
              AND created_by = auth.uid() AND chunk_count = 0);

DROP POLICY IF EXISTS kb_documents_delete ON public.kb_documents;
CREATE POLICY kb_documents_delete ON public.kb_documents FOR DELETE TO authenticated
  USING (public.kb_is_member(organization_id));

DROP POLICY IF EXISTS knowledge_base_select ON public.knowledge_base;
CREATE POLICY knowledge_base_select ON public.knowledge_base FOR SELECT TO authenticated
  USING (public.kb_is_member(organization_id));

GRANT SELECT, INSERT, DELETE ON public.kb_documents TO authenticated;
GRANT SELECT ON public.knowledge_base TO authenticated;
REVOKE ALL ON public.kb_documents FROM anon;
REVOKE ALL ON public.knowledge_base FROM anon;

-- Depolama yolu için: ilk klasör kurum kimliği. METİN olarak karşılaştırılır;
-- uuid'e çevirmek, başka bir kovadaki uuid olmayan klasörde politikayı hataya
-- düşürürdü (Postgres AND kısa devresini garanti etmez).
CREATE OR REPLACE FUNCTION public.kb_is_member_path(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u
                 WHERE u.id = auth.uid() AND u.organization_id::text = split_part(p_name, '/', 1));
$$;
REVOKE ALL ON FUNCTION public.kb_is_member_path(text) FROM public;
GRANT EXECUTE ON FUNCTION public.kb_is_member_path(text) TO authenticated;

-- Onay / ret: yalnızca 'review' durumundaki belge, yalnızca kurum üyesi.
CREATE OR REPLACE FUNCTION public.kb_set_status(p_document uuid, p_status text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_cur text;
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  SELECT organization_id, status INTO v_org, v_cur FROM public.kb_documents WHERE id = p_document FOR UPDATE;
  IF v_org IS NULL OR NOT public.kb_is_member(v_org) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_cur NOT IN ('review', 'approved', 'rejected') THEN RAISE EXCEPTION 'not_reviewable'; END IF;
  UPDATE public.kb_documents SET status = p_status, reviewed_at = now() WHERE id = p_document;
  RETURN p_status;
END $$;
REVOKE ALL ON FUNCTION public.kb_set_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.kb_set_status(uuid, text) TO authenticated;

-- 4. Arama (yalnızca sunucu) ------------------------------------------------------
-- Müşteri mesajının kelimeleri VEYA ile aranır (VE ile "protez tırnak fiyatı
-- ne kadar" gibi bir cümle neredeyse hiç eşleşmezdi). Kökler 'turkish'
-- sözlüğüyle çıkarılıyor, sorgu 'simple' ile kuruluyor: kökler yeniden
-- işlenmesin.
--
-- ÖNEK EŞLEŞMESİ — ÖLÇÜLDÜ: Türkçe kök bulucu tutarsız ("randevu" → 'randevu',
-- "randevunuzu" → 'randev'), birebir kök eşleşmesi "randevu" sorusunu
-- iptal politikası parçasıyla eşleştiremiyordu. 5+ harfli sorgu kökünün son
-- harfi atılıp önek olarak aranıyor ('randev':* ikisini de tutar); kısa kökler
-- ('var', 'yar') birebir kalıyor, aksi hâlde her şeyle eşleşirdi. Ölçüm
-- (üretim veritabanında, salt okuma): fiyat ve iptal parçası eşleşti, saç,
-- adres ve çalışma saati parçası eşleşmedi, fiyat parçası üstte.
CREATE OR REPLACE FUNCTION public.kb_search(p_org uuid, p_query text, p_limit integer DEFAULT 4)
RETURNS TABLE (heading text, content text, rank real, document_id uuid)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH q AS (
    SELECT to_tsquery('simple', string_agg(
             CASE WHEN length(l) >= 5 THEN quote_literal(left(l, length(l) - 1)) || ':*'
                  ELSE quote_literal(l) END, ' | ')) AS query
    FROM unnest(tsvector_to_array(to_tsvector('turkish', coalesce(p_query, '')))) AS l
  )
  SELECT k.heading, k.content, ts_rank(k.tsv, q.query) AS rank, k.document_id
  FROM public.knowledge_base k
  JOIN public.kb_documents d ON d.id = k.document_id AND d.status = 'approved'
  CROSS JOIN q
  WHERE q.query IS NOT NULL AND k.organization_id = p_org AND k.tsv @@ q.query
  ORDER BY rank DESC, k.chunk_index
  LIMIT greatest(1, least(coalesce(p_limit, 4), 8));
$$;
REVOKE ALL ON FUNCTION public.kb_search(uuid, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kb_search(uuid, text, integer) TO service_role;

-- 5. Açma anahtarı ---------------------------------------------------------------
ALTER TABLE public.assistant_settings ADD COLUMN IF NOT EXISTS kb_enabled boolean NOT NULL DEFAULT false;

-- 6. Depolama --------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('kb-uploads', 'kb-uploads', false, 10485760,
        ARRAY['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/msword'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS kb_uploads_insert ON storage.objects;
CREATE POLICY kb_uploads_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kb-uploads' AND public.kb_is_member_path(name));

DROP POLICY IF EXISTS kb_uploads_select ON storage.objects;
CREATE POLICY kb_uploads_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kb-uploads' AND public.kb_is_member_path(name));

DROP POLICY IF EXISTS kb_uploads_delete ON storage.objects;
CREATE POLICY kb_uploads_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'kb-uploads' AND public.kb_is_member_path(name));

COMMIT;
