'use strict';

/**
 * POST /api/tool-check { type: 'headers' | 'email', url }  → ücretsiz araç sonucu
 *
 * Anonim. PASİF okuma (bkz. _lib/toolcheck.js); her istek tarama günlüğüne
 * yazılıyor (seviye: passive). Ana ücretsiz tarama kotasını HARCAMAZ; kendi
 * sınırı var: IP başına günde DAILY_MAX. Aynı host + tür için sonuç
 * CACHE_SECONDS önbellekte — aynı siteyi art arda sormak hedefe yeniden
 * istek göndermez.
 */

const store = require('./_lib/store.js');
const ownership = require('./_lib/ownership.js');
const toolcheck = require('./_lib/toolcheck.js');
const { normalizeTarget } = require('./_lib/guard.js');
const tg = require('./_lib/telegram.js');
const { clientIp, ipKey } = require('./_lib/session.js');

const DAY_SECONDS = 86400;
const DAILY_MAX = 10;
const CACHE_SECONDS = 3600;
/* Kullanıcının girdisinden kaynaklanan hatalar 400; geri kalanı hedefe veya
   DNS'e ulaşılamadı demek (502). */
const HATALI_GIRDI = ['blocked_target', 'bad_domain', 'domain_not_found'];

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const type = body && typeof body.type === 'string' ? body.type : '';
  if (toolcheck.TYPES.indexOf(type) === -1) return res.status(400).json({ error: { code: 'invalid_type' } });
  const target = normalizeTarget(body && body.url);
  if (target.error) return res.status(400).json({ error: { code: target.error } });
  const host = target.host.toLowerCase();

  const ip = clientIp(req);
  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit('cl:rl:tool:' + ipKey(ip), DAY_SECONDS);
      if (rate.count > DAILY_MAX) {
        const retryAfter = rate.ttl > 0 ? rate.ttl : DAY_SECONDS;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
      }
    } catch (err) { /* sınır uygulanamadı */ }
  }

  const cacheKey = 'cl:tool:' + type + ':' + host;
  if (store.isConfigured()) {
    try {
      const cached = await store.cacheGet(cacheKey);
      if (cached) return res.status(200).json(Object.assign(cached, { cached: true }));
    } catch (err) { /* önbellek yok sayılır */ }
  }

  await ownership.logScan({
    userId: null, ip: ip, domain: host, level: 'passive', verified: false, consent: false,
    userAgent: req.headers && req.headers['user-agent']
  });

  const result = await toolcheck.run(type, target.url);
  if (!result.ok) {
    const status = HATALI_GIRDI.indexOf(result.code) !== -1 ? 400 : 502;
    return res.status(status).json({ error: { code: result.code } });
  }
  if (store.isConfigured()) {
    try { await store.cacheSet(cacheKey, result, CACHE_SECONDS); } catch (err) { /* yok say */ }
  }
  return res.status(200).json(result);
}

module.exports = tg.ucuSar(handler, '/api/tool-check');
module.exports.DAILY_MAX = DAILY_MAX;
