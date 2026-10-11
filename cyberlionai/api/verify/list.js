'use strict';

/**
 * GET /api/verify/list  → { items: [{ domain, status, method, verifiedAt, token? }] }
 * Bekleyen kayıtlarda belirteç döner (kullanıcı yönergeyi yeniden görebilsin);
 * doğrulanmış kayıtta dönmez, artık gerekmiyor.
 */

const { prepare } = require('./_common.js');
const ownership = require('../_lib/ownership.js');
const tg = require('../_lib/telegram.js');

async function handler(req, res) {
  const p = await prepare(req, res, 'GET', false);
  if (!p) return;
  let rows;
  try {
    rows = await ownership.listVerifications(p.user.id);
  } catch (err) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }
  return res.status(200).json({
    items: rows.map(function (r) {
      const item = { domain: r.domain, status: r.status, method: r.method || null,
        verifiedAt: r.verified_at || null, createdAt: r.created_at };
      if (r.status !== 'verified') item.token = r.token;
      return item;
    })
  });
}

module.exports = tg.ucuSar(handler, '/api/verify/list');
