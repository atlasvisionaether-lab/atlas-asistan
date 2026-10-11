-- =============================================================================
-- Cyber Lion AI — 009: izleme uyarıları (panelde gösterilir)
--
-- Neden: günlük izleme (skor düşüşü, SSL/alan adı bitişi, kara liste, kesinti)
-- uyarıları yalnızca işletmecinin Telegram'ına gidiyordu. Fiyat tablosunda
-- müşteriye "uyarı" vaat etmek için uyarının MÜŞTERİYE ulaşması gerekiyor;
-- e-posta sağlayıcısı henüz yok, bu yüzden uyarılar hesaba bağlı saklanıp
-- panelde listeleniyor. E-posta eklendiğinde aynı satırlardan gönderilecek.
--
-- `data` yalnızca sayı ve kısa kod taşır (eski/yeni skor, kalan gün, kaynak);
-- kişisel veri yok. Metin istemcide dile göre üretilir.
--
-- Hesap silinince uyarılar da silinir (CASCADE). Yalnızca sunucu erişir.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.monitor_alerts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  domain      text NOT NULL CHECK (domain ~ '^[a-z0-9.-]{1,253}$'),
  kind        text NOT NULL CHECK (kind IN ('score_drop', 'ssl_expiry', 'domain_expiry',
                'blacklist', 'downtime', 'recovered')),
  severity    text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

COMMENT ON TABLE public.monitor_alerts IS
  'Günlük izleme uyarıları (panelde listelenir). Yalnızca sunucu erişir.';

CREATE INDEX IF NOT EXISTS monitor_alerts_user_idx
  ON public.monitor_alerts (user_id, created_at DESC);

ALTER TABLE public.monitor_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_alerts FROM anon, authenticated;

COMMIT;
