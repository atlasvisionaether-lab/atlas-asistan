-- CyberLion AI — asenkron tarama kuyruğu (SQS + Lambda) için şema eki.
-- Yeniden çalıştırmak güvenlidir. Policy EKLENMİYOR: yazma yalnızca servis
-- rolünde kalıyor, anon/authenticated INSERT yok (RLS olduğu gibi duruyor).
--
-- NEDEN BU SÜTUNLAR
--
-- session_id : Anonim tarama `user_id` taşımaz (auth.users'a FK). Kuyruk
--              modelinde istemci sonucu SONRADAN soruyor, yani "bu iş senin
--              mi?" sorusunun anonim oturumda da bir cevabı olmalı. `cl_scans`
--              aynı amaçla zaten oturum kimliği tutuyor; aynı desen.
-- report_url : Lambda PDF'i S3'e koyup adresini buraya yazar. Panel raporu
--              yine /api/report üzerinden üretmeye devam eder; bu sütun
--              Lambda'nın ürettiği kopyanın adresi.
-- report_key : S3 nesne anahtarı. Adres imzalı/süreli olabileceği için
--              yeniden imzalamak üzere anahtarın kendisi ayrıca tutulur.
-- queued_at  : Kuyruğa bırakılma anı. created_at satırın açılması, queued_at
--              mesajın gerçekten SQS'e gittiği an; ikisi arasındaki fark
--              "kuyruğa hiç düşmemiş iş" demek ve ayıklanabilir olmalı.
-- error_code : Başarısız işin sebebi (timeout, unreachable, blocked_target …).
--              Serbest metin DEĞİL, istemcinin çevirebileceği kısa kod.
-- attempts   : Lambda yeniden denemesi. SQS aynı mesajı tekrar teslim
--              edebildiği için işin kaç kez ele alındığı görünür olmalı.

alter table public.scan_jobs add column if not exists session_id  text;
alter table public.scan_jobs add column if not exists report_url  text;
alter table public.scan_jobs add column if not exists report_key  text;
alter table public.scan_jobs add column if not exists queued_at   timestamptz;
alter table public.scan_jobs add column if not exists error_code  text;
alter table public.scan_jobs add column if not exists attempts    int not null default 0;

alter table public.scan_jobs
  add constraint scan_jobs_session_id_len check (session_id is null or char_length(session_id) <= 128)
  not valid;
alter table public.scan_jobs
  add constraint scan_jobs_error_code_fmt check (error_code is null or error_code ~ '^[a-z0-9_]{1,40}$')
  not valid;

-- Anonim oturumun kendi işini bulması için. user_id null olan satırlar
-- user_idx'e düşmüyor.
create index if not exists scan_jobs_session_idx
  on public.scan_jobs (session_id, created_at desc)
  where session_id is not null;

-- STATUS KISITINA BU DOSYA DOKUNMUYOR.
--
-- Kuyruk yolu 'queued' durumuna ihtiyaç duyuyor, ama o değeri
-- `migrations/007_scan_jobs_progress.sql` zaten ekliyor ve kısıtı adım
-- durumlarıyla birlikte (scanning_headers, scanning_ssl, scanning_ai,
-- generating_report, done, error) yeniden yazıyor.
--
-- Burada kısıtı ikinci kez yeniden yazmak, hangi dosyanın en son koştuğuna
-- göre değişen bir sonuç üretirdi: daraltan sürüm en son koşsa 007'nin adım
-- durumları yazılamaz hâle gelir ve ilerleme çubuğu sessizce bozulur.
-- Kısıtın tek sahibi 007; bu dosya yalnızca sütun ekliyor.
--
-- Ön koşul: 007 bu dosyadan ÖNCE uygulanmış olmalı (yoksa 'queued' yazılamaz).
-- Doğrulama:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'scan_jobs_status_check';
--   -- listede 'queued' görünmeli
