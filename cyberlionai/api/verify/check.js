'use strict';

/**
 * POST /api/verify/check  { domain, method: 'dns' | 'file' | 'meta' }
 *   200 { domain, status: 'verified', method, verifiedAt }
 *   409 { error: { code: 'not_found', attemptsLeft } }   kanıt bulunamadı
 *   429 { error: { code: 'cooldown', retryAfter } }      3 başarısız denemeden sonra 1 saat
 *   404 { error: { code: 'not_started' } }               önce /api/verify/init
 */

const { prepare } = require('./_common.js');
const ownership = require('../_lib/ownership.js');
const tg = require('../_lib/telegram.js');

async function handler(req, res) {
  const p = await prepare(req, res, 'POST', true);
  if (!p) return;

  const method = String(p.body.method || '').toLowerCase();
  let r;
  try {
    r = await ownership.checkVerification(p.user.id, p.domain, method);
  } catch (err) {
    if (console && console.error) console.error('verify check failed:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (r.ok) {
    if (r.row && r.row.verified_at && Date.now() - Date.parse(r.row.verified_at) < 60000) {
      await tg.sendTelegram(tg.mesaj.alanDogrulandi(p.domain, r.row.method || method, p.user.email),
        { type: 'verify' });
    }
    return res.status(200).json({
      domain: p.domain, status: 'verified',
      method: r.row && r.row.method, verifiedAt: r.row && r.row.verified_at
    });
  }
  if (r.code === 'cooldown') {
    res.setHeader('Retry-After', String(r.retryAfter));
    return res.status(429).json({ error: { code: 'cooldown', retryAfter: r.retryAfter } });
  }
  if (r.code === 'not_started') return res.status(404).json({ error: { code: 'not_started' } });
  if (r.code === 'invalid_method') return res.status(400).json({ error: { code: 'invalid_method' } });
  return res.status(409).json({ error: { code: 'not_found', attemptsLeft: r.attemptsLeft } });
}

module.exports = tg.ucuSar(handler, '/api/verify/check');
