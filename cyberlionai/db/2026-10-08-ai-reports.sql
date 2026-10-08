-- CyberLion AI — AI analist raporları (NVIDIA Nemotron).
-- Yeniden çalıştırmak güvenlidir (IF NOT EXISTS). Policy'ler idempotent
-- DEĞİL; tekrar çalıştırmadan önce drop policy yapın.
--
-- MEVCUT TABLOLARIN RLS'İNE DOKUNULMUYOR. Bu dosya yalnızca yeni bir tablo
-- ekliyor; scan_jobs, scan_findings, cl_scans ve cl_subscriptions politikaları
-- olduğu gibi kalıyor.
--
-- NEDEN ANON POLİTİKASI YOK: tarayıcı veritabanına hiç bağlanmıyor, tüm okuma
-- ve yazma sunucu ucundan servis rolüyle geçiyor (bkz. api/_lib/db.js).
-- `authenticated` yalnızca KENDİ işinin raporunu okuyabiliyor; sahiplik
-- scan_jobs üzerinden kuruluyor, çünkü raporun kendi sahip sütunu yok.

create table if not exists public.ai_reports (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.scan_jobs(id) on delete cascade,
  domain         text not null check (char_length(domain) <= 253),
  risk_level     text not null check (risk_level in ('low','medium','high','critical')),

  -- Modelin verdiği puan. GÖSTERİLEN puan bu DEĞİL: müşteriye gösterilen puan
  -- motorların hesapladığı `scanner_score`. İkisi birlikte saklanıyor ki
  -- sapma görülebilsin — bir dil modelinin ürettiği sayı satılan ölçüm olamaz.
  score          int check (score is null or (score >= 0 and score <= 100)),
  scanner_score  int check (scanner_score is null or (scanner_score >= 0 and scanner_score <= 100)),

  summary_tr      text not null check (char_length(summary_tr) <= 1000),
  findings        jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,

  -- Hangi modelin ürettiği. Model adı değişince eski raporların neyle
  -- üretildiği kaybolmasın: bir özet yanlışsa hangi modeli suçlayacağımızı
  -- bilmek gerekiyor.
  model          text check (model is null or char_length(model) <= 200),
  created_at     timestamptz not null default now()
);

alter table public.ai_reports enable row level security;

-- Bir iş için birden fazla rapor olabilir (model değişti, yeniden üretildi);
-- en yenisi created_at ile okunuyor.
create index if not exists ai_reports_job_idx on public.ai_reports (job_id, created_at desc);
create index if not exists ai_reports_created_at_idx on public.ai_reports (created_at desc);

create policy "ai_reports_select_own" on public.ai_reports
  for select to authenticated using (
    exists (select 1 from public.scan_jobs j
            where j.id = ai_reports.job_id and j.user_id = auth.uid())
  );

-- NEMOTRON_RAW SAKLANMIYOR — bilinçli. Modelin ham yanıtı istemi ve tarama
-- gövdesini yankılayabiliyor; kalıcı olarak tutmanın tek faydası ayıklama,
-- bedeli ise müşteri verisinin ikinci bir kopyası. Şemaya uymayan yanıtlar
-- `ai_bad_output` koduyla loga düşüyor, veritabanına değil.
