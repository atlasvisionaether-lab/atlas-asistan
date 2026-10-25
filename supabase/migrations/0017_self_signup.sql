-- =============================================================================
-- Atlas Asistan — 0017: self-servis kayıt, kurulum ilerlemesi, sipariş geçmişi
--
-- Kayıt: tarayıcı supabase.auth.signUp ile hesap açar; ilk oturumda
-- atlas_claim_clinic(klinik_adı) çağrılır. Fonksiyon kullanıcının kurumu yoksa
-- organizations + users (role 'owner') satırlarını açar. Tarayıcı bunu tek
-- başına yapamaz: organizations_insert politikası zaten üye olmayı şart koşar.
-- Hesap başına bir kurum (users.id birincil anahtar). Davetle eklenen ekip
-- üyesinin users satırı zaten olduğu için fonksiyon onun kurumunu döndürür,
-- yeni kurum açmaz.
--
-- Sipariş bağlama: atlas_orders.organization_id. atlas_link_my_orders, e-postası
-- DOĞRULANMIŞ hesabın aynı e-postayla verilmiş, henüz bağlanmamış siparişlerini
-- kuruma bağlar (her girişte ve Kurulum/Abonelik ekranı açılışında). Doğrulanmamış e-postayla bağlama yok: aksi halde başkasının
-- e-postasıyla kayıt olan biri o kişinin fatura bilgilerini görürdü.
--
-- Kurulum adımları ayrı tabloda tutulmaz, mevcut veriden türetilir
-- (atlas_onboarding_status): bilgi = en az bir hizmet, ödeme = ödenmiş sipariş,
-- whatsapp = organizations.whatsapp_number, test = kuruma ait en az bir mesaj.
-- =============================================================================

BEGIN;

ALTER TABLE public.atlas_orders
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS atlas_orders_organization_idx ON public.atlas_orders (organization_id);

-- Kullanıcının doğrulanmış e-postasıyla verilmiş, henüz bağlanmamış siparişleri
-- kurumuna bağlar; bağlanan satır sayısını döndürür. Kayıttan sonra yapılan
-- ödemeler için panelin Kurulum/Abonelik ekranları her açılışta çağırır.
CREATE OR REPLACE FUNCTION public.atlas_link_my_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_email text;
  v_n     integer;
BEGIN
  SELECT u.organization_id, a.email INTO v_org, v_email
    FROM public.users u JOIN auth.users a ON a.id = u.id
   WHERE u.id = auth.uid() AND a.email_confirmed_at IS NOT NULL;
  IF v_org IS NULL OR v_email IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.atlas_orders
     SET organization_id = v_org, updated_at = now()
   WHERE organization_id IS NULL AND lower(email) = lower(v_email);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.atlas_claim_clinic(p_clinic_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_org   uuid;
  v_name  text := btrim(coalesce(p_clinic_name, ''));
  v_slug  text;
  v_full  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT organization_id INTO v_org FROM public.users WHERE id = v_uid;
  IF v_org IS NOT NULL THEN
    PERFORM public.atlas_link_my_orders();
    RETURN v_org;
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'clinic_name_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT nullif(btrim(raw_user_meta_data->>'full_name'), '') INTO v_full
    FROM auth.users WHERE id = v_uid;

  v_slug := btrim(regexp_replace(lower(translate(v_name, 'çğıöşüÇĞİÖŞÜ', 'cgiosuCGIOSU')), '[^a-z0-9]+', '-', 'g'), '-');
  v_slug := left(coalesce(nullif(v_slug, ''), 'klinik'), 40) || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  INSERT INTO public.organizations (name, slug, plan)
    VALUES (v_name, v_slug, 'trial')
    RETURNING id INTO v_org;

  INSERT INTO public.users (id, organization_id, role, full_name)
    VALUES (v_uid, v_org, 'owner', v_full);

  PERFORM public.atlas_link_my_orders();
  RETURN v_org;
END;
$$;

-- Kurulum ilerlemesi: dört adımın tamamlanıp tamamlanmadığı.
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
    o.whatsapp_number IS NOT NULL,
    EXISTS (SELECT 1 FROM public.messages m WHERE m.organization_id = o.id)
  FROM public.organizations o
  WHERE o.id = (SELECT u.organization_id FROM public.users u WHERE u.id = auth.uid())
$$;

-- Abonelik ve fatura geçmişi: yalnız sahip/yönetici; fatura bilgileri
-- (billing, adres, telefon) ve iyzico jeton özeti DÖNMEZ.
CREATE OR REPLACE FUNCTION public.atlas_my_orders()
RETURNS TABLE (id uuid, created_at timestamptz, plan text, kind text, amount_try integer,
               status text, sub_status text, paid_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT a.id, a.created_at, a.plan, a.kind, a.amount_try, a.status, a.sub_status, a.paid_at
    FROM public.atlas_orders a
    JOIN public.users u ON u.organization_id = a.organization_id
   WHERE u.id = auth.uid() AND u.role IN ('owner', 'manager')
   ORDER BY a.created_at DESC
   LIMIT 50
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_link_my_orders() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.atlas_claim_clinic(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.atlas_onboarding_status() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.atlas_my_orders() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.atlas_link_my_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_claim_clinic(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_onboarding_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_my_orders() TO authenticated;

COMMIT;
