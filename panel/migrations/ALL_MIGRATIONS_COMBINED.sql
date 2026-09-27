-- ============================================================================
-- ALL_MIGRATIONS_COMBINED.sql
-- Atlas Asistan — 0001'den 0009'a tüm Supabase migration'larının birleşik hali.
-- Tarih sırasıyla: 0001_supabase_schema → 0002_roles_and_rls_hardening →
--   0003_whatsapp_identity → 0004_routing_whatsapp_number → 0005_service_role_grants
--   → 0006_first_touch_fullname_nullable → 0007_inbox_unread → 0008_appointments
--   → 0009_assistant_settings
--
-- Bu dosya İDEMPOTENT'tir: mevcut production veritabanında (0001–0008 uygulanmış)
-- tekrar çalıştırılabilir; yalnızca eksik kısımları uygular (ör. 0009).
-- Boş bir veritabanında da sırayla tamamını kurar.
--
-- ÖNEMLİ NOT — "organization_members does not exist" hatası:
-- Bu şemada organization_members veya org_members diye bir tablo YOKTUR.
-- Kullanıcı-organizasyon üyeliği users.organization_id kolonu üzerinden yürür
-- (0002'deki current_org_id() fonksiyonu da bu kolonu okur). Bu hata repodaki
-- dosyalardan değil, tabloyu referans alan repodışı bir SQL/sorgudan gelir.
-- Bu dosyayı çalıştırmak hatayı ancak sorgu users tablosunu kullanıyorsa giderir.
--
-- 0001_panel_schema.sql bu birleşimde yer almaz: o dosya tamamen yorum
-- bloğundan oluşan mimari taslaktır ("ASLA ÇALIŞTIRILMAZ" ibaresi vardır).
-- ============================================================================

-- ============================================================
-- 0001: Temel şema (organizations, users, customers, appointments,
--        messages, campaigns, automations) + RLS açık + ilk politika seti.
-- Orijinal dosya "TEKRAR ÇALIŞTIRMA" diyordu; burada idempotent hale getirildi:
-- CREATE TABLE IF NOT EXISTS ve politika öncesi DROP POLICY IF EXISTS eklendi.
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'trial',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'receptionist',
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  lead_status TEXT DEFAULT 'new',
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  content TEXT,
  risk_flag TEXT DEFAULT 'normal',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  audience_rule TEXT,
  state TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

-- 0001'in ilk politika seti (aşağıdaki 0002 bunları kaldırıp rol bazlı
-- politikalarla değiştirir; tarih sırası korunmak için burada tutuldu).
DROP POLICY IF EXISTS "Organizations: users can view their own" ON organizations;
CREATE POLICY "Organizations: users can view their own" ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Users: can view own org users" ON users;
CREATE POLICY "Users: can view own org users" ON users
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Customers: users can view their org customers" ON customers;
CREATE POLICY "Customers: users can view their org customers" ON customers
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Customers: users can insert their org customers" ON customers;
CREATE POLICY "Customers: users can insert their org customers" ON customers
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Appointments: users can view their org appointments" ON appointments;
CREATE POLICY "Appointments: users can view their org appointments" ON appointments
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Appointments: users can insert their org appointments" ON appointments;
CREATE POLICY "Appointments: users can insert their org appointments" ON appointments
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Messages: users can view their org messages" ON messages;
CREATE POLICY "Messages: users can view their org messages" ON messages
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Messages: users can insert their org messages" ON messages;
CREATE POLICY "Messages: users can insert their org messages" ON messages
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Campaigns: users can view their org campaigns" ON campaigns;
CREATE POLICY "Campaigns: users can view their org campaigns" ON campaigns
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Automations: users can view their org automations" ON automations;
CREATE POLICY "Automations: users can view their org automations" ON automations
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- ============================================================
-- 0002: users.role CHECK kısıtı, yardımcı fonksiyonlar ve rol bazlı RLS.
-- Orijinal dosyada ADD CONSTRAINT vardı; burada önce DROP CONSTRAINT IF
-- EXISTS ile guard'landı, politikalara DROP POLICY IF EXISTS eklendi.
-- Rol matrisi:
--   atlas_admin                  : tüm organizasyonlar, SELECT+INSERT+UPDATE+DELETE
--   owner / manager / consultant : kendi tenant'ının tüm tablolarında SELECT+INSERT+UPDATE
--   receptionist                 : yalnızca appointments ve messages tablolarında SELECT+INSERT
-- ============================================================

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'manager', 'receptionist', 'consultant', 'atlas_admin'));

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

