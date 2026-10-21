-- =============================================================================
-- Cyber Lion AI — 011: asistan hafızası, hafıza tercihi, silme sertifikası
--
-- cl_user_prefs
--   Kullanıcının "Sizi hatırlayalım mı?" kararı (remember_me). NULL satır yok:
--   karar verilmediyse satır da yok, arayüz soruyu o zaman sorar.
--
-- cl_assistant_messages
--   Canlı Asistan'ın yapay zekâ katmanıyla yapılan konuşmalar. YALNIZCA
--   remember_me = true olan, giriş yapmış kullanıcılar için yazılır. İçerik
--   `ai-redact` ile MASKELENMİŞ hâliyle saklanır (e-posta, IP, anahtar yok).
--   Hesap silinince CASCADE ile gider; kullanıcı ayrıca tek başına silebilir.
--   Kullanıcı başına en yeni 100 mesaj tutulur (uç yazarken budar).
--
-- cl_deletion_certificates
--   Silme işleminin kanıtı. KİŞİYE BAĞ YOK: kullanıcı kimliği, e-posta, IP
--   bilerek konmadı. Kod kullanıcıya gösterilir; kodu bilen silmenin ne zaman
--   ve hangi kapsamda yapıldığını doğrulayabilir, kimin yaptığını öğrenemez.
--   "Silinen kişiyi tanımak" için bir iz TUTULMAZ: silinen kullanıcı geri
--   geldiğinde hakkında kayıt olmadığı için yeni kullanıcı olarak görünür.
--
-- Üçü de yalnızca sunucu (servis rolü) tarafından erişilir.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cl_user_prefs (
  user_id      uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  remember_me  boolean NOT NULL,
  decided_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cl_user_prefs IS
  'Kullanıcı tercihleri: asistan hafızası (remember_me). Yalnızca sunucu erişir.';

CREATE TABLE IF NOT EXISTS public.cl_assistant_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cl_assistant_messages IS
  'Asistan konuşma hafızası (maskeli). Yalnızca remember_me=true kullanıcılar. Yalnızca sunucu erişir.';

CREATE INDEX IF NOT EXISTS cl_assistant_messages_user_idx
  ON public.cl_assistant_messages (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.cl_deletion_certificates (
  code        text PRIMARY KEY CHECK (code ~ '^DEL-[0-9A-HJKMNP-TV-Z]{8}$'),
  scopes      text[] NOT NULL CHECK (
                cardinality(scopes) BETWEEN 1 AND 3
                AND scopes <@ ARRAY['conversations', 'scans', 'account']::text[]
              ),
  counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cl_deletion_certificates IS
  'Silme kanıtı: kod, kapsam, sayılar. Kişiye bağ YOK (user_id/e-posta/IP yok). Yalnızca sunucu erişir.';

ALTER TABLE public.cl_user_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cl_assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cl_deletion_certificates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cl_user_prefs FROM anon, authenticated;
REVOKE ALL ON public.cl_assistant_messages FROM anon, authenticated;
REVOKE ALL ON public.cl_deletion_certificates FROM anon, authenticated;

COMMIT;
