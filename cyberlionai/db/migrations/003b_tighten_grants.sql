-- =============================================================================
-- Cyber Lion AI — 003b: cl_scans yetki sıkılaştırması (derinlemesine savunma)
--
-- Supabase, public şemasındaki tablolara anon ve authenticated rolleri için
-- varsayılan GRANT verir. Erişimi RLS engelliyor olsa da gereksiz yetkiler
-- geri alınır: ileride bir politika hatası tek başına veriyi açığa çıkarmasın.
--
-- Doğrulandı (rol taklidi + rollback ile):
--   anon                       → permission denied for table cl_scans
--   authenticated (uid yok)    → 0 satır
--   authenticated (başka uid)  → yalnızca kendi kaydı
--   service_role               → tam erişim (yalnızca sunucu ucu kullanır)
-- =============================================================================

BEGIN;

REVOKE ALL ON public.cl_scans FROM anon;

REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.cl_scans FROM authenticated;
-- authenticated'da yalnızca SELECT ve DELETE kalır; ikisi de RLS politikasıyla
-- "yalnızca kendi kaydı" şartına bağlıdır.

GRANT SELECT, INSERT, DELETE ON public.cl_scans TO service_role;

COMMIT;
