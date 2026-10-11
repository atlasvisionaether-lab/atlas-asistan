-- =============================================================================
-- Atlas Asistan — 0015 geri alma: RLS'i kapat
--
-- DİKKAT: bu, anon anahtarıyla tüm satırlara erişimi YENİDEN AÇAR. Yalnızca
-- panel bozulursa ve kök sebep bulunana kadar kısa süre için kullanın.
-- Veri silmez.
-- =============================================================================

BEGIN;

ALTER TABLE public.organizations              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.services                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_settings         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_settings_history DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations, public.users, public.customers,
  public.messages, public.appointments, public.services, public.campaigns, public.automations,
  public.assistant_settings, public.assistant_settings_history TO anon;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO anon;
GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO anon;

DROP POLICY IF EXISTS services_tenant ON public.services;
DROP POLICY IF EXISTS users_org_select ON public.users;

COMMIT;
