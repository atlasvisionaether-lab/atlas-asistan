-- =============================================================================
-- Atlas Asistan — 0023: VIP çok sayfalı site — hizmet sayfaları, bölge sayfaları, blog
--
-- Ek sayfalar tek düzeyli adreslerde: <alt-alan>.atlasasistan.com/<slug> ve
-- atlasasistan.com/s/<alt-alan>/<slug>.
--   service : her aktif hizmet (slug = hizmet adı)          — site yayınıyla birlikte
--   region  : klinik seçer, en çok 6 (bölge + hizmet + ZORUNLU bölgeye özgü not;
--             aynı metni bölge adıyla çoğaltan "kapı sayfası" üretilmez)
--   blog    : yazı yazı; HER YAZI ayrı onayla yayınlanır
-- Her sayfa sağlık iddiası denetiminden geçer; onaylanan HTML anlık görüntü
-- olarak saklanır ve birebir sunulur (0022 ile aynı ilke).
--
-- VIP erişimi: organizations.plan = 'vip' (yönetici elle) YA DA ödenmiş VIP
-- siparişi (atlas_orders.plan='vip', status='paid'). Kontrol uygulamada.
-- =============================================================================

BEGIN;

ALTER TABLE public.clinic_sites ADD COLUMN IF NOT EXISTS regions jsonb NOT NULL DEFAULT '[]'::jsonb;  -- [{ name, service, note }]

CREATE TABLE IF NOT EXISTS public.clinic_site_pages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('service', 'region', 'blog')),
  slug             text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  ref              text,                 -- service: hizmet adı; region: "bölge|hizmet"; blog: başlık
  content          jsonb,
  issues           jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_html   text,
  published_at     timestamptz,
  approved_by      uuid REFERENCES auth.users(id),
  approved_at      timestamptz,
  generated_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
CREATE INDEX IF NOT EXISTS clinic_site_pages_org_kind_idx ON public.clinic_site_pages (organization_id, kind, status);

ALTER TABLE public.clinic_site_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_site_pages FROM anon, authenticated;
-- SQL Editor tablosu: servis rolü yetkisi elle (0005, 0021). DELETE yok: kaldırma 'archived'.
GRANT SELECT, INSERT, UPDATE ON public.clinic_site_pages TO service_role;
-- VIP kontrolü: kurum planı ve ödenmiş VIP siparişi okunur.
GRANT SELECT ON public.organizations TO service_role;
GRANT SELECT ON public.atlas_orders TO service_role;

COMMIT;
