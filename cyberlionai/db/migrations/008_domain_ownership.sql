-- =============================================================================
-- Cyber Lion AI — 008: alan adı sahipliği doğrulaması, tarama günlüğü, kötüye
-- kullanım bildirimi
--
-- Neden: aktif testler (XSS/SQLi yoklaması, hassas dosya yolu denemesi) ve
-- Cloudflare otomatik düzeltmesi yalnızca bir onay kutusuna bağlıydı; beyan
-- vardı ama ispat yoktu. Başkasına ait bir sisteme izinsiz aktif test TCK
-- m.243, yapılandırma değişikliği m.244 kapsamına girebilir. Bu göç:
--   1. verified_domains — kullanıcının DNS TXT / dosya / meta etiketiyle
--      kanıtladığı alan adları. Aktif test ve düzeltme yalnızca bunlarda.
--   2. scan_logs — her taramanın kim/nereden/hangi seviyede/doğrulanmış mı
--      kaydı. Gizlilik metnindeki "teknik kayıtlar 12 ay" ile uyumlu; silme
--      haftalık cron'da (api/cron/weekly-scan.js).
--   3. abuse_reports — üçüncü kişilerin "sitemi izinsiz taradılar" bildirimi.
--
-- Hesap silinince: doğrulamalar SİLİNİR (CASCADE, hesaba ait veri); tarama
-- günlüğü KALIR ama hesaptan kopar (SET NULL). Günlük, izinsiz tarama
-- iddiasında hukuki ispat için tutuluyor; hesabın silinmesi ispatı
-- silmemeli. Süre sınırı (12 ay) yine geçerli.
--
-- Erişim: üç tablo da YALNIZCA sunucudan (service_role). RLS açık, politika
-- yok; anon ve authenticated rollerinden tüm yetkiler geri alınır. Tarayıcı
-- bu tablolara hiç bağlanmaz.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.verified_domains (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  domain           text NOT NULL CHECK (domain ~ '^[a-z0-9.-]{1,253}$'),
  token            text NOT NULL CHECK (token ~ '^cyberlion-verify-[a-f0-9]{32}$'),
  method           text CHECK (method IN ('dns', 'file', 'meta')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified')),
  failed_attempts  integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  cooldown_until   timestamptz,
  last_checked_at  timestamptz,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verified_domains_user_domain_key UNIQUE (user_id, domain)
);

COMMENT ON TABLE public.verified_domains IS
  'Kullanıcının sahipliğini kanıtladığı alan adları (DNS TXT / .well-known dosyası / meta etiketi). Aktif test ve otomatik düzeltme yalnızca status=verified satırlarında.';

CREATE INDEX IF NOT EXISTS verified_domains_domain_idx
  ON public.verified_domains (domain) WHERE status = 'verified';

CREATE TABLE IF NOT EXISTS public.scan_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ip          text,
  domain      text NOT NULL,
  level       text NOT NULL CHECK (level IN ('passive', 'intrusive', 'modification')),
  verified    boolean NOT NULL,
  consent     boolean NOT NULL,
  user_agent  text CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.scan_logs IS
  'Tarama günlüğü (hukuki ispat). 12 ay saklanır, sonra haftalık cron siler. Yalnızca sunucu erişir.';

CREATE INDEX IF NOT EXISTS scan_logs_created_idx ON public.scan_logs (created_at);
CREATE INDEX IF NOT EXISTS scan_logs_domain_idx ON public.scan_logs (domain, created_at DESC);

CREATE TABLE IF NOT EXISTS public.abuse_reports (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain          text NOT NULL CHECK (domain ~ '^[a-z0-9.-]{1,253}$'),
  reason          text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  reporter_email  text CHECK (reporter_email IS NULL OR length(reporter_email) <= 320),
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.abuse_reports IS
  'Üçüncü kişilerin izinsiz tarama bildirimleri. Yalnızca sunucu erişir.';

ALTER TABLE public.verified_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_reports    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.verified_domains FROM anon, authenticated;
REVOKE ALL ON public.scan_logs        FROM anon, authenticated;
REVOKE ALL ON public.abuse_reports    FROM anon, authenticated;

COMMIT;
