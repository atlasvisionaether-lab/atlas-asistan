'use strict';

/**
 * iyzico tek seferlik ödeme formunun dönüşü ("Biz düzeltelim").
 *
 *   POST /api/fix-pay-return  (iyzico'dan, token ile)
 *     → 303 /fix-checkout?orderId=…&pay=success|failed|pending|invalid
 *
 * Siteler arası POST: oturum çerezi gelmez. Sipariş ve tutar, ödeme
 * başlarken yazılan token kaydından (fix-pay.js) okunur. Sonuç İYZİCO'YA
 * SORULUR ve yalnızca şunların hepsi tutarsa sipariş 'paid' olur:
 *   - status 'success' ve paymentStatus 'SUCCESS'
 *   - basketId === sipariş
 *   - price === kayıttaki KDV dahil tutar (kuruş)
 * Güncelleme `status=eq.pending` koşulludur: aynı dönüş iki kez gelirse
 * ikinci sefer hiçbir şey değişmez. Hiçbir değer loglanmaz.
 */

const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const iyzico = require('./_lib/iyzico.js');
const tg = require('./_lib/telegram.js');
const { readToken } = require('./checkout-return.js');
const { PENDING_PREFIX } = require('./fix-pay.js');

function back(res, orderId, durum) {
  res.setHeader('Location', '/fix-checkout?orderId=' + encodeURIComponent(orderId || '')
    + '&pay=' + encodeURIComponent(durum));
  return res.status(303).end();
}

function kurus(v) {
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 100) : NaN;
}

/** iyzico sonucunu kayıtla karşılaştırır: { ok } | { ok: false, reason }. */
function verify(data, pending) {
  if (!data || data.status !== 'success') return { ok: false, reason: 'status_' + String(data && data.status) };
  if (String(data.paymentStatus || '').toUpperCase() !== 'SUCCESS') {
    return { ok: false, reason: 'payment_' + String(data.paymentStatus || 'unknown').toLowerCase() };
  }
  if (String(data.basketId || '') !== String(pending.orderId)) return { ok: false, reason: 'basket_mismatch' };
  if (kurus(data.price) !== kurus(pending.amount)) return { ok: false, reason: 'amount_mismatch' };
  return { ok: true };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  const token = readToken(req);
  let pending = null;
  if (token && store.isConfigured()) {
    try { pending = await store.cacheGet(PENDING_PREFIX + token); } catch (err) { pending = null; }
  }
  if (console && console.warn) {
    console.warn('fix-pay-return: received token=' + (token ? 'yes' : 'no') + ' pending=' + (pending ? 'yes' : 'no'));
  }
  if (!token || !pending || !pending.orderId) return back(res, pending && pending.orderId, 'invalid');
  if (!iyzico.isConfigured() || !db.isConfigured()) return back(res, pending.orderId, 'pending');

  const result = await iyzico.retrievePaymentForm(token);
  const data = result.ok ? (result.data || {}) : null;
  if (console && console.warn && data) {
    console.warn('fix-pay-return: iyzico status=' + String(data.status || '-')
      + ' paymentStatus=' + String(data.paymentStatus || '-') + ' fraudStatus=' + String(data.fraudStatus === undefined ? '-' : data.fraudStatus)
      + ' mdStatus=' + String(data.mdStatus === undefined ? '-' : data.mdStatus) + ' shape=' + iyzico.responseShape(data));
  }
  const v = result.ok ? verify(data, pending) : { ok: false, reason: result.reason || 'retrieve_failed' };
  if (!v.ok) {
    if (console && console.warn) console.warn('fix-pay-return: ' + v.reason);
    await tg.sendTelegram(tg.mesaj.odemeBasarisiz(pending.email, 'fix ' + v.reason + ' (sipariş ' + pending.orderId + ')'),
      { type: 'alert', priority: true });
    return back(res, pending.orderId, 'failed');
  }

  let rows;
  try {
    rows = await db.request('fix_orders?id=eq.' + encodeURIComponent(pending.orderId) + '&status=eq.pending', {
      method: 'PATCH',
      body: { status: 'paid', paid_at: new Date().toISOString() },
      headers: { 'Prefer': 'return=representation' }
    });
  } catch (err) {
    /* Para alındı ama sipariş yazılamadı: elle müdahale. */
    await tg.sendTelegram(tg.mesaj.odemeBasarisiz(pending.email,
      'fix ödendi ama sipariş güncellenemedi (sipariş ' + pending.orderId + ', ödeme ' + String(data.paymentId || '-') + ')'),
      { type: 'alert', priority: true });
    return back(res, pending.orderId, 'pending');
  }
  const row = rows && rows[0];
  if (row) {
    await tg.sendTelegram(tg.mesaj.fixOdendi(row.id, row.domain) + '\nÖdeme: ' + String(data.paymentId || '-')
      + ' · ' + String(data.paidPrice || data.price) + ' TL (KDV dahil, iyzico)', { type: 'payment', priority: true });
  }
  try { await store.cacheSet(PENDING_PREFIX + token, null, 60); } catch (err) { /* süre zaten dolacak */ }
  return back(res, pending.orderId, 'success');
}

module.exports = tg.ucuSar(handler, '/api/fix-pay-return');
module.exports.verify = verify;
