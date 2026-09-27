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
