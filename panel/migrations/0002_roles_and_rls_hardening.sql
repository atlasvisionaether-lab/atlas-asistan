-- Bu migration Supabase'de uygulanmıştır. GitHub'daki kopya referans amaçlıdır.
-- TEKRAR ÇALIŞTIRMA (idempotent değildir; DROP POLICY IF EXISTS hariç).
--
-- 0002: users.role CHECK kısıtı, yardımcı fonksiyonlar ve rol bazlı RLS.
--
-- Rol matrisi:
--   atlas_admin                  : tüm organizasyonlar, SELECT+INSERT+UPDATE+DELETE
--   owner / manager / consultant : kendi tenant'ının tüm tablolarında SELECT+INSERT+UPDATE
--   receptionist                 : yalnızca appointments ve messages tablolarında SELECT+INSERT

-- ============================================================
-- 1) users.role CHECK kısıtı
-- ============================================================
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'manager', 'receptionist', 'consultant', 'atlas_admin'));

-- ============================================================
-- 2) Yardımcı fonksiyonlar (SECURITY DEFINER, STABLE)
-- ============================================================

-- Aktif kullanıcının organization_id'si; atlas_admin için NULL döner.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN u.role = 'atlas_admin' THEN NULL
    ELSE u.organization_id
  END
  FROM public.users AS u
  WHERE u.id = auth.uid()
$$;

-- Aktif kullanıcının rolü allowed dizisindeyse true; atlas_admin her zaman true.
CREATE OR REPLACE FUNCTION public.has_role(allowed TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS u
    WHERE u.id = auth.uid()
      AND (u.role = 'atlas_admin' OR u.role = ANY (allowed))
  )
$$;

-- ============================================================
-- 3) 0001'deki 10 eski politikanın kaldırılması
-- ============================================================
DROP POLICY IF EXISTS "Organizations: users can view their own" ON public.organizations;
DROP POLICY IF EXISTS "Users: can view own org users" ON public.users;
DROP POLICY IF EXISTS "Customers: users can view their org customers" ON public.customers;
DROP POLICY IF EXISTS "Customers: users can insert their org customers" ON public.customers;
DROP POLICY IF EXISTS "Appointments: users can view their org appointments" ON public.appointments;
DROP POLICY IF EXISTS "Appointments: users can insert their org appointments" ON public.appointments;
DROP POLICY IF EXISTS "Messages: users can view their org messages" ON public.messages;
DROP POLICY IF EXISTS "Messages: users can insert their org messages" ON public.messages;
DROP POLICY IF EXISTS "Campaigns: users can view their org campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Automations: users can view their org automations" ON public.automations;

-- ============================================================
-- 4) Yeni rol bazlı politikalar
-- Tenant koşulu: satır kullanıcının organizasyonuna ait OLAN atlas_admin.
-- ============================================================

-- ------------------------------------------------------------
-- organizations (tenant sütunu: id)
-- ------------------------------------------------------------
CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (
    (id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "organizations_insert" ON public.organizations
  FOR INSERT WITH CHECK (
    (id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "organizations_update" ON public.organizations
  FOR UPDATE USING (
    (id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "organizations_delete" ON public.organizations
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- ------------------------------------------------------------
-- users (tenant sütunu: organization_id)
-- ------------------------------------------------------------
CREATE POLICY "users_select" ON public.users
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "users_insert" ON public.users
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "users_update" ON public.users
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "users_delete" ON public.users
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- ------------------------------------------------------------
-- customers (tenant sütunu: organization_id)
-- ------------------------------------------------------------
CREATE POLICY "customers_select" ON public.customers
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "customers_delete" ON public.customers
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- ------------------------------------------------------------
-- appointments (tenant sütunu: organization_id; receptionist dahil)
-- ------------------------------------------------------------
CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant', 'receptionist'])
  );

CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant', 'receptionist'])
  );

CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "appointments_delete" ON public.appointments
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- ------------------------------------------------------------
-- messages (tenant sütunu: organization_id; receptionist dahil)
-- ------------------------------------------------------------
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant', 'receptionist'])
  );

CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant', 'receptionist'])
  );

CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "messages_delete" ON public.messages
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- ------------------------------------------------------------
-- campaigns (tenant sütunu: organization_id)
-- ------------------------------------------------------------
CREATE POLICY "campaigns_select" ON public.campaigns
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "campaigns_insert" ON public.campaigns
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "campaigns_update" ON public.campaigns
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "campaigns_delete" ON public.campaigns
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- ------------------------------------------------------------
-- automations (tenant sütunu: organization_id)
-- ------------------------------------------------------------
CREATE POLICY "automations_select" ON public.automations
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "automations_insert" ON public.automations
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "automations_update" ON public.automations
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

CREATE POLICY "automations_delete" ON public.automations
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));
