-- =============================================================================
-- Cyber Lion AI — 013: izleme uyarısına "yeni açık" türü
--
-- Günlük izleme bir önceki taramada OLMAYAN bir bulgu (kritik/yüksek/orta)
-- gördüğünde `new_findings` uyarısı yazar. `data`: { count, titles[≤5],
-- severities{} } — bulgu başlıkları tarama motorunun sabit metinleridir,
-- kişisel veri yok.
--
-- 009'daki satır içi CHECK'in adı PostgreSQL varsayılanıdır:
-- monitor_alerts_kind_check.
-- =============================================================================

BEGIN;

ALTER TABLE public.monitor_alerts DROP CONSTRAINT IF EXISTS monitor_alerts_kind_check;
ALTER TABLE public.monitor_alerts ADD CONSTRAINT monitor_alerts_kind_check
  CHECK (kind IN ('score_drop', 'ssl_expiry', 'domain_expiry', 'blacklist', 'downtime', 'recovered',
                  'new_findings'));

COMMIT;
