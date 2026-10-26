-- 0024 geri alma: yankı RPC'si kalkar, giden mesaj tetikleyicisi 0020 haline döner.
-- DİKKAT: 'embedded' bağlantıların modu kaybolur; önce panelden bağlantılarını kesin.
BEGIN;
DROP FUNCTION IF EXISTS public.atlas_channel_echo(uuid, text, text, text, text, timestamptz);

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

DROP INDEX IF EXISTS public.channel_connections_account_idx;
ALTER TABLE public.channel_connections DROP CONSTRAINT IF EXISTS channel_connections_mode_check;
ALTER TABLE public.channel_connections DROP COLUMN IF EXISTS account_id;
ALTER TABLE public.channel_connections DROP COLUMN IF EXISTS mode;
COMMIT;
