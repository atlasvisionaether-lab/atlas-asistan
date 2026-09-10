'use strict';

/**
 * Kimlik uçlarının ortak girişi: yöntem kontrolü, yapılandırma kontrolü,
 * gövde ayrıştırma ve IP başına deneme sınırı.
 *
 * Deneme sınırı neden burada: şifre denemesi, sıfırlama e-postası ve magic
 * link istekleri kötüye kullanıma açık uçlardır. Supabase'in kendi sınırları
 * var ama tek savunma katmanı olarak bırakılmamalı.
 *
 * Depo erişilemiyorsa uç kapanır (fail-closed). Sınır uygulanamıyorken şifre
 * denemesine izin vermek, sınırı hiç koymamakla aynı kapıya çıkar.
 */

const store = require('./store.js');
const auth = require('./auth.js');
const { clientIp, ipKey } = require('./session.js');

/**
 * @param {object} opts { bucket, max, windowSeconds, method }
 * @returns {{ ok: true, body: object } | { ok: false }}  ok:false ise yanıt yazıldı.
 */
async function guard(req, res, opts) {
  res.setHeader('Cache-Control', 'no-store');

  const method = opts.method || 'POST';
  if (req.method !== method) {
    res.setHeader('Allow', method);
    res.status(405).json({ error: { code: 'method_not_allowed' } });
    return { ok: false };
  }

  if (!auth.isConfigured()) {
    res.status(503).json({ error: { code: 'auth_unavailable' } });
    return { ok: false };
  }

  if (!store.isConfigured()) {
    res.status(503).json({ error: { code: 'service_unavailable' } });
    return { ok: false };
  }

  const key = 'cl:rl:auth:' + opts.bucket + ':' + ipKey(clientIp(req));
  let hit;
  try {
    hit = await store.hitRateLimit(key, opts.windowSeconds);
  } catch (err) {
    if (console && console.error) console.error('auth rate limit store error:', err.message);
    res.status(503).json({ error: { code: 'service_unavailable' } });
    return { ok: false };
  }

  if (hit.count > opts.max) {
    const retryAfter = hit.ttl > 0 ? hit.ttl : opts.windowSeconds;
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: { code: 'too_many_requests', retryAfter: retryAfter } });
    return { ok: false };
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  return { ok: true, body: body || {} };
}

module.exports = { guard };
