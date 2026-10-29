-- Calorie Burn Estimator — Supabase schema
-- Run in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now()
);

create table if not exists public.calculations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  product_slug text not null default 'calorie-burn-estimator',
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.calculations enable row level security;

create policy "profiles are self-readable"
  on public.profiles for select
  using (auth.uid() = id);

create policy "calculations are self-readable"
  on public.calculations for select
  using (auth.uid() = user_id);

create policy "calculations are self-writable"
  on public.calculations for insert
  with check (auth.uid() = user_id);

create index if not exists calculations_user_id_idx
  on public.calculations (user_id);
