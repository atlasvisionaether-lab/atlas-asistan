-- CyberLion AI — kuyruklu taramanın cl_scans kaydıyla bağı.
--
-- Yeniden çalıştırmak güvenlidir. RLS'e ve policy'lere DOKUNULMUYOR: yazma
-- yalnızca servis rolünde, anon/authenticated INSERT yok.
--
-- NEDEN BU SÜTUN
--
-- Dünya haritasındaki "kendi tarama etkinliğimiz" katmanı `cl_scans`'ten
-- besleniyor. Eşzamanlı yolda `/api/scan` bu satırı açıyor; kuyruklu yolda
-- taramayı Lambda yürüttüğü için satırı da onun açması gerekiyor, yoksa
-- bayrak açıldığı anda katman yeni taramalarla büyümeyi bırakır.
--
-- Mesajlar SQS'te EN AZ BİR KEZ teslim edilir: aynı iş iki kez işlenebilir.
-- `scan_job_id` üzerindeki TEKİL indeks, ikinci teslimin haritaya ikinci bir
-- tarama saymasını engelliyor (Lambda `resolution=ignore-duplicates` ile
-- yazıyor). Sütun olmadan dedup için güvenilir bir anahtar yoktu: host+zaman
-- aynı anda iki gerçek taramayı da birleştirebilirdi.

ALTER TABLE public.cl_scans
  ADD COLUMN IF NOT EXISTS scan_job_id uuid;

-- TEKİL indeks TAM olmalı (kısmi değil): PostgREST'in on_conflict /
-- ignore-duplicates yolu kısmi indeksi kullanamıyor (42P10). Aynı hata
-- cl_subscriptions.iyzico_subscription_ref'te bir kez yaşandı.
CREATE UNIQUE INDEX IF NOT EXISTS cl_scans_scan_job_id_key
  ON public.cl_scans (scan_job_id);

-- Down:
-- DROP INDEX IF EXISTS public.cl_scans_scan_job_id_key;
-- ALTER TABLE public.cl_scans DROP COLUMN IF EXISTS scan_job_id;
