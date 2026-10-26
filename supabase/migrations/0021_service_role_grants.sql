-- =============================================================================
-- Atlas Asistan — 0021: servis rolü yetkileri (0016, 0018, 0020 tabloları + yeni uçlar)
--
-- Kök sebep (0005 ile aynı): SQL Editor'da postgres rolüyle oluşturulan
-- tablolara Supabase'in otomatik GRANT'i bu projede uygulanmıyor; service_role
-- yetkisiz kalıyor → PostgREST 403 ("permission denied", 42501).
-- Belirti (2026-10-26): /api/atlas-channels → db_error_403, panelde
-- "Kanallar yüklenemedi". Aynı sebeple atlas_orders (ödeme siparişi) ve
-- atlas_guide_usage (rehber günlük sınırı) da yazılamıyordu.
--
-- Hedefli: yalnız Vercel uçlarının (api/) gerçekten yaptığı işlemler; ALL yok,
-- DELETE yok. anon/authenticated'a HİÇBİR yetki verilmez. İdempotent.
--
-- BUNDAN SONRA: SQL Editor'da tablo oluşturan her migration kendi
-- GRANT ... TO service_role satırını içermeli.
-- =============================================================================

BEGIN;

-- 0016 ödeme siparişleri: atlas-checkout (INSERT, jeton özeti UPDATE),
-- atlas-checkout-return (SELECT, settle UPDATE), abonelik webhook'u (UPDATE)
GRANT SELECT, INSERT, UPDATE ON public.atlas_orders TO service_role;

-- 0018 rehber kullanım sayacı: atlas-guide (SELECT sayım, INSERT)
GRANT SELECT, INSERT ON public.atlas_guide_usage TO service_role;
DO $$
DECLARE s text := pg_get_serial_sequence('public.atlas_guide_usage', 'id');
BEGIN
  IF s IS NOT NULL THEN EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', s); END IF;
END $$;

-- 0020 kanal bağlantıları: atlas-channels (SELECT, upsert = INSERT + UPDATE),
-- webhook (SELECT, doğrulamada UPDATE)
GRANT SELECT, INSERT, UPDATE ON public.channel_connections TO service_role;

-- Mevcut tablolar, yeni uçların ihtiyacı kadar:
--   messages  : atlas-channel-send gönderimi atomik alır ve sonucu yazar (SELECT + UPDATE)
--   customers : atlas-channel-send alıcının kanal kimliğini okur (SELECT)
--   users     : panel uçları jetondaki kullanıcının kurumunu/rolünü okur (SELECT)
--   organizations: atlas-guide klinik adını okur (SELECT; 0005'te var, tekrar zararsız)
GRANT SELECT, UPDATE ON public.messages TO service_role;
GRANT SELECT ON public.customers TO service_role;
GRANT SELECT ON public.users TO service_role;
GRANT SELECT ON public.organizations TO service_role;

COMMIT;
