-- ============================================================
-- Otomatik cevap testi: karşılama + mesai dışı mesajı (WhatsApp numarası olmadan).
-- Supabase SQL Editor'de TEK SEFERDE çalıştırılır (~30 sn sürer). Migration değildir.
--
-- Gerçek kliniğe DOKUNMAZ: geçici "TEST — Otomatik Cevap" kurumu, kendi ayarları
-- ve iki test müşterisi açılır. Müşteri mesajı eklemek gerçek WhatsApp mesajıyla
-- aynı yolu izler: on_message_insert tetikleyicisi → atlas-auto-reply.
-- Cevaplar yalnız veritabanına yazılır; hiçbir numaraya mesaj GİTMEZ.
-- Webhook işlem COMMIT edilince gider; adımlar bu yüzden COMMIT + bekleme ile ayrık.
--
-- Temizlik: supabase/test-auto-reply-cleanup.sql
-- ============================================================

-- ADIM 0: test kurumu (mesai 00:00–23:59 = açık), ayarlar, iki müşteri
BEGIN;
INSERT INTO public.organizations (id, name, slug, plan)
VALUES ('00000000-0000-4000-a000-0000000a7e57', 'TEST — Otomatik Cevap', 'test-otomatik-cevap-a7e57', 'trial')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.assistant_settings (organization_id, greeting_message, after_hours_message, fallback_message, working_hours, auto_reply_enabled)
VALUES ('00000000-0000-4000-a000-0000000a7e57', 'TEST KARŞILAMA: Hoş geldiniz!', 'TEST MESAİ DIŞI: Şu an kapalıyız.', 'TEST FALLBACK',
        '{"start":"00:00","end":"23:59"}'::jsonb, true)
ON CONFLICT (organization_id) DO UPDATE SET
  greeting_message = EXCLUDED.greeting_message, after_hours_message = EXCLUDED.after_hours_message,
  fallback_message = EXCLUDED.fallback_message, working_hours = EXCLUDED.working_hours, auto_reply_enabled = true;

INSERT INTO public.customers (id, organization_id, full_name) VALUES
  ('00000000-0000-4000-a000-0000000c0001', '00000000-0000-4000-a000-0000000a7e57', 'TEST Müşteri 1 (mesai içi)'),
  ('00000000-0000-4000-a000-0000000c0002', '00000000-0000-4000-a000-0000000a7e57', 'TEST Müşteri 2 (mesai dışı)')
ON CONFLICT (id) DO NOTHING;
COMMIT;

-- ADIM 1: yeni müşteri yalnız selam verir → beklenen: YALNIZ karşılama
BEGIN;
INSERT INTO public.messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type)
VALUES ('00000000-0000-4000-a000-0000000a7e57', '00000000-0000-4000-a000-0000000c0001', 'whatsapp', 'in', 'Merhaba', true, 'customer');
COMMIT;
SELECT pg_sleep(8);

-- ADIM 2: aynı müşteri soru sorar → beklenen: karşılama TEKRAR YOK, asistan cevabı
BEGIN;
INSERT INTO public.messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type)
VALUES ('00000000-0000-4000-a000-0000000a7e57', '00000000-0000-4000-a000-0000000c0001', 'whatsapp', 'in', 'Lazer epilasyon ne kadar?', true, 'customer');
COMMIT;
SELECT pg_sleep(10);

-- ADIM 3: mesai kapalı (00:00–00:00), yeni müşteri yazar → beklenen: YALNIZ mesai dışı mesajı
BEGIN;
UPDATE public.assistant_settings SET working_hours = '{"start":"00:00","end":"00:00"}'::jsonb
 WHERE organization_id = '00000000-0000-4000-a000-0000000a7e57';
COMMIT;
BEGIN;
INSERT INTO public.messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type)
VALUES ('00000000-0000-4000-a000-0000000a7e57', '00000000-0000-4000-a000-0000000c0002', 'whatsapp', 'in', 'Merhaba', true, 'customer');
COMMIT;
SELECT pg_sleep(8);

-- SONUÇ: konuşmalar sırayla (editör yalnız bu son sorgunun sonucunu gösterir)
SELECT c.full_name AS musteri,
       CASE WHEN m.is_from_customer THEN '→ müşteri' ELSE '← asistan' END AS yon,
       m.content AS mesaj,
       (c.greeted_at IS NOT NULL) AS karsilandi,
       to_char(m.created_at AT TIME ZONE 'Europe/Istanbul', 'HH24:MI:SS') AS saat
  FROM public.messages m
  JOIN public.customers c ON c.id = m.customer_id
 WHERE m.organization_id = '00000000-0000-4000-a000-0000000a7e57'
 ORDER BY c.full_name, m.created_at;
