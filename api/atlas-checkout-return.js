'use strict';

/**
 * iyzico ödeme sayfasından dönüş (atlasasistan.com).
 *
 *   POST /api/atlas-checkout-return  (iyzico, form jetonu ile)
 *   GET  /api/atlas-checkout-return?token=…
 *   → 303 /checkout?plan=…&status=success|pending|failed
 *
 * GÖVDEYE GÜVENİLMİYOR: sonuç jetonla iyzico'ya sorulur. Sipariş jeton
 * özetiyle VERİTABANINDAN bulunur; tutar ve plan oradan karşılaştırılır.
 *   setup        → retrievePaymentForm + fix-pay-return'ün verify'ı
 *                  (status/paymentStatus SUCCESS, fraud 1, basketId = sipariş,
 *                  tutar = amount_try)
 *   subscription → getCheckoutForm: abonelik ACTIVE ve fiyat planı referansı
 *                  siparişin paketiyle aynı
 * Güncelleme status=pending koşullu: sayfa yenilenirse bildirim ikinci kez gitmez.
 */

const iyzico = require('../cyberlionai/api/_lib/iyzico.js');
const tg = require('../cyberlionai/api/_lib/telegram.js');
const { readToken } = require('../cyberlionai/api/checkout-return.js');
const { verify } = require('../cyberlionai/api/fix-pay-return.js');
const plans = require('./_atlas/plans.js');
const orders = require('./_atlas/orders.js');

function back(res, plan, status) {
  res.setHeader('Location', '/checkout?plan=' + encodeURIComponent(plan || '') + '&status=' + encodeURIComponent(status));
  return res.status(303).end();
}

/** iyzico cevabını siparişle karşılaştırır → { status, ref?, reason? } */
async function outcome(order, token) {
  if (order.kind === 'setup') {
    const r = await iyzico.retrievePaymentForm(token, order.id);
    if (!r.ok) return { status: 'pending', reason: r.reason || 'iyzico_unreachable' };
    const check = verify(r.data, { id: order.id, status: order.status, price_discounted: order.amount_try });
    if (check.ok) return { status: 'paid', ref: String(r.data.paymentId || '') };
    return { status: check.review ? 'pending' : 'failed', reason: check.reason };
  }

  const r = await iyzico.getCheckoutForm(token);
  if (!r.ok) return { status: 'pending', reason: r.reason || 'iyzico_unreachable' };
  const data = (r.data && r.data.data) || r.data || {};
  const st = String(data.subscriptionStatus || data.status || '').toUpperCase();
  const paidPlan = plans.planOfRef(data.pricingPlanReferenceCode);
  if (!paidPlan || paidPlan.id !== order.plan) return { status: 'failed', reason: 'plan_mismatch' };
  if (iyzico.isActiveStatus(st)) return { status: 'paid', ref: String(data.referenceCode || '') };
  return { status: st === 'PENDING' ? 'pending' : 'failed', reason: 'subscription_' + (st.toLowerCase() || 'unknown') };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const token = readToken(req);
  if (!token) return back(res, '', 'failed');
  const order = await orders.byToken(token);
  if (!order) {
    console.warn('atlas-checkout-return: order_not_found');
    return back(res, '', 'failed');
  }
  if (order.status === 'paid') return back(res, order.plan, 'success');
  if (order.status !== 'pending') return back(res, order.plan, 'failed');

  const o = await outcome(order, token);
  if (o.reason) console.warn('atlas-checkout-return: ' + o.reason + ' (plan=' + order.plan + ')');
  if (o.status === 'pending') return back(res, order.plan, 'pending');

  const updated = await orders.settle(order.id, o.status,
    o.status === 'paid' ? { iyzico_ref: o.ref || null, paid_at: new Date().toISOString() } : { fail_reason: o.reason || null });
  if (updated) {
    tg.bildirimIsaretle(res);
    await tg.sendTelegram(o.status === 'paid'
      ? '[Atlas] ✅ Ödeme başarılı: ' + tg.maskEmail(order.email) + ', plan=' + order.plan
        + ', tutar=' + order.amount_try + ' TL' + (order.kind === 'setup' ? ' (kurulum; aylık abonelik teslimde)' : '')
      : '[Atlas] ❌ Ödeme başarısız: ' + tg.maskEmail(order.email) + ', plan=' + order.plan + ', sebep=' + (o.reason || '-'),
    { type: o.status === 'paid' ? 'payment' : 'alert', priority: true });
  }
  return back(res, order.plan, o.status === 'paid' ? 'success' : 'failed');
}

module.exports = tg.ucuSar(handler, '/api/atlas-checkout-return');
module.exports.outcome = outcome;
