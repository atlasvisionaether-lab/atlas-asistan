'use strict';

/**
 * İzleme uyarıları (panel).
 *
 *   GET  /api/panel/alerts            → { items: [{ id, domain, kind, severity, data, createdAt, read }], unread }
 *   POST /api/panel/alerts { read: true }  → tümünü okundu işaretler
 *
 * Sahiplik filtresi sorgunun İÇİNDE (user_id=eq.…): başka hesabın uyarısı
 * bu uçtan çıkamaz. Metin istemcide dile göre üretilir; sunucu kod + sayı döner.
 */

const db = require('../_lib/db.js');
const auth = require('../_lib/auth.js');

const LIMIT = 50;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  if (!db.isConfigured() || !auth.isConfigured()) {
    return res.status(503).json({ error: { code: 'panel_unavailable' } });
  }
  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });
  const mine = 'monitor_alerts?user_id=eq.' + encodeURIComponent(user.id);

  if (req.method === 'POST') {
    try {
      await db.request(mine + '&read_at=is.null', {
        method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
        body: { read_at: new Date().toISOString() }
      });
    } catch (err) {
      return res.status(503).json({ error: { code: 'panel_unavailable' } });
    }
    return res.status(200).json({ ok: true });
  }

  let rows;
  try {
    rows = await db.request(mine + '&select=id,domain,kind,severity,data,created_at,read_at'
      + '&order=created_at.desc&limit=' + LIMIT);
  } catch (err) {
    /* Tablo yoksa (göç uygulanmadı) boş liste değil, açık hata. */
    return res.status(503).json({ error: { code: 'alerts_unavailable' } });
  }
  const items = (Array.isArray(rows) ? rows : []).map(function (r) {
    return { id: r.id, domain: r.domain, kind: r.kind, severity: r.severity,
      data: r.data || {}, createdAt: r.created_at, read: !!r.read_at };
  });
  return res.status(200).json({ items: items, unread: items.filter(function (i) { return !i.read; }).length });
};
