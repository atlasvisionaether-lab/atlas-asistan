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
const { RATE_WINDOW_SECONDS, RATE_MAX } = require('./_lib/limits.js');
const entitlement = require('./_lib/entitlement.js');
const scanGate = require('./_lib/scan-gate.js');
const tg = require('./_lib/telegram.js');

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

  /* Onay kutusu bir BEYAN; aktif kontroller ancak beyan + doğrulanmış
     sahiplik varken (scan-gate.js). Kuyruğa giden `consent` kapının kararı. */
  const declared = body && body.consent === true;
  if (declared && !(body && typeof body.domainOwnership === 'boolean' ? body.domainOwnership : true)) {
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
  const gate = await scanGate.checkScan(req, {
    url: url, owner: owner, consent: declared,
    level: (body && body.level) || (req.query && req.query.level),
    lang: body && body.lang
  });
  if (!gate.ok) return scanGate.reject(res, gate);
  const consent = gate.activeConsent;
  /* Sınır plana göre: free/anonim ömür boyu, Pro aylık, Enterprise sınırsız
     (bkz. _lib/entitlement.js). Eskiden herkese ücretsiz sınır uygulanıyordu. */
  const policy = await entitlement.resolvePolicy(owner, store.quotaKey(owner));
  const refundQuota = function () {
    return policy.unlimited ? Promise.resolve() : store.refundQuota(policy.key);
  };

  // Kota önce ayrılır: eşzamanlı iki istek son hakkı iki kez harcayamaz.
  let quota;
  try {
    /* Sınırsız planda sayaç tutulmuyor; IP hız sınırı yukarıda zaten uygulandı. */
    quota = policy.unlimited
      ? { ok: true, used: null }
      : await store.reserveQuota(policy.key, policy.limit, policy.ttl);
  } catch (err) {
    if (console && console.error) console.error('quota store error:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (!quota.ok) {
    return res.status(402).json({
      error: {
        code: 'quota_exceeded', used: quota.used, limit: policy.limit, remaining: 0,
        plan: policy.plan, period: policy.period
      }
    });
  }

  const kuyruk = await startQueuedScan({
    url: url,
    consent: consent,
    owner: owner,
    ip: clientIp(req),
    refund: refundQuota
  });

  if (!kuyruk.ok) {
    return res.status(kuyruk.status).json({ error: { code: kuyruk.code } });
  }

  /* Bitiş mesajı /api/scan-status'tan gidiyor (iş kimliği başına bir kez). */
  await tg.sendTelegram(tg.mesaj.taramaKuyruga(kuyruk.host || url), { type: 'scan' });

  /* `scanId` ana sayfanın okuduğu alan; `jobId` eski sözleşmeyi kullanan
     istemciler için aynı değerle duruyor. */
  return res.status(200).json({
    scanId: kuyruk.jobId,
    jobId: kuyruk.jobId,
    status: 'queued',
    host: kuyruk.host,
    url: kuyruk.url,
    statusUrl: '/api/scan-status?id=' + encodeURIComponent(kuyruk.jobId),
    ownership: gate.ownership,
    quota: entitlement.quotaView(policy, quota.used, owner.isAuthenticated ? 'account' : 'anonymous')
  });
};
