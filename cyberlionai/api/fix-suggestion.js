'use strict';

/**
 * POST /api/fix-suggestion { domain, findingId, lang }
 *   → { findingId, severity, tier, fix: {nginx, apache, cloudflare, dns}, price, priceDiscounted, isPro }
 *
 * Ücretsiz: düzeltme kodu herkese açık (sonuç ekranındaki "Nasıl düzeltirim?").
 * Kod kaynağı engines/fixes.js; fiyat _lib/fixpricing.js. IP başına 60/dk.
 * Listede olmayan bulgu (OWASP vb.) için kod yok, yalnızca tam paket fiyatı.
 */

const auth = require('./_lib/auth.js');
const store = require('./_lib/store.js');
const entitlement = require('./_lib/entitlement.js');
const pricing = require('./_lib/fixpricing.js');
const { fixFor, SEVERITY } = require('./_lib/engines/fixes.js');
const { clientIp, ipKey } = require('./_lib/session.js');
const tg = require('./_lib/telegram.js');

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const id = pricing.cleanIds([body && body.findingId])[0];
  if (!id) return res.status(400).json({ error: { code: 'invalid_finding' } });
  const lang = body && body.lang === 'en' ? 'en' : 'tr';

  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit('cl:rl:fixsug:' + ipKey(clientIp(req)), 60);
      if (rate.count > 60) return res.status(429).json({ error: { code: 'rate_limited' } });
    } catch (err) { /* sınır uygulanamadı */ }
  }

  let plan = 'free';
  if (auth.isConfigured()) {
    try {
      const user = await auth.resolveUser(req, res);
      if (user) plan = await entitlement.planFor({ userId: user.id });
    } catch (err) { plan = 'free'; }
  }

  const f = fixFor(id, lang);
  const q = pricing.quote([id], 'single', plan);
  return res.status(200).json({
    findingId: id,
    severity: SEVERITY[id] || null,
    tier: q.type === 'full' ? 'full' : (f ? f.tier : 'full'),
    fix: f ? { nginx: f.nginx, apache: f.apache, cloudflare: f.cloudflare, dns: f.dns } : null,
    price: q.price, priceDiscounted: q.priceDiscounted, isPro: q.isPro
  });
}

module.exports = tg.ucuSar(handler, '/api/fix-suggestion');
