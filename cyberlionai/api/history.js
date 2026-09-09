'use strict';

/**
 * Tarama geçmişi.
 *
 *   GET    /api/history?limit=&offset=   → sahibin taramaları (sayfalı)
 *   DELETE /api/history?id=<uuid>        → tek kayıt sil
 *   DELETE /api/history?all=1            → tüm geçmişi sil
 *
 * Sahiplik: sunucunun verdiği HttpOnly `cl_sid` çerezi. Filtre sorgunun
 * içinde olduğu için başka bir oturumun kayıt kimliğini tahmin etmek işe
 * yaramaz — kayıt o oturuma ait değilse sonuç boş döner.
 */

const db = require('./_lib/db.js');
const { resolveOwner, ownerRef } = require('./_lib/session.js');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function positiveInt(value, fallback, max) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0) return fallback;
  return max ? Math.min(n, max) : n;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!db.isConfigured()) {
    return res.status(503).json({ error: { code: 'history_unavailable' } });
  }

  const who = await resolveOwner(req, res);
  const owner = ownerRef(who);
  const query = (req.query && typeof req.query === 'object') ? req.query : {};

  // Giriş yapılmamış ve oturum yeni ise geçmiş zaten boştur; sorguya gerek yok.
  // Giriş yapılmışsa bu kestirme geçerli değil: hesabın kaydı olabilir.
  if (!who.isAuthenticated && who.isNewSession) {
    if (req.method === 'GET') return res.status(200).json({ items: [], limit: DEFAULT_LIMIT, offset: 0, hasMore: false });
    if (req.method === 'DELETE') return res.status(200).json({ deleted: 0 });
  }

  try {
    if (req.method === 'GET') {
      const limit = positiveInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT) || DEFAULT_LIMIT;
      const offset = positiveInt(query.offset, 0);
      // Bir fazlasını isteyip sonraki sayfa var mı diye bakıyoruz.
      const rows = await db.listScans(owner, limit + 1, offset);
      const hasMore = rows.length > limit;
      return res.status(200).json({
        items: hasMore ? rows.slice(0, limit) : rows,
        limit: limit,
        offset: offset,
        hasMore: hasMore
      });
    }

    if (req.method === 'DELETE') {
      if (query.all === '1' || query.all === 'true') {
        const removed = await db.deleteAllScans(owner);
        return res.status(200).json({ deleted: removed });
      }
      const id = query.id;
      if (!id || !UUID_RE.test(String(id))) {
        return res.status(400).json({ error: { code: 'invalid_id' } });
      }
      const removed = await db.deleteScan(owner, String(id));
      if (!removed) return res.status(404).json({ error: { code: 'not_found' } });
      return res.status(200).json({ deleted: removed });
    }

    res.setHeader('Allow', 'GET, DELETE');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  } catch (err) {
    if (console && console.error) console.error('history error:', err.message);
    return res.status(503).json({ error: { code: 'history_unavailable' } });
  }
};
