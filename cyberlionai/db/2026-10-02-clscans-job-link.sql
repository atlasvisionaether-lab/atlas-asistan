-- CyberLion AI — cl_scans ↔ scan_jobs bağlantısı.
-- Yeniden çalıştırmak güvenlidir.
--
-- NEDEN
--
-- `cl_scans` eşzamanlı tarama geçmişini tutar (bkz. migrations/003_scan_history.sql),
-- `scan_jobs` ise kuyruk/OWASP akışının iş kaydını tutar (bkz. 2026-10-01-cl-scan-owasp.sql).
-- `/api/scan` iki tabloya da ayrı ayrı yazıyor (saveScan → cl_scans.id, saveOwaspJob →
-- scan_jobs.id) ve istemciye HER İKİ kimliği birden döndürüyor (scanId, jobId) ama
-- ikisi arasında veritabanında hiçbir ilişki yok — aynı taramanın iki kaydı,
-- birbirinden habersiz. Kuyruk yolu (SCAN_QUEUE_ENABLED) devreye girdiğinde panelin
-- "geçmiş" ekranı scan_jobs'u, kota/özet ekranı cl_scans'i okuyacak; job_id olmadan
-- bu ikisi aynı taramaya ait olduğunu gösteremez.
--
-- NULLABLE VE ON DELETE SET NULL
--
-- Eşzamanlı yol (bayrak kapalı, varsayılan) scan_jobs satırı açmadan da
-- cl_scans'e yazmaya devam ediyor — job_id bu taramalarda hep NULL kalacak,
-- bu beklenen bir durum, zorunlu kılınmamalı. scan_jobs satırı silinirse (ör.
-- ileride bir saklama süresi politikası) cl_scans geçmiş kaydı KAYBOLMAMALI;
-- bu yüzden CASCADE değil SET NULL.

alter table public.cl_scans add column if not exists job_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cl_scans_job_id_fkey'
  ) then
    alter table public.cl_scans
      add constraint cl_scans_job_id_fkey
      foreign key (job_id) references public.scan_jobs(id)
      on delete set null;
  end if;
end $$;

-- Panelin "bu geçmiş kaydın işi hangisi" sorgusu için. Çoğu satırda job_id
-- NULL olacağı için kısmi indeks: yalnızca dolu olanları tutar.
create index if not exists cl_scans_job_id_idx
  on public.cl_scans (job_id)
  where job_id is not null;
