'use strict';

/**
 * POST /api/verify/init  { domain }
 *   → { domain, status, token, methods: { dns, file, meta } }
 *
 * Belirteç alan adı + hesap başına BİR kez üretilir ve sonra değişmez:
 * kullanıcı DNS kaydını ekledikten sonra yeniden başlatırsa kaydı boşa gitmesin.
 */

const { prepare } = require('./_common.js');
const ownership = require('../_lib/ownership.js');
const tg = require('../_lib/telegram.js');

async function handler(req, res) {
  const p = await prepare(req, res, 'POST', true);
  if (!p) return;

  let row;
  try {
    row = await ownership.initVerification(p.user.id, p.domain);
  } catch (err) {
    if (console && console.error) console.error('verify init failed:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }
  if (!row) return res.status(503).json({ error: { code: 'service_unavailable' } });

  return res.status(200).json({
    domain: row.domain,
    status: row.status,
    token: row.token,
    methods: ownership.instructions(row.domain, row.token)
  });
}

module.exports = tg.ucuSar(handler, '/api/verify/init');
