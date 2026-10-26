-- =============================================================================
-- Atlas Asistan — 0020: çok kanallı asistan (Telegram, WhatsApp Cloud API, Instagram)
--
-- Akış:
--   gelen  : /api/atlas-channel-webhook?c=<bağlantı> → imza doğrulanır →
--            atlas_channel_inbound() müşteriyi bulur/açar, mesajı BİR KEZ yazar →
--            on_message_insert (0012) → atlas-auto-reply cevabı yazar
--   giden  : messages'a kanal mesajı (asistan ya da panelden elle) → bu dosyadaki
--            on_message_outbound → pg_net → /api/atlas-channel-send → kanal
--
-- Kurum izolasyonu: bağlantı kliniğe özel webhook adresiyle bulunur; kurum
-- kimliği istekten değil bağlantı satırından gelir. Bir bot/numara/hesap aynı
-- anda yalnız bir kuruma bağlanabilir (benzersiz indeks).
--
-- Gizli değerler: channel_connections.secrets uygulamada AES-256-GCM ile
-- şifreli (CHANNEL_ENC_KEY). Gönderim ucunun paylaşılan gizli değeri burada
-- üretilir (private.app_settings; API'ye açık değil) ve uç onu
-- atlas_check_send_secret() ile doğrular — Vercel'e kopyalanmaz.
-- Tarayıcıdan bu tablolara erişim YOK (panel /api/atlas-channels'ı kullanır).
-- =============================================================================

BEGIN;

-- 1) Bağlantılar ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channel_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'instagram')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error', 'disconnected')),
  external_id     text,          -- Telegram bot id / WhatsApp phone_number_id / Instagram hesap id
  display_name    text,          -- @bot / "Klinik · +90 …" / @instagram
  secrets         text,          -- şifreli JSON (jetonlar, App Secret)
  webhook_secret  text NOT NULL, -- Telegram secret_token / Meta verify token
  last_error      text,
  connected_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, channel)
);
CREATE UNIQUE INDEX IF NOT EXISTS channel_connections_external_idx
  ON public.channel_connections (channel, external_id)
  WHERE external_id IS NOT NULL AND status IN ('pending', 'connected');
ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.channel_connections FROM anon, authenticated;

-- 2) Müşteri ve mesajın kanal kimlikleri ---------------------------------------
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS external_channel text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS customers_org_external_idx
  ON public.customers (organization_id, external_channel, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivery_error text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS messages_org_channel_external_idx
  ON public.messages (organization_id, channel, external_id) WHERE external_id IS NOT NULL;

-- 3) messages.channel'da kısıt varsa 'telegram' ve 'instagram'ı kapsayacak şekilde
--    yenile (repoda tanımlı değil; canlıda elle eklenmiş olabilir). Var olan
--    değerler korunur.
DO $$
DECLARE r record; vals text;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.messages'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%channel%' LOOP
    EXECUTE format('ALTER TABLE public.messages DROP CONSTRAINT %I', r.conname);
    SELECT string_agg(quote_literal(v), ',') INTO vals FROM (
      SELECT DISTINCT channel AS v FROM public.messages WHERE channel IS NOT NULL
      UNION SELECT unnest(ARRAY['whatsapp', 'web_widget', 'instagram', 'telegram'])
    ) s;
    EXECUTE 'ALTER TABLE public.messages ADD CONSTRAINT messages_channel_check CHECK (channel IN (' || vals || '))';
  END LOOP;
END $$;

