-- =============================================================================
-- Cyber Lion AI — 008 geri alma: alan adı sahipliği, tarama günlüğü, kötüye
-- kullanım bildirimi
--
-- DİKKAT: bu geri alma VERİ SİLER. Üç tablo da bu göçle doğdu; tabloyu
-- kaldırmadan şemayı geri almak mümkün değil. Silinen veri: doğrulanmış alan
-- adları (kullanıcılar yeniden doğrulamak zorunda kalır), tarama günlüğü
-- (izinsiz tarama iddiasında ispat kaybı) ve kötüye kullanım bildirimleri.
-- Uygulamadan önce scan_logs ve abuse_reports dışa aktarılmalı.
--
-- Uygulama kodu tablolar yokken güvenli tarafta kalır: doğrulama okunamazsa
-- alan adı doğrulanmamış sayılır ve aktif testler/düzeltme kapanır.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS public.abuse_reports;
DROP TABLE IF EXISTS public.scan_logs;
DROP TABLE IF EXISTS public.verified_domains;

COMMIT;
