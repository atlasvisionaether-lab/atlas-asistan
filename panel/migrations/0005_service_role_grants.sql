-- ============================================================
-- 0005: service_role için hedefli GRANT (Edge Function erişimi).
-- Bu dosya Supabase'de uygulanır; GitHub kopyası referans amaçlıdır.
-- Kök sebep: 0001-0004 migration'ları SQL Editor'da postgres rolüyle
--   yaratıldığı için Supabase'in otomatik GRANT hook'u devreye girmedi;
--   service_role'e tablo yetkisi hiç verilmedi. Sonuç: webhook'ta
--   "permission denied for table organizations" (42501).
-- Hedefli: yalnızca twilio-webhook-handler'ın ihtiyaç duyduğu işlemler.
--   Körükörüne ALL YOK. İdempotent (GRANT tekrarlanabilir, no-op).
-- ============================================================

-- organizations: fonksiyon routing için SELECT yapar.
GRANT SELECT ON public.organizations TO service_role;

-- customers: fonksiyon first-touch INSERT + dup kontrolü SELECT yapar.
GRANT SELECT, INSERT ON public.customers TO service_role;

-- messages: fonksiyon yalnızca INSERT yapar.
GRANT INSERT ON public.messages TO service_role;