-- 0001'deki 10 eski politikanın kaldırılması
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

-- organizations (tenant sütunu: id)
DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (
    (id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "organizations_insert" ON public.organizations;
CREATE POLICY "organizations_insert" ON public.organizations
  FOR INSERT WITH CHECK (
    (id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "organizations_update" ON public.organizations;
CREATE POLICY "organizations_update" ON public.organizations
  FOR UPDATE USING (
    (id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "organizations_delete" ON public.organizations;
CREATE POLICY "organizations_delete" ON public.organizations
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- users (tenant sütunu: organization_id)
DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "users_insert" ON public.users;
CREATE POLICY "users_insert" ON public.users
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "users_update" ON public.users;
CREATE POLICY "users_update" ON public.users
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "users_delete" ON public.users;
CREATE POLICY "users_delete" ON public.users
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- customers (tenant sütunu: organization_id)
DROP POLICY IF EXISTS "customers_select" ON public.customers;
CREATE POLICY "customers_select" ON public.customers
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "customers_insert" ON public.customers;
CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "customers_update" ON public.customers;
CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "customers_delete" ON public.customers;
CREATE POLICY "customers_delete" ON public.customers
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- appointments (tenant sütunu: organization_id; receptionist dahil)
DROP POLICY IF EXISTS "appointments_select" ON public.appointments;
CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant', 'receptionist'])
  );

DROP POLICY IF EXISTS "appointments_insert" ON public.appointments;
CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant', 'receptionist'])
  );

DROP POLICY IF EXISTS "appointments_update" ON public.appointments;
CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "appointments_delete" ON public.appointments;
CREATE POLICY "appointments_delete" ON public.appointments
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- messages (tenant sütunu: organization_id; receptionist dahil)
DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant', 'receptionist'])
  );

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant', 'receptionist'])
  );

DROP POLICY IF EXISTS "messages_update" ON public.messages;
CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "messages_delete" ON public.messages;
CREATE POLICY "messages_delete" ON public.messages
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- campaigns (tenant sütunu: organization_id)
DROP POLICY IF EXISTS "campaigns_select" ON public.campaigns;
CREATE POLICY "campaigns_select" ON public.campaigns
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "campaigns_insert" ON public.campaigns;
CREATE POLICY "campaigns_insert" ON public.campaigns
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "campaigns_update" ON public.campaigns;
CREATE POLICY "campaigns_update" ON public.campaigns
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "campaigns_delete" ON public.campaigns;
CREATE POLICY "campaigns_delete" ON public.campaigns
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- automations (tenant sütunu: organization_id)
DROP POLICY IF EXISTS "automations_select" ON public.automations;
CREATE POLICY "automations_select" ON public.automations
  FOR SELECT USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "automations_insert" ON public.automations;
CREATE POLICY "automations_insert" ON public.automations
  FOR INSERT WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "automations_update" ON public.automations;
CREATE POLICY "automations_update" ON public.automations
  FOR UPDATE USING (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  ) WITH CHECK (
    (organization_id = public.current_org_id() OR public.has_role(ARRAY['atlas_admin']))
    AND public.has_role(ARRAY['owner', 'manager', 'consultant'])
  );

DROP POLICY IF EXISTS "automations_delete" ON public.automations;
CREATE POLICY "automations_delete" ON public.automations
  FOR DELETE USING (public.has_role(ARRAY['atlas_admin']));

-- ============================================================
-- 0003: WhatsApp kimlik, opt-in ve idempotency kolonları (idempotent).
-- ============================================================

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS consent_channel TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS consent_source TEXT;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS twilio_sid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS customers_org_wa_idx
  ON public.customers (organization_id, wa_id)
  WHERE wa_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_twilio_sid_idx
  ON public.messages (twilio_sid)
  WHERE twilio_sid IS NOT NULL;

-- ============================================================
-- 0004: Routing için organizasyon WhatsApp numarası (idempotent).
-- ============================================================

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_whatsapp_number_idx
  ON public.organizations (whatsapp_number)
  WHERE whatsapp_number IS NOT NULL;

-- ============================================================
-- 0005: service_role için hedefli GRANT (Edge Function erişimi, idempotent).
-- ============================================================

GRANT SELECT ON public.organizations TO service_role;
GRANT SELECT, INSERT ON public.customers TO service_role;
GRANT INSERT ON public.messages TO service_role;

-- ============================================================
-- 0006: first-touch uyumu için customers.full_name nullable (idempotent).
-- ============================================================

ALTER TABLE public.customers ALTER COLUMN full_name DROP NOT NULL;

-- ============================================================
-- 0007: Gelen Kutusu için messages.unread kolonu ve index (idempotent).
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS unread BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS messages_inbox_idx
  ON public.messages (organization_id, unread DESC, created_at DESC);

-- ============================================================
-- 0008: Randevular için appointments ek kolonları ve gün index'i (idempotent).
-- ============================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS appointments_day_idx
  ON public.appointments (organization_id, starts_at);

-- ============================================================
-- 0009: AI Asistan Ayarları — assistant_settings + history (idempotent,
-- ENABLE RLS; politikalar organization_id = current_org_id() bazlı).
-- ============================================================

create table if not exists public.assistant_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  system_prompt text not null default 'Sen, Türkiye''deki bir güzellik merkezi için çalışan Atlas Asistan adlı asistansın. Kısa, kibar ve net yanıt ver. Randevu, hizmet, fiyat ve çalışma saatleri konularında yardımcı ol. Sağlık, teşhis veya tedavi taleplerinde yanıt verme; kullanıcıyı insan temsilciye yönlendir.',
  greeting_message text not null default 'Merhaba! Ben Atlas Asistan. Randevu ve hizmetler hakkında size yardımcı olabilirim.',
  fallback_message text not null default 'Bu soruya yanıt veremiyorum. Sizi ekibimize yönlendiriyorum; kısa süre içinde dönecekler.',
  model text not null default 'small' check (model in ('small','medium')),
  temperature double precision not null default 0.3 check (temperature >= 0 and temperature <= 1),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_settings_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  system_prompt text,
  greeting_message text,
  fallback_message text,
  model text,
  temperature double precision,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists assistant_settings_history_org_idx
  on public.assistant_settings_history (organization_id, created_at desc);

alter table public.assistant_settings enable row level security;
alter table public.assistant_settings_history enable row level security;

drop policy if exists assistant_settings_select on public.assistant_settings;
drop policy if exists assistant_settings_insert on public.assistant_settings;
drop policy if exists assistant_settings_update on public.assistant_settings;
create policy assistant_settings_select on public.assistant_settings
  for select using (organization_id = current_org_id());
create policy assistant_settings_insert on public.assistant_settings
  for insert with check (organization_id = current_org_id());
create policy assistant_settings_update on public.assistant_settings
  for update using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists assistant_settings_history_select on public.assistant_settings_history;
drop policy if exists assistant_settings_history_insert on public.assistant_settings_history;
create policy assistant_settings_history_select on public.assistant_settings_history
  for select using (organization_id = current_org_id());
create policy assistant_settings_history_insert on public.assistant_settings_history
  for insert with check (organization_id = current_org_id());

-- ============================================================
-- Şema önbelleğini yenile
-- ============================================================
NOTIFY pgrst, 'reload schema';
