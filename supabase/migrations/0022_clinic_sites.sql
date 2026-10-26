-- =============================================================================
-- Atlas Asistan — 0022: klinik web sitesi (Görev 7)
--
-- Akış: panel "Web Sitem" → /api/atlas-site (servis rolü) → bilgiler + görseller
-- → DeepSeek yalnız METİN yazar (fiyat/adres/telefon veritabanından) → önizleme
-- → klinik sahibi ONAYLAR → onaylanan HTML anlık görüntü olarak saklanır
-- (published_html) → /s/<alt-alan> ve <alt-alan>.atlasasistan.com bunu sunar.
-- Onaylanmamış içerik yayınlanmaz; sunulan sayfa onaylananla birebir aynıdır.
--
-- Tarayıcıdan tabloya erişim YOK (RLS açık, politika yok); panel API'yi kullanır.
-- Görseller: 'clinic-sites' kovası, herkese açık OKUMA, yazma yalnız servis rolü
-- (API dosya türünü baytlardan doğrular, kurum klasörüne yazar).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.clinic_sites (
  organization_id   uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  subdomain         text UNIQUE CHECK (subdomain ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  template          text NOT NULL DEFAULT 'nebula' CHECK (template IN ('nebula', 'aurora', 'eclipse', 'rose')),
  accent            text NOT NULL DEFAULT '#fbbf24' CHECK (accent ~ '^#[0-9a-f]{6}$'),
  info              jsonb NOT NULL DEFAULT '{}'::jsonb,   -- adres, telefon, saatler, hakkımızda notları, sosyal
  logo_path         text,
  photos            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ path, alt }]
  content           jsonb,                                -- yapay zekâ metni (klinik düzenleyebilir)
  content_issues    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- sağlık iddiası denetimi bulguları
  generated_at      timestamptz,
  generations_day   date,
  generations_count integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_html    text,
  published_at      timestamptz,
  approved_by       uuid REFERENCES auth.users(id),
  approved_at       timestamptz,
  approval_note     text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinic_sites_published_idx ON public.clinic_sites (subdomain) WHERE status = 'published';

ALTER TABLE public.clinic_sites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_sites FROM anon, authenticated;
-- SQL Editor'da oluşturulan tabloya servis rolü yetkisi otomatik gelmez (0005, 0021):
GRANT SELECT, INSERT, UPDATE ON public.clinic_sites TO service_role;
-- Site üretimi hizmetleri okur:
GRANT SELECT ON public.services TO service_role;

-- Görseller: herkese açık okuma, 2 MB, yalnız JPEG/PNG/WebP (SVG yok: betik taşıyabilir)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clinic-sites', 'clinic-sites', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

COMMIT;
