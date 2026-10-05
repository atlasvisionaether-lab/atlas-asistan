-- =============================================================================
-- Cyber Lion AI — 010: tek seferlik düzeltme hizmeti siparişleri ("Biz düzeltelim")
--
-- Neden: bulgu başına sabit fiyatlı uzaktan teknik hizmet satılıyor. Sipariş,
-- fiyatın sunucuda hesaplandığı anki değeriyle ve tüketicinin iki onayıyla
-- (sözleşmeler + cayma süresi içinde ifaya başlanması) kaydedilmeli: cayma
-- hakkı istisnası bu onaya dayanıyor ve ispatı burada.
--
-- Fiyat istemciden ALINMAZ; sunucu hesaplar (api/_lib/fixpricing.js).
-- Hesap silinince siparişler hesaptan kopar ama kalır (SET NULL): ödeme ve
-- fatura kayıtları vergi mevzuatı gereği saklanır (gizlilik politikası: 10 yıl).
-- Yalnızca sunucu erişir.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.fix_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  domain            text NOT NULL CHECK (domain ~ '^[a-z0-9.-]{1,253}$'),
  finding_ids       text[] NOT NULL CHECK (cardinality(finding_ids) BETWEEN 1 AND 40),
  type              text NOT NULL CHECK (type IN ('single', 'full')),
  price             integer NOT NULL CHECK (price > 0),
  price_discounted  integer NOT NULL CHECK (price_discounted > 0),
  plan              text NOT NULL CHECK (plan IN ('free', 'pro', 'enterprise')),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'done', 'cancelled')),
  agreements_at     timestamptz NOT NULL,
  start_consent_at  timestamptz NOT NULL,
  ip                text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  done_at           timestamptz
);

COMMENT ON TABLE public.fix_orders IS
  'Tek seferlik düzeltme hizmeti siparişleri. Fiyat sunucuda hesaplanır. Yalnızca sunucu erişir.';

CREATE INDEX IF NOT EXISTS fix_orders_user_idx ON public.fix_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fix_orders_status_idx ON public.fix_orders (status, created_at DESC);

ALTER TABLE public.fix_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fix_orders FROM anon, authenticated;

COMMIT;
