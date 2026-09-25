-- ============================================================
-- 0003: WhatsApp kimlik, opt-in ve idempotency kolonları.
-- Bu dosya Supabase'de uygulanır; GitHub kopyası referans amaçlıdır.
-- İdempotenttir (ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS).
-- ============================================================

-- customers: WhatsApp kimliği + opt-in kaynağı
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS consent_channel TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS consent_source TEXT;

-- messages: kaynak WhatsApp kimliği + Twilio SID (retry dedup)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS twilio_sid TEXT;

-- Tenant bazlı WhatsApp kimliği benzersizliği.
-- Composite (organization_id + wa_id): aynı kişi iki klinikte ayrı müşteri olabilir.
-- Partial (WHERE NOT NULL): mevcut/NULL satırları indekse almaz, anlamsal netlik.
CREATE UNIQUE INDEX IF NOT EXISTS customers_org_wa_idx
  ON public.customers (organization_id, wa_id)
  WHERE wa_id IS NOT NULL;

-- Twilio SID benzersizliği: aynı mesaj retry'da iki kez yazılmaz (idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS messages_twilio_sid_idx
  ON public.messages (twilio_sid)
  WHERE twilio_sid IS NOT NULL;
