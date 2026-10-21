-- =============================================================================
-- Cyber Lion AI — 012: asistan hafızasında anlamsal arama (pgvector)
--
-- Neden: 011'deki hafıza yalnızca SON mesajları bağlama koyuyordu. "Geçen ay
-- SSL sorununu çözmüştük" gibi eski bir konuşma, son mesajların dışında
-- kaldığında kayboluyordu. Her mesajın vektörü (embedding) aynı satırda
-- saklanıyor; yeni soruda kullanıcının TÜM kayıtlı geçmişi içinden anlamca en
-- yakın mesajlar bulunuyor.
--
-- Boyut 384: varsayılan sağlayıcı Supabase Edge Function'daki gte-small
-- (veri Supabase dışına çıkmaz). OpenAI uyumlu sağlayıcı seçilirse istek
-- `dimensions: 384` ile yapılır (text-embedding-3-small destekler); boyut
-- değişirse bu sütun ve fonksiyon birlikte değişmeli.
--
-- İndeks: YAKLAŞIK (HNSW/IVFFlat) indeks YOK, bilinçli. Arama her zaman tek
-- kullanıcının satırlarında ve kullanıcı başına en çok 1000 satır var
-- (api/_lib/memory.js KEEP). (user_id, created_at) indeksiyle satırlar
-- bulunup mesafe tam hesaplanıyor: sonuç kesin ve hızlı. Yaklaşık indeks,
-- kullanıcı süzgeciyle birlikte sonuç kaçırabilirdi.
--
-- Vektör, mesajın kendisinden türetilmiş kişisel veridir: aynı satırda durur,
-- mesajla birlikte silinir (kısmi silme, hafızayı kapatma, hesap silme CASCADE).
-- Yalnızca sunucu (servis rolü) erişir.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.cl_assistant_messages
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(384);

COMMENT ON COLUMN public.cl_assistant_messages.embedding IS
  'Mesajın 384 boyutlu vektörü (anlamsal hafıza araması). Mesajla birlikte silinir.';

-- Kullanıcının mesajları arasında sorguya anlamca en yakın p_limit mesaj.
-- p_before_id: bu kimlikten YENİ mesajlar hariç (onlar zaten "son mesajlar"
-- olarak bağlamda; iki kez gönderilmesin). Benzerlik = 1 - kosinüs mesafesi.
CREATE OR REPLACE FUNCTION public.cl_match_assistant_messages(
  p_user_id   uuid,
  p_query     extensions.vector(384),
  p_limit     integer DEFAULT 5,
  p_before_id bigint  DEFAULT NULL,
  p_min_similarity double precision DEFAULT 0.3
)
RETURNS TABLE (id bigint, role text, content text, created_at timestamptz, similarity double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT m.id, m.role, m.content, m.created_at,
         1 - (m.embedding <=> p_query) AS similarity
  FROM public.cl_assistant_messages m
  WHERE m.user_id = p_user_id
    AND m.embedding IS NOT NULL
    AND (p_before_id IS NULL OR m.id < p_before_id)
    AND 1 - (m.embedding <=> p_query) >= p_min_similarity
  ORDER BY m.embedding <=> p_query
  LIMIT LEAST(GREATEST(p_limit, 1), 20);
$$;

REVOKE ALL ON FUNCTION public.cl_match_assistant_messages(uuid, extensions.vector, integer, bigint, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cl_match_assistant_messages(uuid, extensions.vector, integer, bigint, double precision)
  TO service_role;

-- Hafızaya YAZMA: tercih kontrolü ile insert TEK işlemde (inceleme bulgusu,
-- 3. tur). Uygulama katmanında "oku, sonra yaz" arasında her zaman bir
-- pencere kalıyordu: o arada "unut beni" diyen kullanıcının uçuştaki cevabı
-- silinmiş konuşmayı yeniden yaratabiliyordu.
--
-- Tercih satırı FOR SHARE ile kilitlenir:
--   - Eşzamanlı "unut beni" (UPDATE remember_me=false) bu işlemin bitmesini
--     bekler; ardından gelen silme, burada yazılan satırları da siler.
--   - "Unut beni" önce işlendiyse burada remember_me=false okunur ve HİÇBİR
--     satır yazılmaz.
-- p_rows: [{ "role": "user"|"assistant", "content": "...", "embedding": "[...]"|null }]
-- Dönüş: yazılan satır sayısı (hafıza kapalıysa 0).
CREATE OR REPLACE FUNCTION public.cl_append_assistant_messages(
  p_user_id uuid,
  p_rows    jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_remember boolean;
  v_count    integer;
BEGIN
  SELECT remember_me INTO v_remember
  FROM public.cl_user_prefs
  WHERE user_id = p_user_id
  FOR SHARE;

  IF v_remember IS DISTINCT FROM true THEN
    RETURN 0;
  END IF;

  INSERT INTO public.cl_assistant_messages (user_id, role, content, embedding)
  SELECT p_user_id, r->>'role', r->>'content',
         NULLIF(r->>'embedding', '')::extensions.vector(384)
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cl_append_assistant_messages(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cl_append_assistant_messages(uuid, jsonb) TO service_role;

COMMIT;
