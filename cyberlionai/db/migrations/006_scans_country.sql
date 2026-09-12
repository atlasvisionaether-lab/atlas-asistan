-- =============================================================================
-- Cyber Lion AI — 006: Tarama kaydına ülke sütunu
-- PostgreSQL 15+ / Supabase
--
-- NEDEN
--
-- Dünya haritası bugün yalnızca üçüncü taraf beslemelerini gösteriyor; kendi
-- tarama etkinliğimiz `ownActivity: { available: false }` ile boş duruyor
-- (bkz. api/worldmap.js). Sebep 003'te bilinçli olarak alınmış bir karardı:
-- `cl_scans` konum bilgisi tutmuyordu. Bu göç o boşluğu, gizlilik duruşunu
-- BOZMADAN kapatıyor.
--
-- GİZLİLİK SINIRI — bu sütunun ne olduğu kadar NE OLMADIĞI da önemli
--
--   saklanan     : ISO-2 ülke kodu (örn. 'TR', 'US')
--   saklanmayan  : IP adresi, çözümlenen adres listesi, ASN, şehir, koordinat
--
-- Host zaten 003'ten beri saklanıyor ve bu göç onu değiştirmiyor. Ülke,
-- tarama sırasında ZATEN yapılan DNS çözümünden türetiliyor (guard.js SSRF
-- koruması için hostu çözüyor); yani bu sütun için ek bir sorgu, ek bir
-- üçüncü taraf servisi ya da ek bir veri toplama YOK. Çözüm, kamu malı RIR
-- delegasyon tablosuyla yerelde yapılıyor.
--
-- Çözünürlük sınırı dürüstçe: RIR tablosu bir adresin KAYITLI OLDUĞU ülkeyi
-- verir, sunucunun fiziksel yerini değil. Arayüz bunu "barındırma konumu"
-- diye adlandırıyor; "kullanıcının ülkesi" DEĞİLDİR ve öyle sunulmamalıdır.
--
-- Geri alma: db/migrations/006_scans_country_down.sql
-- =============================================================================

BEGIN;

-- Nullable: 003'ten bu yana biriken kayıtlarda ülke yok ve geriye dönük
-- doldurulmayacak. Çözülemeyen adresler de (alan adı IPv6'ya çözülüyorsa ya
-- da RIR tablosunda yoksa) NULL kalır — uydurulmuş bir ülke, boş bir alandan
-- daha kötüdür.
ALTER TABLE public.cl_scans
  ADD COLUMN IF NOT EXISTS country TEXT;

-- Yalnızca ISO-2 büyük harf. Serbest metin girmesin: bu sütun haritada
-- doğrudan ülke koduna çevriliyor ve bozuk bir değer sessizce yanlış bir
-- işaret üretirdi.
ALTER TABLE public.cl_scans
  DROP CONSTRAINT IF EXISTS cl_scans_country_format;
ALTER TABLE public.cl_scans
  ADD CONSTRAINT cl_scans_country_format
  CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');

-- Harita sorgusu "ülkeye göre say" biçiminde; kısmi indeks NULL satırları
-- indeksin dışında tutuyor (bugün tablodaki kayıtların tamamı öyle).
CREATE INDEX IF NOT EXISTS cl_scans_country_idx
  ON public.cl_scans (country)
  WHERE country IS NOT NULL;

COMMENT ON COLUMN public.cl_scans.country IS
  'Taranan hostun KAYITLI OLDUĞU ülke (ISO-2), RIR delegasyon tablosundan '
  'türetilir. IP adresi saklanmaz. Kullanıcının ülkesi DEĞİLDİR.';

COMMIT;
