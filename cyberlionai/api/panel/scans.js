'use strict';

/**
 * Panelin veri ucu — hesabın KENDİ taramaları.
 *
 *   GET /api/panel/scans                     → liste + skor eğilimi
 *   GET /api/panel/scans?status=completed    → duruma göre süzülmüş liste
 *   GET /api/panel/scans?id=<uuid>           → tek tarama + OWASP gruplu bulgular
 *
 * NEDEN AYRI BİR UÇ VAR
 *
 * Tarayıcı Supabase'e DOĞRUDAN bağlanmıyor. Depodaki erişim modeli bu: tüm
 * okuma sunucudan geçer, sahiplik filtresi sorgunun içinde uygulanır, servis
 * rolü anahtarı istemciye hiç gitmez. Panele `supabase-js` koymak bu modeli
 * kırardı; ayrıca CSP'yi (`script-src 'self'`) gevşetmek ve tarayıcıya bir
 * anahtar göndermek gerekirdi. Tablodaki RLS ikinci katman olarak duruyor.
 *
 * Giriş ZORUNLU. Anonim oturumun `scan_jobs` kaydı olamaz: `saveOwaspJob`
 * yalnızca `user_id` yazıyor, anonim oturum kimliği için bu tabloda sütun yok.
 * Bu yüzden anonim isteğe boş liste değil 401 dönüyor — arayüz "giriş yapın"
 * diyebilsin, "taramanız yok" demesin.
 */

const db = require('../_lib/db.js');
const auth = require('../_lib/auth.js');
const store = require('../_lib/store.js');
const { clientIp, ipKey } = require('../_lib/session.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 60;
const TREND_POINTS = 30;

module.exports = async function handler(req, res) {
  /* Kişiye özel veri: ara önbelleklerde ASLA durmamalı. */
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!db.isConfigured() || !auth.isConfigured()) {
    return res.status(503).json({ error: { code: 'panel_unavailable' } });
  }

  const user = await auth.resolveUser(req, res);
  if (!user) {
    return res.status(401).json({ error: { code: 'auth_required' } });
  }

  /* Sınır kullanıcı başına, IP başına değil: panel tek hesapla açılıyor ve
     ortak çıkışlı bir ağdaki iki müşteri birbirinin hakkını yememeli. */
  if (store.isConfigured()) {
    try {
      const hit = await store.hitRateLimit('cl:rl:panel:' + user.id, RATE_WINDOW_SECONDS);
      if (hit.count > RATE_MAX) {
        res.setHeader('Retry-After', String(hit.ttl > 0 ? hit.ttl : RATE_WINDOW_SECONDS));
        return res.status(429).json({ error: { code: 'rate_limited' } });
      }
    } catch (err) {
      if (console && console.warn) console.warn('panel rate limit store error:', err.message);
    }
  }

  const query = (req.query && typeof req.query === 'object') ? req.query : {};

  try {
    /* --- Tek tarama + bulgular --- */
    if (query.id) {
      if (!UUID_RE.test(String(query.id))) {
        return res.status(400).json({ error: { code: 'invalid_id' } });
      }
      const detail = await db.getJobWithFindings(user.id, String(query.id));
      /* Yok ile başkasının AYNI cevabı alıyor: ayırmak kimlik sızdırır. */
      if (!detail) return res.status(404).json({ error: { code: 'not_found' } });
      return res.status(200).json(detail);
    }

    /* --- Liste + eğilim --- */
    const status = typeof query.status === 'string' ? query.status : null;
    if (status && status !== 'completed' && status !== 'failed'
      && status !== 'pending' && status !== 'running') {
      return res.status(400).json({ error: { code: 'invalid_status' } });
    }

    const [list, trend] = await Promise.all([
      db.listJobs(user.id, { status: status, limit: query.limit, offset: query.offset }),
      db.jobScoreTrend(user.id, TREND_POINTS)
    ]);

    return res.status(200).json({
      items: list.items,
      limit: list.limit,
      offset: list.offset,
      hasMore: list.hasMore,
      /* Eğilim süzgeçten BAĞIMSIZ: "başarısız" süzgeci seçilince skor
         grafiğinin boşalması, grafiği süzgecin bir parçası sanmaya yol açardı.
         Grafik her zaman skoru olan tamamlanmış taramaları gösteriyor. */
      trend: trend,
      filter: status
    });
  } catch (err) {
    if (console && console.error) console.error('panel scans error:', err.message);
    return res.status(503).json({ error: { code: 'panel_unavailable' } });
  }
};
