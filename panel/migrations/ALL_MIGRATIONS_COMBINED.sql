-- ============================================================
-- ALL_MIGRATIONS_COMBINED.sql — Atlas Asistan tek dosya kurulum
-- 0001_supabase → 0009 tarih sırasına göre birleştirilmiştir.
--
-- İDempotent hale getirilmiştir; mevcut bir Supabase projesinde
-- güvenle çalıştırılabilir:
--   - CREATE TABLE / INDEX / ADD COLUMN → IF NOT EXISTS
--   - Her CREATE POLICY öncesinde DROP POLICY IF EXISTS eklenmiştir
--   - ADD CONSTRAINT, DO $$ ... $$ varlık kontrolüyle sarılmıştır
--
-- NOT 1: 0001_panel_schema.sql bu dosyaya DAHİL EDİLMEMİŞTİR;
--        o dosya tamamen yorum satırıdır ("ASLA ÇALIŞTIRILMAZ", mimari taslak).
-- NOT 2: Repodaki hiçbir migration "organization_members" veya "org_members"
--        tablosuna referans vermez; current_org_id() yalnızca public.users
--        tablosunu kullanır. "organization_members does not exist" hatası
--        repodaki migration'lardan gelmiyorsa (ör. elle çalıştırılmış geçici
--        SQL veya Supabase dashboard'de tanımlı bir policy), bu dosya o
--        hatayı düzeltmez; söz konusu referansın kaldırılması gerekir.
-- ============================================================


-- ============================================================
-- 0001_supabase_schema.sql
-- ============================================================

-- ============================================================
-- REFERANS: Bu şema Supabase'de zaten çalıştırıldı.
-- Bu dosya sadece GitHub'da referans olarak tutulur.
-- TEKRAR ÇALIŞTIRMA.
-- ============================================================

-- Atlas Asistan Panel Şeması
-- Multi-tenant SaaS yapısı: her klinik kendi verisini görür

-- 1. Organizasyonlar (klinikler/güzellik merkezleri)
create table if not exists organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'trial',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Kullanıcılar (klinik çalışanları)
create table if not exists users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'receptionist',
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Müşteriler (klinik müşterileri)
create table if not exists customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  lead_status TEXT DEFAULT 'new',
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Randevular
create table if not exists appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Mesajlar (WhatsApp/Instagram gelen kutusu)
create table if not exists messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  content TEXT,
  risk_flag TEXT DEFAULT 'normal',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Kampanyalar
create table if not exists campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  audience_rule TEXT,
  state TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Otomasyonlar
create table if not exists automations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) Politikaları
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

-- Organizasyon politikaları
CREATE POLICY "Organizations: users can view their own" ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Kullanıcı politikaları
CREATE POLICY "Users: can view own org users" ON users
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Müşteri politikaları
CREATE POLICY "Customers: users can view their org customers" ON customers
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Customers: users can insert their org customers" ON customers
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Randevu politikaları
CREATE POLICY "Appointments: users can view their org appointments" ON appointments
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Appointments: users can insert their org appointments" ON appointments
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Mesaj politikaları
CREATE POLICY "Messages: users can view their org messages" ON messages
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Messages: users can insert their org messages" ON messages
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Kampanya politikaları
CREATE POLICY "Campaigns: users can view their org campaigns" ON campaigns
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Otomasyon politikaları
CREATE POLICY "Automations: users can view their org automations" ON automations
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- ============================================================
-- 0002_roles_and_rls_hardening.sql
-- ============================================================

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
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_role_check') then
    ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'manager', 'receptionist', 'consultant', 'atlas_admin'));
  end if;
end $$;

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

-- ============================================================
-- 0003_whatsapp_identity_and_idempotency.sql
-- ============================================================

-- ============================================================
-- 0003: WhatsApp kimlik, opt-in ve idempotency kolonları.
-- Bu dosya Supabase'de uygulanır; GitHub kopyası referans amaçlıdır.
-- İdempotenttir (ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS).
-- ============================================================

-- customers: WhatsApp kimliği + opt-in kaynağı
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS consent_channel TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS consent_source TEXT;

-- messages: kaynak WhatsApp kimliği + Twilio SID (retry dedup)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS twilio_sid TEXT;

