'use strict';

/**
 * POST /api/trust-precheck { domain }  → Güven Damgası ön kontrol raporu
 *
 * Enterprise planı. Giriş zorunlu. PASİF okuma (bkz. _lib/trustcheck.js);
 * sahiplik doğrulaması istenmiyor çünkü yalnızca herkese açık sayfalar
 * okunuyor, ama her istek tarama günlüğüne yazılıyor (seviye: passive).
 * Hesap başına saatte 10.
 */

const auth = require('./_lib/auth.js');
const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const entitlement = require('./_lib/entitlement.js');
const ownership = require('./_lib/ownership.js');
const trust = require('./_lib/trustcheck.js');
const tg = require('./_lib/telegram.js');
const { clientIp } = require('./_lib/session.js');

const RATE_WINDOW_SECONDS = 3600;
const RATE_MAX = 10;

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  if (!auth.isConfigured() || !db.isConfigured()) return res.status(503).json({ error: { code: 'service_unavailable' } });
  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });

  const plan = await entitlement.planFor({ userId: user.id });
  if (plan !== 'enterprise') return res.status(402).json({ error: { code: 'plan_required', plan: 'enterprise' } });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const domain = ownership.normalizeDomain(body && body.domain);
  if (!domain) return res.status(400).json({ error: { code: 'invalid_domain' } });

  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit('cl:rl:trust:' + user.id, RATE_WINDOW_SECONDS);
      if (rate.count > RATE_MAX) {
        const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
      }
    } catch (err) { /* sınır uygulanamadı */ }
  }

  await ownership.logScan({
    userId: user.id, ip: clientIp(req), domain: domain, level: 'passive',
    verified: await ownership.isVerified(user.id, domain), consent: false,
    userAgent: req.headers && req.headers['user-agent']
  });

  const report = await trust.run(domain);
  if (!report.ok) return res.status(502).json({ error: { code: report.code || 'unreachable' } });
  return res.status(200).json(report);
}

module.exports = tg.ucuSar(handler, '/api/trust-precheck');
