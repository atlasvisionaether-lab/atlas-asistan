'use strict';

/**
 * POST /api/scan  →  { url: "ornek.com" }
 *
 * Gerçek tarama ucu. Hedefe sunucudan istek atılır, güvenlik başlıkları ve
 * TLS yapılandırması ölçülür, sonuç dinamik bir skorla döner.
 *
 * Sınırlar sunucu tarafında ve kalıcı depoda tutulur:
 *   - IP başına hız sınırı (kötüye kullanım)
 *   - Oturum başına ücretsiz tarama kotası (ürün politikası)
 * Tarayıcıdaki sayaç yalnızca gösterim içindir; karar burada verilir.
 */

const { scanSite, SCANNER_VERSION, REPORT_VERSION } = require('./_lib/scanner.js');
const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const { resolveSession, clientIp, ipKey } = require('./_lib/session.js');

const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_MAX = 12;
const FREE_SCAN_LIMIT = 5;
const QUOTA_TTL_SECONDS = 60 * 60 * 24 * 365;

/** Motorun fırlattığı teknik hataları istemcinin çevirebileceği kodlara eşler. */
const ERROR_STATUS = {
  empty: 400, invalid_url: 400, too_long: 400, bad_protocol: 400,
  credentials_not_allowed: 400, blocked_port: 400, dns_failed: 400,
  blocked_target: 403,
  timeout: 504, unreachable: 502, bad_redirect: 502, too_many_redirects: 502
};

/** Hedefe ulaşılamamasından kaynaklanan hatalarda ücretsiz hak iade edilir. */
const REFUNDABLE = ['timeout', 'unreachable', 'bad_redirect', 'too_many_redirects', 'dns_failed'];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  // Kalıcı depo yoksa sınırlar uygulanamaz. Bu durumda taramayı açık
  // bırakmak ücretsiz katmanı sınırsız hâle getirirdi; bu yüzden kapatılır.
  if (!store.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  const session = resolveSession(req, res);
  const rateKey = 'cl:rl:' + ipKey(clientIp(req));
  const quotaKey = 'cl:quota:' + session.id;

  let rate;
  try {
    rate = await store.hitRateLimit(rateKey, RATE_WINDOW_SECONDS);
  } catch (err) {
    // Depoya ulaşılamıyorsa sınır uygulanamıyor demektir; istek reddedilir.
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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const url = body && body.url;
  if (!url) return res.status(400).json({ error: { code: 'empty' } });

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
        code: 'quota_exceeded',
        used: quota.used,
        limit: FREE_SCAN_LIMIT,
        remaining: 0
      }
    });
  }

  try {
    const result = await scanSite(url);
    result.quota = {
      used: quota.used,
      limit: FREE_SCAN_LIMIT,
      remaining: Math.max(0, FREE_SCAN_LIMIT - quota.used)
    };

    // Geçmişe kaydet. Kayıt başarısız olursa tarama sonucu yine döner:
    // geçmiş bir kolaylık, taramanın kendisi değil.
    if (db.isConfigured()) {
      try {
        result.scanId = await db.saveScan(result, { sessionId: session.id },
          { scanner: SCANNER_VERSION, report: REPORT_VERSION });
      } catch (err) {
        if (console && console.error) console.error('history save failed:', err.message);
        result.scanId = null;
      }
    } else {
      result.scanId = null;
    }

    return res.status(200).json(result);
  } catch (err) {
    const code = (err && err.message) || 'scan_failed';

    // Kullanıcının hatası olmayan başarısızlıklarda hak geri verilir.
    if (REFUNDABLE.indexOf(code) !== -1) {
      try { await store.refundQuota(quotaKey); } catch (e) { /* iade edilemedi, sessiz geç */ }
    }

    const status = ERROR_STATUS[code] || 500;
    if (status >= 500 && console && console.error) console.error('scan error:', code);
    return res.status(status).json({ error: { code: code } });
  }
};
