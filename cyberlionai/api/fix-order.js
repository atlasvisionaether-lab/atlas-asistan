'use strict';

/**
 * "Biz düzeltelim" siparişi.
 *
 *   POST /api/fix-order { domain, findingIds[], type: 'single'|'full', agreements: true, startConsent: true }
 *     → 201 { orderId, checkoutUrl, price, priceDiscounted, type }
 *   GET  /api/fix-order?id=<uuid>  → hesabın kendi siparişi (ödeme sayfası için)
 *
 * KURALLAR
 *   - Giriş zorunlu. Alan adı bu hesap için DOĞRULANMIŞ olmalı: hizmet
 *     müşterinin sistemine dokunuyor (TCK m.244; bkz. scan-levels.js seviye 3).
 *   - İki onay zorunlu ve zaman damgasıyla saklanır: sözleşmeler (mesafeli
 *     satış, ön bilgilendirme, iade) ve hizmetin cayma süresi içinde ifasına
 *     başlanması. Cayma hakkı istisnası bu onaya dayanıyor.
 *   - Fiyat İSTEMCİDEN ALINMAZ: _lib/fixpricing.js ile burada hesaplanır.
 *   - Ödeme: şimdilik ekip iyzico ödeme bağlantısı gönderir (canlı iyzico tek
 *     seferlik ödeme formu alıcının TC kimlik ve adres bilgisini ister; uydurma
 *     veri gönderilmez). Sipariş Telegram'a düşer.
 *   - Hesap başına saatte 10 sipariş.
 */

const auth = require('./_lib/auth.js');
const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const entitlement = require('./_lib/entitlement.js');
const ownership = require('./_lib/ownership.js');
const levels = require('./_lib/scan-levels.js');
const pricing = require('./_lib/fixpricing.js');
const tg = require('./_lib/telegram.js');
const { clientIp } = require('./_lib/session.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function view(r) {
  return { orderId: r.id, domain: r.domain, findingIds: r.finding_ids, type: r.type,
    price: r.price, priceDiscounted: r.price_discounted, status: r.status, createdAt: r.created_at };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  if (!auth.isConfigured() || !db.isConfigured()) return res.status(503).json({ error: { code: 'service_unavailable' } });
  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });

  if (req.method === 'GET') {
    const id = String((req.query && req.query.id) || '');
    if (!UUID_RE.test(id)) return res.status(400).json({ error: { code: 'invalid_order' } });
    let rows;
    try {
      rows = await db.request('fix_orders?id=eq.' + encodeURIComponent(id)
        + '&user_id=eq.' + encodeURIComponent(user.id) + '&select=*&limit=1');
    } catch (err) { return res.status(503).json({ error: { code: 'service_unavailable' } }); }
    if (!rows || !rows[0]) return res.status(404).json({ error: { code: 'not_found' } });
    return res.status(200).json(view(rows[0]));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const domain = ownership.normalizeDomain(body && body.domain);
  if (!domain) return res.status(400).json({ error: { code: 'invalid_domain' } });
  if (!(body && body.agreements === true)) return res.status(400).json({ error: { code: 'agreements_required' } });
  if (!(body && body.startConsent === true)) return res.status(400).json({ error: { code: 'start_consent_required' } });

  if (!(await ownership.isVerified(user.id, domain))) {
    return res.status(403).json(levels.ownershipRequired(domain, body && body.lang));
  }

  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit('cl:rl:fixorder:' + user.id, 3600);
      if (rate.count > 10) return res.status(429).json({ error: { code: 'rate_limited' } });
    } catch (err) { /* sınır uygulanamadı */ }
  }

  const plan = await entitlement.planFor({ userId: user.id });
  const q = pricing.quote(body && body.findingIds, body && body.type === 'full' ? 'full' : 'single', plan);
  if (!q.ok) return res.status(400).json({ error: { code: q.code } });

  const now = new Date().toISOString();
  let row;
  try {
    const rows = await db.request('fix_orders', {
      method: 'POST', headers: { 'Prefer': 'return=representation' },
      body: {
        user_id: user.id, domain: domain, finding_ids: q.items.map(function (i) { return i.id; }),
        type: q.type, price: q.price, price_discounted: q.priceDiscounted, plan: plan,
        agreements_at: now, start_consent_at: now, ip: String(clientIp(req) || '').slice(0, 64) || null
      }
    });
    row = rows && rows[0];
  } catch (err) {
    if (console && console.error) console.error('fix order write failed:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }
  if (!row) return res.status(503).json({ error: { code: 'service_unavailable' } });

  await tg.sendTelegram(tg.mesaj.fixSiparis(row.id, domain, row.finding_ids, row.price, row.price_discounted, user.email),
    { type: 'payment', priority: true, silent: false });

  return res.status(201).json({
    orderId: row.id, checkoutUrl: '/fix-checkout?orderId=' + encodeURIComponent(row.id),
    type: row.type, price: row.price, priceDiscounted: row.price_discounted
  });
}

module.exports = tg.ucuSar(handler, '/api/fix-order');
