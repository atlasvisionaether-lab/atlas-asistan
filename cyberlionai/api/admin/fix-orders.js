'use strict';

/**
 * Yönetici: düzeltme siparişleri.
 *
 *   GET  /api/admin/fix-orders?status=pending   → son 100 sipariş
 *   POST /api/admin/fix-orders { id, status: 'paid'|'done'|'cancelled' }
 *
 * Yetki: oturumdaki e-posta ADMIN_EMAILS (virgülle ayrılmış) içinde olmalı.
 * Değişken tanımlı değilse uç KAPALI (503). 'paid' → Telegram "ödeme alındı",
 * 'done' → "fix tamamlandı".
 */

const auth = require('../_lib/auth.js');
const db = require('../_lib/db.js');
const tg = require('../_lib/telegram.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['pending', 'paid', 'done', 'cancelled'];

function admins() {
  return String(process.env.ADMIN_EMAILS || '').split(',')
    .map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean);
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  const list = admins();
  if (!list.length || !auth.isConfigured() || !db.isConfigured()) return res.status(503).json({ error: { code: 'admin_unconfigured' } });
  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });
  if (list.indexOf(String(user.email || '').toLowerCase()) === -1) return res.status(403).json({ error: { code: 'forbidden' } });

  if (req.method === 'GET') {
    const st = String((req.query && req.query.status) || '');
    const rows = await db.request('fix_orders?select=id,domain,finding_ids,type,price,price_discounted,plan,status,created_at,paid_at,done_at'
      + (STATUSES.indexOf(st) !== -1 ? '&status=eq.' + st : '') + '&order=created_at.desc&limit=100');
    return res.status(200).json({ items: Array.isArray(rows) ? rows : [] });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const id = String((body && body.id) || '');
  const status = String((body && body.status) || '');
  if (!UUID_RE.test(id) || ['paid', 'done', 'cancelled'].indexOf(status) === -1) {
    return res.status(400).json({ error: { code: 'invalid_request' } });
  }
  const patch = { status: status };
  if (status === 'paid') patch.paid_at = new Date().toISOString();
  if (status === 'done') patch.done_at = new Date().toISOString();
  const rows = await db.request('fix_orders?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: patch
  });
  const row = rows && rows[0];
  if (!row) return res.status(404).json({ error: { code: 'not_found' } });
  if (status === 'paid') await tg.sendTelegram(tg.mesaj.fixOdendi(row.id, row.domain), { type: 'payment', priority: true });
  if (status === 'done') await tg.sendTelegram(tg.mesaj.fixTamamlandi(row.domain, row.finding_ids), { type: 'payment', priority: true });
  return res.status(200).json({ ok: true, id: row.id, status: row.status });
}

module.exports = tg.ucuSar(handler, '/api/admin/fix-orders');
