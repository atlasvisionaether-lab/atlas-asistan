'use strict';

/**
 * POST /api/enqueue-scan  →  { url: "ornek.com", consent: false }
 *
 * Ana sayfanın kuyruklu tarama ucu. İşi SQS'e bırakır ve iş kimliğini döner;
 * istemci sonucu `/api/scan-status` üzerinden yoklar.
 *
 * NEDEN AYRI BİR UÇ VAR
 *
 * Ana sayfa istemcisi bu adrese ve `{ scanId }` alanına göre yazıldı.
 * `/api/scan` ise 202 + `{ jobId }` dönüyor ve eşzamanlı yolu da taşıyor.
 * İki sözleşmeyi tek uçta birleştirmek, çalışan istemciyi kırmadan mümkün
 * değildi; bu yüzden uç ayrı ama ADIMLAR ORTAK: ikisi de
 * `_lib/queuestart.js` çağırıyor, yani hedef doğrulama, kota iadesi ve
 * 'queued' yazımı tek yerde.
 *
 * KUYRUK KAPALIYSA 404
 *
 * Bayrak kapalı ya da kuyruk yapılandırılmamışsa bu uç 404 döner. Bu bir
 * kaza değil, istemcinin sözleşmesi: 404 görünce eşzamanlı `/api/scan`'e
 * düşüyor. 503 dönmek istemciyi hata ekranına götürürdü — oysa çalışan bir
 * yol var. Bu yüzden 404 hız sınırından ve KOTADAN ÖNCE veriliyor: geri
 * düşülecek istek kullanıcının hakkını harcamamalı, yoksa her tarama iki
 * hak yerdi.
 */

const { startQueuedScan, isAvailable } = require('./_lib/queuestart.js');
const store = require('./_lib/store.js');
const { resolveOwner, clientIp, ipKey } = require('./_lib/session.js');
const {
  RATE_WINDOW_SECONDS, RATE_MAX, FREE_SCAN_LIMIT, QUOTA_TTL_SECONDS
} = require('./_lib/limits.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  /* Kuyruk yolu kapalı: istemci eşzamanlı yola düşsün (yukarıdaki not). */
  if (!isAvailable()) {
    return res.status(404).json({ error: { code: 'enqueue_unavailable' } });
  }

  // Sınırlar olmadan ücretsiz katman sınırsız hâle gelirdi.
  if (!store.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const url = body && body.url;
  if (!url) return res.status(400).json({ error: { code: 'empty' } });

  /* Aktif kontroller yalnızca sahiplik onayı ile. Etiket isteğe bağlı;
     yoksa onay verilmiş sayılır ve tarama pasif modda yapılır. */
  const consent = body && body.consent === true;
  if (consent && !(body && typeof body.domainOwnership === 'boolean' ? body.domainOwnership : true)) {
    return res.status(400).json({ error: { code: 'consent_required' } });
  }

  // IP sınırı: `/api/scan` ile AYNI kova. Ayrı kova olsaydı iki uç arasında
  // geçerek sınır iki katına çıkardı.
  let rate;
  try {
    rate = await store.hitRateLimit('cl:rl:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
  } catch (err) {
    if (console && console.error) console.error('rate limit store error:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (rate.count > RATE_MAX) {
    const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
  }
  res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_MAX - rate.count)));

  const owner = await resolveOwner(req, res);
  const quotaKey = store.quotaKey(owner);

  // Kota önce ayrılır: eşzamanlı iki istek son hakkı iki kez harcayamaz.
  let quota;
  try {
    quota = await store.reserveQuota(quotaKey, FREE_SCAN_LIMIT, QUOTA_TTL_SECONDS);
  } catch (err) {
    if (console && console.error) console.error('quota store error:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (!quota.ok) {
    return res.status(402).json({
      error: {
        code: 'quota_exceeded', used: quota.used, limit: FREE_SCAN_LIMIT, remaining: 0
      }
    });
  }

  const kuyruk = await startQueuedScan({
    url: url,
    consent: consent,
    owner: owner,
    ip: clientIp(req),
    refund: function () { return store.refundQuota(quotaKey); }
  });

  if (!kuyruk.ok) {
    return res.status(kuyruk.status).json({ error: { code: kuyruk.code } });
  }

  /* `scanId` ana sayfanın okuduğu alan; `jobId` eski sözleşmeyi kullanan
     istemciler için aynı değerle duruyor. */
  return res.status(200).json({
    scanId: kuyruk.jobId,
    jobId: kuyruk.jobId,
    status: 'queued',
    host: kuyruk.host,
    url: kuyruk.url,
    statusUrl: '/api/scan-status?id=' + encodeURIComponent(kuyruk.jobId),
    quota: {
      used: quota.used,
      limit: FREE_SCAN_LIMIT,
      remaining: Math.max(0, FREE_SCAN_LIMIT - quota.used),
      scope: owner.isAuthenticated ? 'account' : 'anonymous'
    }
  });
};
