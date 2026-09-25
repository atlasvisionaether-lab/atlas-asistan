-- ============================================================
-- 0004: Routing için organizasyon WhatsApp numarası.
-- Bu dosya Supabase'de uygulanır; GitHub kopyası referans amaçlıdır.
-- İdempotenttir (ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS).
-- ============================================================

-- Edge Function, gelen mesajın hangi kliniğe ait olduğunu To (alıcı numara)
-- üzerinden çözer. Production'da her kliniğin kendi WhatsApp numarası olur;
-- sandbox'ta demo org +14155238886 olarak seed edilir (bkz. 4B-3).
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

-- Numara→organizasyon eşlemesi benzersiz olmalı (bir numara iki kliniğe yazamaz).
-- Partial (WHERE NOT NULL): NULL satırları indekse almaz.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_whatsapp_number_idx
  ON public.organizations (whatsapp_number)
  WHERE whatsapp_number IS NOT NULL;
