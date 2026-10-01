-- ============================================================
-- 0011: Gelen Kutusu otomatik AI cevabı — kolonlar, RLS ve realtime.
-- Repo kopyası referans amaçlıdır; Supabase SQL editöründe tek kez uygulanır.
-- İdempotenttir (ADD COLUMN IF NOT EXISTS / DROP ... IF EXISTS).
-- ============================================================

-- 1) messages: gönderi yönü ve gönderen tipi.
--    Mevcut direction kolonu korunur; is_from_customer/sender_type
--    Edge Function ve webhook koşullarının tekil kaynağıdır.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_from_customer BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_type TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

--customers: son mesaj zamanı (Edge Function günceller)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NOW();

-- 2) Mevcut satırları geri doldur (idempotent):
--    direction 'out' → müşteriden değil (geri kalan her şey müşteriden).
UPDATE public.messages
  SET is_from_customer = false,
      sender_type = 'ai'
  WHERE direction = 'out' AND is_from_customer = true;

UPDATE public.messages
  SET is_from_customer = true,
      sender_type = 'customer'
  WHERE direction <> 'out' AND is_from_customer = false;

-- 3) Webhook tetikleyicisi koşulları için index:
--    (is_from_customer, channel) filtresi + created_at sıralaması.
CREATE INDEX IF NOT EXISTS messages_customer_channel_idx
  ON public.messages (organization_id, customer_id, is_from_customer, created_at DESC);

-- 4) RLS: mevcut messages politikaları (0002) korunur.
--    Edge Function service_role ile RLS bypass eder; ek politika gerekmez.
--    Panel (authenticated) INSERT için yalnızca kendi org'una yazabilir (0002).

-- 5) Realtime: panel inbox'ı postgres_changes INSERT dinler.
--    messages tablosunu publication'a ekle (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- 6) NOT: Edge Function çağrısı Supabase Dashboard üzerinden Database Webhook olarak
--    tanımlanır (SQL ile değil, dashboard'da yönetilir):
--
--    Dashboard > Database > Webhooks > Create webhook
--      Name:            atlas-auto-reply-webhook
--      Table:           messages
--      Events:          Insert
--      Trigger type:    Supabase Function
--      Function:        atlas-auto-reply
--      Webhook payload: Default (record)
--
--    Koşul kontrolü Edge Function içinde yapılır:
--      channel IN ('whatsapp','web_widget') AND is_from_customer = true
--
--    Alternatif (SQL ile): supabase_functions.http_request ile pg_net
--    tetikleyicisi kurulabilir; dashboard webhook'u tercih edilir.
