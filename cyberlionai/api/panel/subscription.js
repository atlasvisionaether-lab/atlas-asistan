'use strict';

/**
 * Panelin abonelik ucu — hesabın KENDİ aboneliği.
 *
 *   GET /api/panel/subscription
 *
 * NEDEN AYRI BİR UÇ
 *
 * Panelin "hangi plandayım" sorusuna cevap vermesi gerekiyor ve bu cevabı
 * tarayıcıya tablo okutarak vermiyoruz: depodaki erişim modeli tüm okumanın
 * sunucudan geçmesini, sahiplik filtresinin sorgunun içinde olmasını istiyor.
 * Tablodaki RLS (yalnızca kendi satırını SELECT) ikinci katman olarak duruyor.
 *
 * NE DÖNMÜYOR
 *
 * iyzico'nun ürün ve plan referansları dışarı verilmiyor; müşteriye anlamı
 * olan şey plan adı, durum ve alan adı. Kart bilgisi bu sisteme hiç girmiyor:
 * ödeme formu iyzico'da, kart numarası bizim sunucumuza gelmiyor.
 *
 * ABONELİK SATIRI YOKSA
 *
 * 404 değil, `plan: 'free'` dönüyor: ücretsiz kullanıcı bir hata durumu değil,
 * sistemin normal hâli. Panel de "aboneliğiniz yok" yerine "Free" diyebiliyor.
 */

const db = require('../_lib/db.js');
const auth = require('../_lib/auth.js');
const { PLANS } = require('../_lib/plans.js');
const { planFromSubscriptions } = require('../_lib/entitlement.js');
const ownership = require('../_lib/ownership.js');

/**
 * POST /api/panel/subscription { domain }
 * İzlenecek alan adını etkin ücretli aboneliğe yazar. Alan adı bu hesap için
 * DOĞRULANMIŞ olmalı: günlük izleme o alan adına her gün istek atıyor ve
 * izlemenin hedefi kullanıcının beyanıyla değil kanıtıyla belirleniyor.
 */
async function setDomain(req, res, user) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const domain = ownership.normalizeDomain(body && body.domain);
  if (!domain) return res.status(400).json({ error: { code: 'invalid_domain' } });
  if (!(await ownership.isVerified(user.id, domain))) {
    return res.status(403).json({ error: { code: 'ownership_required', verifyUrl: '/verify?domain=' + encodeURIComponent(domain) } });
  }
  let rows;
  try { rows = await db.listSubscriptions(user.id); } catch (err) {
    return res.status(503).json({ error: { code: 'panel_unavailable' } });
  }
  const sub = rows.filter(function (r) { return r.active === true && (r.plan === 'pro' || r.plan === 'enterprise'); })[0];
  if (!sub) return res.status(409).json({ error: { code: 'no_paid_subscription' } });
  try {
    await db.request('cl_subscriptions?id=eq.' + encodeURIComponent(sub.id)
      + '&user_id=eq.' + encodeURIComponent(user.id), {
      method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: { domain: domain }
    });
  } catch (err) {
    if (console && console.error) console.error('subscription domain update failed:', err.message);
    return res.status(503).json({ error: { code: 'panel_unavailable' } });
  }
  return res.status(200).json({ ok: true, domain: domain, plan: sub.plan });
}

module.exports = async function handler(req, res) {
  /* Kişiye özel veri: ara önbelleklerde ASLA durmamalı. */
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!db.isConfigured() || !auth.isConfigured()) {
    return res.status(503).json({ error: { code: 'panel_unavailable' } });
  }

  const user = await auth.resolveUser(req, res);
  if (!user) {
    return res.status(401).json({ error: { code: 'auth_required' } });
  }
  if (req.method === 'POST') return setDomain(req, res, user);

  let rows;
  try {
    rows = await db.listSubscriptions(user.id);
  } catch (err) {
    /* Tablo yoksa PostgREST 404 veriyor; bu kurulumun eksik olduğunu
       gösterir, "aboneliğin yok" demek olmaz. */
    if (/db_error_404/.test(err.message)) {
      return res.status(503).json({ error: { code: 'subscriptions_unavailable' } });
    }
    if (console && console.error) console.error('panel subscription error:', err.message);
    return res.status(503).json({ error: { code: 'panel_unavailable' } });
  }

  const active = rows.filter(function (r) { return r.active === true; });
  /* Plan, tarama kotasını belirleyen kuralla AYNI fonksiyondan: panelde
     "Pro" yazıp taramada free sınırı uygulamak mümkün olmasın. */
  const planId = planFromSubscriptions(rows);

  return res.status(200).json({
    plan: planId,
    priceTry: PLANS[planId] ? PLANS[planId].priceTry : 0,
    subscriptions: active.map(function (r) {
      return {
        domain: r.domain,
        plan: r.plan,
        status: r.status || null,
        /* Sandbox'ta açılmış bir abonelik panelde böyle görünüyor; canlı
           abonelik sanılmasın. */
        testMode: r.iyzico_env === 'sandbox',
        createdAt: r.created_at
      };
    })
  });
};
