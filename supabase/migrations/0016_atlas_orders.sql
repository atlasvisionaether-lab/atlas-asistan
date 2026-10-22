-- =============================================================================
-- Atlas Asistan — 0016: atlasasistan.com siparişleri (iyzico ödemesi)
--
-- Yazan: api/atlas-checkout.js ve api/atlas-checkout-return.js (servis rolü).
-- Tarayıcıdan erişim YOK: RLS açık, politika yok; anon/authenticated
-- yetkileri ayrıca geri alındı.
--
-- billing (jsonb): { type: individual|corporate, tcNo, taxNo, taxOffice,
--   country (ISO 3166-1 alpha-2), vatId, companyRegNo } — hepsi isteğe bağlı;
--   fatura kesmek için tutulur (VUK saklama süresi). Loglanmaz.
-- iyzico form jetonu düz değil SHA-256 özeti olarak tutulur.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.atlas_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  plan               text NOT NULL CHECK (plan IN ('standart', 'pro', 'starter', 'vip')),
  kind               text NOT NULL CHECK (kind IN ('subscription', 'setup')),
  amount_try         integer NOT NULL CHECK (amount_try > 0),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  name               text NOT NULL,
  clinic             text NOT NULL,
  email              text NOT NULL,
  phone_e164         text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  country            char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  address            text NOT NULL,
  city               text NOT NULL,
  billing            jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_ppf        boolean NOT NULL,
  consent_transfer   boolean NOT NULL DEFAULT false,
  lang               char(2) NOT NULL DEFAULT 'tr',
  iyzico_token_hash  text,
  iyzico_ref         text,
  sub_status         text,
  fail_reason        text,
  paid_at            timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS atlas_orders_token_hash_idx ON public.atlas_orders (iyzico_token_hash);
CREATE INDEX IF NOT EXISTS atlas_orders_iyzico_ref_idx ON public.atlas_orders (iyzico_ref);
CREATE INDEX IF NOT EXISTS atlas_orders_created_at_idx ON public.atlas_orders (created_at DESC);

ALTER TABLE public.atlas_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atlas_orders FROM anon, authenticated;

COMMIT;
