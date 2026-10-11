-- 007: scan_jobs ilerleme takibi (Scan Progress UI)
-- status degerleri genisletilir (geriye donuk uyumlu), progress ve
-- current_step kolonlari eklenir, tablo realtime yayinina alinir.
-- Not: anonim realtime aboneligi, tabloda anon SELECT policy'si gerektirir;
-- bu, kuyruk tabanli tarama (Task 1) kapsamindadir.

ALTER TABLE public.scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_status_check;
ALTER TABLE public.scan_jobs ADD CONSTRAINT scan_jobs_status_check
  CHECK (status IN (
    'pending','queued','scanning_headers','scanning_ssl','scanning_ai',
    'generating_report','running','done','completed','failed','error'
  ));

ALTER TABLE public.scan_jobs ADD COLUMN IF NOT EXISTS progress int
  DEFAULT 0 CHECK (progress >= 0 AND progress <= 100);
ALTER TABLE public.scan_jobs ADD COLUMN IF NOT EXISTS current_step text;

ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_jobs;

-- Down:
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.scan_jobs;
-- ALTER TABLE public.scan_jobs DROP COLUMN IF EXISTS current_step;
-- ALTER TABLE public.scan_jobs DROP COLUMN IF EXISTS progress;
-- (status check eski haline getirilmeli; eski kayitlar yeni degerlerde olabilir)
