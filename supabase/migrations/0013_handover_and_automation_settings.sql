-- ============================================================
-- 0013: İnsan devralma kolonları + otomasyon ayarları.
-- Repo kopyası referans amaçlıdır; Supabase SQL editöründe uygulanır.
-- İdempotenttir (ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- 1) İnsana aktarma (FAZ 3):
--    messages.handover_requested: ilgili mesaj için devralma talebi
--    customers.is_handled_by_human: müşteri şu an insan temsilcide
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS handover_requested BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_handled_by_human BOOLEAN NOT NULL DEFAULT false;

-- İnsan devralma sonrası AI otomatik cevabı durdursun diye hızlı kontrol index'i:
CREATE INDEX IF NOT EXISTS messages_handover_idx
  ON public.messages (customer_id, handover_requested, created_at DESC);

-- 2) Otomasyon ayarları (FAZ 4):
--    auto_reply_enabled: AI otomatik cevabı ana anahtarı
--    working_hours: {"start":"09:00","end":"18:00"} jsonb
ALTER TABLE public.assistant_settings
  ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.assistant_settings
  ADD COLUMN IF NOT EXISTS working_hours JSONB NOT NULL DEFAULT '{"start":"09:00","end":"18:00"}'::jsonb;

-- NOT: auto_reply_enabled=false iken Edge Function cevap ÜRETMEZ;
-- bu kolonun kontrolü edge function'da ayrıca eklenmelidir (u.c. bu PR kapsamında
-- panel + kolon hazırlanır; Edge Function davranışı sonraki adımda bağlanır).
