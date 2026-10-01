-- CyberLion AI — cl_waitlist tablosu (Pro ön kayıt, iyzico devreye girene kadar)
-- Supabase SQL Editor'da manuel çalıştırın.

create table if not exists public.cl_waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (char_length(email) <= 320),
  plan        text not null check (plan in ('pro', 'enterprise')),
  domain      text check (domain is null or char_length(domain) <= 253),
  created_at  timestamptz not null default now()
);

-- RLS açık, anon rolü için politika YOK: tarayıcıdan erişilemez.
alter table public.cl_waitlist enable row level security;

create index if not exists cl_waitlist_created_at_idx on public.cl_waitlist (created_at desc);

-- Not: yazma yalnızca sunucudaki SUPABASE_SERVICE_ROLE_KEY ile
-- /api/waitlist üzerinden yapılır.
