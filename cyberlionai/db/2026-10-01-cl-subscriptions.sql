-- CyberLion AI — abonelik tablosu (haftalık tarama için).
--
-- NEDEN: haftalık Enterprise taramasının KİMİ tarayacağını söyleyen bir kayıt
-- yoktu. `scan_jobs` tablosunda plan/abonelik sütunu yok ve olmamalı: o tablo
-- bir taramanın sonucunu tutuyor, müşterinin ticari durumunu değil.
--
-- Yeniden çalıştırmak güvenlidir (IF NOT EXISTS). Policy'ler idempotent değil;
-- tekrar çalıştırmadan önce drop policy yapın.
--
-- BU GÖÇ HENÜZ UYGULANMADI. Uygulanana kadar api/cron/weekly-scan.js hiçbir
-- tarama tetiklemiyor, `no_subscriptions_table` sebebiyle boş dönüyor.

create table if not exists public.cl_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  domain      text not null check (char_length(domain) <= 253),
  plan        text not null check (plan in ('pro', 'enterprise')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Aynı hesap aynı alan adını iki kez abone edemez: haftalık tarama o alan
  -- adını iki kez tarardı ve müşteri iki rapor alırdı.
  unique (user_id, domain)
);

alter table public.cl_subscriptions enable row level security;

create index if not exists cl_subscriptions_active_idx
  on public.cl_subscriptions (plan, active) where active;

-- Okuma: hesap yalnızca kendi aboneliğini görür. Yazma YALNIZCA servis rolü
-- (ödeme akışından); anon/authenticated INSERT ya da UPDATE policy'si YOK —
-- yoksa bir kullanıcı kendini Enterprise ilan edebilirdi.
create policy "cl_subscriptions_select_own" on public.cl_subscriptions
  for select to authenticated using (auth.uid() = user_id);
