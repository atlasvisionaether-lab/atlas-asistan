-- CyberLion AI — cl_scans.job_id üzerinde TAM tekil indeks.
--
-- ÖNKOŞUL: db/2026-10-02-clscans-job-link.sql (sütunu ve FK'yı o ekliyor).
-- Yeniden çalıştırmak güvenlidir. RLS'e ve policy'lere DOKUNULMUYOR.
--
-- NEDEN TEKİL
--
-- Kuyruklu yolda taramayı Lambda yürütüyor ve dünya haritasını besleyen
-- `cl_scans` satırını da o açıyor. SQS mesajları EN AZ BİR KEZ teslim
-- edilir: aynı iş iki kez işlenebilir. Tekil indeks, ikinci teslimin
-- haritaya ikinci bir tarama saymasını engelliyor (Lambda PostgREST'e
-- `resolution=ignore-duplicates` ile yazıyor).
--
-- NEDEN TAM, KISMİ DEĞİL
--
-- PostgREST'in on_conflict / ignore-duplicates yolu KISMİ indeksi
-- kullanamıyor (42P10). Aynı hata cl_subscriptions.iyzico_subscription_ref'te
-- bir kez yaşandı. 2026-10-02 dosyasındaki `where job_id is not null` kısmi
-- indeksi panelin sorgusu için duruyor ve dokunulmuyor; dedup için gereken
-- tam indeks buna EK olarak açılıyor.
--
-- Eşzamanlı yolda (bayrak kapalı, varsayılan) job_id NULL kalıyor. Postgres
-- tekil indekste birden fazla NULL'a izin verdiği için bu satırlar
-- etkilenmiyor.

CREATE UNIQUE INDEX IF NOT EXISTS cl_scans_job_id_key
  ON public.cl_scans (job_id);

-- Down:
-- DROP INDEX IF EXISTS public.cl_scans_job_id_key;