-- 4) Gelen mesaj: müşteriyi bul/aç, mesajı BİR KEZ yaz. Tekrarda NULL döner.
CREATE OR REPLACE FUNCTION public.atlas_channel_inbound(
  p_org uuid, p_channel text, p_from text, p_name text, p_text text, p_external_id text, p_ts timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust uuid;
  v_msg  uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
BEGIN
  IF p_channel NOT IN ('telegram', 'whatsapp', 'instagram') OR coalesce(p_from, '') = '' OR coalesce(p_text, '') = '' THEN
    RAISE EXCEPTION 'invalid_inbound' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_cust FROM public.customers
   WHERE organization_id = p_org
     AND ((external_channel = p_channel AND external_id = p_from)
          OR (p_channel = 'whatsapp' AND wa_id = p_from))      -- eski (Twilio) WhatsApp müşterisi
   ORDER BY (external_id IS NOT NULL) DESC
   LIMIT 1;

  IF v_cust IS NULL THEN
    INSERT INTO public.customers (organization_id, full_name, external_channel, external_id, phone, wa_id, consent_channel)
    VALUES (p_org,
            coalesce(v_name, CASE p_channel WHEN 'whatsapp' THEN '+' || p_from
                                            WHEN 'telegram' THEN 'Telegram kullanıcısı'
                                            ELSE 'Instagram kullanıcısı' END),
            p_channel, p_from,
            CASE WHEN p_channel = 'whatsapp' THEN '+' || p_from END,
            CASE WHEN p_channel = 'whatsapp' THEN p_from END,
            p_channel)
    ON CONFLICT (organization_id, external_channel, external_id) WHERE external_id IS NOT NULL
      DO UPDATE SET external_id = EXCLUDED.external_id
    RETURNING id INTO v_cust;
  ELSE
    UPDATE public.customers
       SET external_channel = p_channel, external_id = p_from
     WHERE id = v_cust AND external_id IS NULL;
  END IF;

  INSERT INTO public.messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type, external_id, created_at)
  VALUES (p_org, v_cust, p_channel, 'in', p_text, true, 'customer', p_external_id, coalesce(p_ts, now()))
  ON CONFLICT (organization_id, channel, external_id) WHERE external_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_msg;

  IF v_msg IS NOT NULL THEN
    UPDATE public.customers SET last_message_at = now() WHERE id = v_cust;
  END IF;
  RETURN v_msg;
END;
$$;

-- 5) Gönderim ucunun paylaşılan gizli değeri (API'ye açık olmayan şemada) -----
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.app_settings (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO private.app_settings (key, value) VALUES
  ('channel_send_secret', encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex')),
  ('channel_send_url', 'https://atlasasistan.com/api/atlas-channel-send')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.atlas_check_send_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(length(p_secret) >= 32 AND p_secret = (SELECT value FROM private.app_settings WHERE key = 'channel_send_secret'), false)
$$;

-- 6) Giden mesaj tetikleyicisi: yalnız bağlı bir kanalın giden mesajı ---------
CREATE OR REPLACE FUNCTION public.atlas_channel_outbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_from_customer IS DISTINCT FROM false OR NEW.channel NOT IN ('telegram', 'whatsapp', 'instagram') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channel_connections c
                  WHERE c.organization_id = NEW.organization_id AND c.channel = NEW.channel AND c.status = 'connected') THEN
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url := (SELECT value FROM private.app_settings WHERE key = 'channel_send_url'),
    body := jsonb_build_object('message_id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'X-Atlas-Secret', (SELECT value FROM private.app_settings WHERE key = 'channel_send_secret'))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_message_outbound ON public.messages;
CREATE TRIGGER on_message_outbound
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.atlas_channel_outbound();

-- 7) Kurulum: "WhatsApp" adımı artık herhangi bir kanalın bağlanmasıyla tamamlanır
--    (eski Twilio numarası da sayılır). Sütun adı panel uyumu için aynı.
CREATE OR REPLACE FUNCTION public.atlas_onboarding_status()
RETURNS TABLE (info boolean, payment boolean, whatsapp boolean, test boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.services s WHERE s.organization_id = o.id),
    EXISTS (SELECT 1 FROM public.atlas_orders a WHERE a.organization_id = o.id AND a.status = 'paid'),
    o.whatsapp_number IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.channel_connections c WHERE c.organization_id = o.id AND c.status = 'connected'),
    EXISTS (SELECT 1 FROM public.messages m WHERE m.organization_id = o.id)
  FROM public.organizations o
  WHERE o.id = (SELECT u.organization_id FROM public.users u WHERE u.id = auth.uid())
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_channel_inbound(uuid, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_check_send_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_channel_outbound() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_channel_inbound(uuid, text, text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.atlas_check_send_secret(text) TO service_role;

COMMIT;