-- Tenant bazlı WhatsApp kimliği benzersizliği.
-- Composite (organization_id + wa_id): aynı kişi iki klinikte ayrı müşteri olabilir.
-- Partial (WHERE NOT NULL): mevcut/NULL satırları indekse almaz, anlamsal netlik.
CREATE UNIQUE INDEX IF NOT EXISTS customers_org_wa_idx
  ON public.customers (organization_id, wa_id)
  WHERE wa_id IS NOT NULL;

-- Twilio SID benzersizliği: aynı mesaj retry'da iki kez yazılmaz (idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS messages_twilio_sid_idx
  ON public.messages (twilio_sid)
  WHERE twilio_sid IS NOT NULL;

-- ============================================================
-- 0004_routing_whatsapp_number.sql
-- ============================================================

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

-- ============================================================
-- 0005_service_role_grants.sql
-- ============================================================

-- ============================================================
-- 0005: service_role için hedefli GRANT (Edge Function erişimi).
-- Bu dosya Supabase'de uygulanır; GitHub kopyası referans amaçlıdır.
-- Kök sebep: 0001-0004 migration'ları SQL Editor'da postgres rolüyle
--   yaratıldığı için Supabase'in otomatik GRANT hook'u devreye girmedi;
--   service_role'e tablo yetkisi hiç verilmedi. Sonuç: webhook'ta
--   "permission denied for table organizations" (42501).
-- Hedefli: yalnızca twilio-webhook-handler'ın ihtiyaç duyduğu işlemler.
--   Körükörüne ALL YOK. İdempotent (GRANT tekrarlanabilir, no-op).
-- ============================================================

-- organizations: fonksiyon routing için SELECT yapar.
GRANT SELECT ON public.organizations TO service_role;

-- customers: fonksiyon first-touch INSERT + dup kontrolü SELECT yapar.
GRANT SELECT, INSERT ON public.customers TO service_role;

-- messages: fonksiyon yalnızca INSERT yapar.
GRANT INSERT ON public.messages TO service_role;

-- ============================================================
-- 0006_first_touch_fullname_nullable.sql
-- ============================================================

-- ============================================================
-- 0006: first-touch uyumu için customers.full_name nullable.
-- Bu dosya Supabase'de uygulanır; GitHub kopyası referans amaçlıdır.
-- Kök sebep: 0001 şemasında full_name NOT NULL idi; fakat Edge Function
--   first-touch akışı (4B-2.ii) isimsiz müşteri kaydeder (müşteri henüz
--   isim vermemiş, sadece WhatsApp'tan yazmış). Çelişki webhook'ta
--   "null value in column full_name violates not-null constraint" patlattı.
--   phone/email zaten nullable; full_name'in NOT NULL olması tutarsızdı.
--   KVKK uyumu: izin/isim zorlamadan kayıt. İdempotent (DROP NOT NULL no-op).
-- ============================================================

ALTER TABLE public.customers ALTER COLUMN full_name DROP NOT NULL;

-- ============================================================
-- 0007_inbox_unread_column.sql
-- ============================================================

-- 0007: Gelen Kutusu için messages.unread kolonu ve sorgu index'i.
-- Repo kopyası referans amaçlıdır; Supabase SQL editöründe tek kez uygulanır.
-- (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS ile idempotent.)
--
-- RLS gereksinimi zaten 0002'deki messages_select politikasıyla karşılanır:
-- authenticated kullanıcılar yalnızca kendi organization_id'lerine ait satırları okur.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS unread BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS messages_inbox_idx
  ON public.messages (organization_id, unread DESC, created_at DESC);

-- ============================================================
-- 0008_appointments_ends_at_notes.sql
-- ============================================================

-- 0008: Randevular sayfası için appointments ek kolonları ve gün sorgusu index'i.
-- Repo kopyası referans amaçlıdır; Supabase SQL editöründe uygulanır.
-- (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS ile idempotent.)
--
-- Mevcut tablo (0001): id, organization_id, customer_id, service_name, starts_at, status, created_at
-- Panel 'scheduled', 'cancelled', 'no_show', 'completed', 'pending' durumlarını kullanır;
-- status kolonu TEXT ve CHECK kısıtı olmadığı için yeni değerler için DDL gerekmez.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS appointments_day_idx
  ON public.appointments (organization_id, starts_at);

-- ============================================================
-- 0009_assistant_settings.sql
-- ============================================================

-- 0009: AI Asistan Ayarları — assistant_settings ve assistant_settings_history tabloları.
-- Idempotent migration: güvenle tekrar çalıştırılabilir.
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
