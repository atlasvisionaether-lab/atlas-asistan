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
  /* Birden çok etkin abonelik olabilir (iki alan adı). Plan, en kapsamlı
     olanı: Enterprise varsa Enterprise. */
  const planId = active.some(function (r) { return r.plan === 'enterprise'; })
    ? 'enterprise'
    : (active.length ? 'pro' : 'free');

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
