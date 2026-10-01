-- CyberLion AI — OWASP Lite şeması (Supabase'de 2026-10-01'de uygulandı).
-- Yeniden çalıştırmak güvenlidir (IF NOT EXISTS). Policy'ler idempotent değil;
-- tekrar çalıştırmadan önce drop policy yapın.

create table if not exists public.cl_waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (char_length(email) <= 320),
  plan        text not null check (plan in ('pro', 'enterprise')),
  domain      text check (domain is null or char_length(domain) <= 253),
  created_at  timestamptz not null default now()
);
alter table public.cl_waitlist enable row level security;
create index if not exists cl_waitlist_created_at_idx on public.cl_waitlist (created_at desc);

create table if not exists public.scan_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  domain       text not null check (char_length(domain) <= 253),
  url          text not null check (char_length(url) <= 2048),
  status       text not null default 'pending' check (status in ('pending','running','completed','failed')),
  result       jsonb,
  score        int check (score is null or (score >= 0 and score <= 100)),
  scanner_mode text not null default 'passive' check (scanner_mode in ('passive','active')),
  consent_ip   inet,
  consent_at   timestamptz,
  country      text check (country is null or country ~ '^[A-Z]{2}$'),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.scan_jobs enable row level security;
create index if not exists scan_jobs_user_idx on public.scan_jobs (user_id, created_at desc);
create index if not exists scan_jobs_created_idx on public.scan_jobs (created_at desc);

create table if not exists public.scan_findings (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.scan_jobs(id) on delete cascade,
  owasp_category text check (owasp_category is null or owasp_category ~ '^A(0[1-9]|10)$'),
  severity      text not null check (severity in ('critical','high','medium','low','info')),
  title         text not null,
  description   text,
  evidence      text,
  fix_code      text,
  created_at    timestamptz not null default now()
);
alter table public.scan_findings enable row level security;
create index if not exists scan_findings_job_idx on public.scan_findings (job_id);

-- Yazma: YALNIZCA servis rolü (api ucundan). anon/authenticated INSERT policy yok.
create policy "scan_jobs_select_own" on public.scan_jobs
  for select to authenticated using (auth.uid() = user_id);
create policy "scan_findings_select_own" on public.scan_findings
  for select to authenticated using (
    exists (select 1 from public.scan_jobs j
            where j.id = scan_findings.job_id and j.user_id = auth.uid())
  );
