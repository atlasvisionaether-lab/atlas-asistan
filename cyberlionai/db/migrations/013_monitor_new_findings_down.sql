-- 013 geri alma. DİKKAT: new_findings satırı varsa önce silinmeli, yoksa kısıt eklenemez.
BEGIN;
DELETE FROM public.monitor_alerts WHERE kind = 'new_findings';
ALTER TABLE public.monitor_alerts DROP CONSTRAINT IF EXISTS monitor_alerts_kind_check;
ALTER TABLE public.monitor_alerts ADD CONSTRAINT monitor_alerts_kind_check
  CHECK (kind IN ('score_drop', 'ssl_expiry', 'domain_expiry', 'blacklist', 'downtime', 'recovered'));
COMMIT;
