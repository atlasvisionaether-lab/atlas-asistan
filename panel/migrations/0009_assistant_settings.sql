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
