'use strict';

/**
 * Yönetim: dönüşüm hunisi (bkz. _lib/funnel.js).
 *
 *   GET /api/admin/funnel?days=30   → son N günün (1–90) olay × kaynak tablosu
 *
 * Yetki: oturumdaki e-posta ADMIN_EMAILS (virgülle ayrılmış) içinde olmalı.
 * Dönen yalnızca günlük toplam sayılar; kişisel veri yok.
 */

const auth = require('../_lib/auth.js');
const store = require('../_lib/store.js');
const funnel = require('../_lib/funnel.js');
const tg = require('../_lib/telegram.js');

function admins() {
  return String(process.env.ADMIN_EMAILS || '').split(',')
    .map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean);
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  const list = admins();
  if (!list.length || !auth.isConfigured() || !store.isConfigured()) return res.status(503).json({ error: { code: 'admin_unconfigured' } });
  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });
  if (list.indexOf(String(user.email || '').toLowerCase()) === -1) return res.status(403).json({ error: { code: 'forbidden' } });

  const days = (req.query && req.query.days) || 30;
  try {
    return res.status(200).json(await funnel.report(days));
  } catch (err) {
    return res.status(503).json({ error: { code: 'store_unavailable' } });
  }
}

module.exports = tg.ucuSar(handler, '/api/admin/funnel');
