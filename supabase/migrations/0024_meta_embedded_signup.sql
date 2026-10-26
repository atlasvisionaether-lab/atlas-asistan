-- =============================================================================
-- Atlas Asistan — 0024: Meta Embedded Signup (WhatsApp "tek tıkla bağla") + coexistence
--
-- 1) channel_connections.mode: 'manual' (klinik KENDİ Meta uygulaması, 0020)
--    ya da 'embedded' (Atlas'ın Tech Provider uygulaması; tek uygulama webhook'u,
--    imza Vercel'deki META_APP_SECRET ile). account_id = WhatsApp Business hesap
--    kimliği (WABA); Meta "PARTNER_REMOVED" bildirdiğinde bağlantı bununla bulunur.
-- 2) Giden mesaj tetikleyicisi: EKLENİRKEN external_id taşıyan mesaj sağlayıcıda
--    zaten teslim edilmiştir (ör. klinik çalışanının WhatsApp Business
--    uygulamasından gönderdiği "yankı") → yeniden GÖNDERİLMEZ. Asistanın ve
--    panelin giden mesajları external_id'siz eklenir; kimlik gönderimden sonra yazılır.
-- 3) atlas_channel_echo(): coexistence'ta kliniğin telefondan yazdığı mesaj
--    konuşmaya 'human' olarak eklenir ve o müşteri insana devredilir
--    (customers.is_handled_by_human = true → asistan susar; panelden geri alınır).
-- =============================================================================

BEGIN;

ALTER TABLE public.channel_connections ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'manual';
DO $$ BEGIN
  ALTER TABLE public.channel_connections ADD CONSTRAINT channel_connections_mode_check CHECK (mode IN ('manual', 'embedded'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.channel_connections ADD COLUMN IF NOT EXISTS account_id text;
CREATE INDEX IF NOT EXISTS channel_connections_account_idx
  ON public.channel_connections (channel, account_id) WHERE account_id IS NOT NULL;

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
  /* Sağlayıcıda zaten teslim edilmiş (yankı): tekrar gönderme. */
  IF NEW.external_id IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION public.atlas_channel_echo(
  p_org uuid, p_channel text, p_to text, p_text text, p_external_id text, p_ts timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust uuid;
  v_msg  uuid;
BEGIN
  IF p_channel <> 'whatsapp' OR coalesce(p_to, '') = '' OR coalesce(p_text, '') = '' OR coalesce(p_external_id, '') = '' THEN
    RAISE EXCEPTION 'invalid_echo' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_cust FROM public.customers
   WHERE organization_id = p_org
     AND ((external_channel = p_channel AND external_id = p_to) OR wa_id = p_to)
   ORDER BY (external_id IS NOT NULL) DESC
   LIMIT 1;

  IF v_cust IS NULL THEN
    INSERT INTO public.customers (organization_id, full_name, external_channel, external_id, phone, wa_id, consent_channel)
    VALUES (p_org, '+' || p_to, p_channel, p_to, '+' || p_to, p_to, p_channel)
    ON CONFLICT (organization_id, external_channel, external_id) WHERE external_id IS NOT NULL
      DO UPDATE SET external_id = EXCLUDED.external_id
    RETURNING id INTO v_cust;
  END IF;

  INSERT INTO public.messages (organization_id, customer_id, channel, direction, content, is_from_customer, sender_type, external_id, delivery_status, created_at)
  VALUES (p_org, v_cust, p_channel, 'out', p_text, false, 'human', p_external_id, 'sent', coalesce(p_ts, now()))
  ON CONFLICT (organization_id, channel, external_id) WHERE external_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_msg;

  /* Klinik konuşmayı telefondan devraldı: asistan bu müşteriye yanıt vermez. */
  IF v_msg IS NOT NULL THEN
    UPDATE public.customers SET is_handled_by_human = true WHERE id = v_cust;
  END IF;
  RETURN v_msg;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_channel_echo(uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_channel_outbound() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_channel_echo(uuid, text, text, text, text, timestamptz) TO service_role;

COMMIT;
