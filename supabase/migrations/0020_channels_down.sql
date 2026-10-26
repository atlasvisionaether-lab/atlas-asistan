-- 0020 geri alma. DİKKAT: kanal bağlantıları (şifreli jetonlar) silinir; müşteri ve
-- mesajlar KALIR (yalnız eklenen kimlik/teslim sütunları kaldırılır).
BEGIN;
DROP TRIGGER IF EXISTS on_message_outbound ON public.messages;
DROP FUNCTION IF EXISTS public.atlas_channel_outbound();
DROP FUNCTION IF EXISTS public.atlas_check_send_secret(text);
DROP FUNCTION IF EXISTS public.atlas_channel_inbound(uuid, text, text, text, text, text, timestamptz);
DROP TABLE IF EXISTS private.app_settings;
DROP TABLE IF EXISTS public.channel_connections;
DROP INDEX IF EXISTS public.messages_org_channel_external_idx;
DROP INDEX IF EXISTS public.customers_org_external_idx;
ALTER TABLE public.messages DROP COLUMN IF EXISTS delivered_at, DROP COLUMN IF EXISTS delivery_error,
  DROP COLUMN IF EXISTS delivery_status, DROP COLUMN IF EXISTS external_id;
ALTER TABLE public.customers DROP COLUMN IF EXISTS external_id, DROP COLUMN IF EXISTS external_channel;
-- atlas_onboarding_status 0017'deki tanımına döner:
CREATE OR REPLACE FUNCTION public.atlas_onboarding_status()
RETURNS TABLE (info boolean, payment boolean, whatsapp boolean, test boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.services s WHERE s.organization_id = o.id),
    EXISTS (SELECT 1 FROM public.atlas_orders a WHERE a.organization_id = o.id AND a.status = 'paid'),
    o.whatsapp_number IS NOT NULL,
    EXISTS (SELECT 1 FROM public.messages m WHERE m.organization_id = o.id)
  FROM public.organizations o
  WHERE o.id = (SELECT u.organization_id FROM public.users u WHERE u.id = auth.uid())
$$;
COMMIT;
