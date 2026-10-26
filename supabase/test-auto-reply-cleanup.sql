-- test-auto-reply-greeting.sql'in açtığı TEST kurumunu ve her şeyini siler
-- (ayarlar, müşteriler, mesajlar kurumla birlikte silinir: ON DELETE CASCADE).
-- Yalnız sabit test kimliğine dokunur; gerçek kliniklere dokunmaz.
DELETE FROM public.organizations WHERE id = '00000000-0000-4000-a000-0000000a7e57';
SELECT count(*) AS kalan_test_satiri FROM public.customers WHERE organization_id = '00000000-0000-4000-a000-0000000a7e57';
