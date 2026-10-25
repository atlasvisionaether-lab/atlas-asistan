-- 0017 geri alma. Self-servis kayıtla açılmış kurumlar SİLİNMEZ (veri kaybı olur).
BEGIN;
DROP FUNCTION IF EXISTS public.atlas_my_orders();
DROP FUNCTION IF EXISTS public.atlas_onboarding_status();
DROP FUNCTION IF EXISTS public.atlas_claim_clinic(text);
DROP FUNCTION IF EXISTS public.atlas_link_my_orders();
DROP INDEX IF EXISTS public.atlas_orders_organization_idx;
ALTER TABLE public.atlas_orders DROP COLUMN IF EXISTS organization_id;
COMMIT;
