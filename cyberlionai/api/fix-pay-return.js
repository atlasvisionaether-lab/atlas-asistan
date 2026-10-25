'use strict';

/**
 * iyzico tek seferlik ödeme formunun dönüşü ("Biz düzeltelim").
 *
 *   POST /api/fix-pay-return  (iyzico'dan, token ile)
 *     → 303 /fix-checkout?orderId=…&pay=success|declined|failed|pending|invalid
 *
 * Siteler arası POST: oturum çerezi gelmez, gerekmez. Sonuç İYZİCO'YA
 * SORULUR; sipariş iyzico'nun döndürdüğü basketId ile VERİTABANINDAN okunur
 * ve beklenen tutar oradan hesaplanır (önbellek eşlemesi yok). Sipariş
 * yalnızca şunların hepsi tutarsa 'paid' olur:
 *   - status 'success' ve paymentStatus 'SUCCESS'. Banka ret kodu (100xx,
 *     ör. 10012) gelirse müşteri 'declined' ile döner: kartın internet
 *     alışverişi iznini açması ya da başka kart denemesi söylenir.
 *   - fraudStatus 1 (onaylandı). 0 = iyzico incelemesinde: hizmet
 *     BAŞLAMAZ, sipariş bekler, ekibe haber verilir; -1 = reddedildi
 *     (PR #115 incelemesi).
 *   - sipariş var ve 'pending'
 *   - price === sipariş tutarı (KDV dahil, kuruş)
 * Güncelleme `status=eq.pending` koşulludur: aynı dönüş iki kez gelirse
 * ikinci sefer hiçbir şey değişmez. Kimlik ya da kart verisi loglanmaz.
 */

const db = require('./_lib/db.js');
const iyzico = require('./_lib/iyzico.js');
const tg = require('./_lib/telegram.js');
const funnel = require('./_lib/funnel.js');
const { readToken } = require('./checkout-return.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(res, orderId, durum) {
  res.setHeader('Location', '/fix-checkout?orderId=' + encodeURIComponent(orderId || '')
    + '&pay=' + encodeURIComponent(durum));
  return res.status(303).end();
}

function kurus(v) {
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 100) : NaN;
}

/**
 * iyzico sonucunu siparişle karşılaştırır.
 *   order: { id, status, price_discounted } (veritabanından)
 *   → { ok: true } | { ok: false, reason, review? }
 */
function verify(data, order) {
  if (!data || data.status !== 'success') return { ok: false, reason: 'status_' + String(data && data.status) };
  if (String(data.paymentStatus || '').toUpperCase() !== 'SUCCESS') {
    if (iyzico.isBankDecline(data.errorCode)) return { ok: false, reason: 'bank_declined', declined: true };
    return { ok: false, reason: 'payment_' + String(data.paymentStatus || 'unknown').toLowerCase() };
  }
  const fraud = data.fraudStatus === undefined || data.fraudStatus === null ? null : Number(data.fraudStatus);
  if (fraud === -1) return { ok: false, reason: 'fraud_rejected' };
  if (fraud !== 1) return { ok: false, reason: 'fraud_review', review: true };
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (String(data.basketId || '') !== String(order.id)) return { ok: false, reason: 'basket_mismatch' };
  if (order.status !== 'pending') return { ok: false, reason: 'order_not_pending' };
  if (kurus(data.price) !== kurus(order.price_discounted)) return { ok: false, reason: 'amount_mismatch' };
  return { ok: true };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  const token = readToken(req);
  /* Dönüş adresindeki sipariş no (fix-pay.js callbackUrl): YALNIZCA
     müşteriyi kendi siparişine geri göndermek için. Doğrulama iyzico'nun
     basketId'si ve veritabanıyla. */
  const qId = String((req.query && req.query.orderId) || '');
  const hint = UUID_RE.test(qId) ? qId : '';
  if (console && console.warn) console.warn('fix-pay-return: received token=' + (token ? 'yes' : 'no') + ' order=' + (hint ? 'yes' : 'no'));
  if (!token) return back(res, hint, 'invalid');
  if (!iyzico.isConfigured() || !db.isConfigured()) return back(res, hint, 'pending');

  const result = await iyzico.retrievePaymentForm(token, hint);
  const data = result.ok ? (result.data || {}) : null;
  if (console && console.warn && data) {
    console.warn('fix-pay-return: iyzico status=' + String(data.status || '-')
      + ' paymentStatus=' + String(data.paymentStatus || '-')
      + ' fraudStatus=' + String(data.fraudStatus === undefined ? '-' : data.fraudStatus)
      + ' mdStatus=' + String(data.mdStatus === undefined ? '-' : data.mdStatus)
      + ' shape=' + iyzico.responseShape(data));
  }
  const orderId = data && UUID_RE.test(String(data.basketId || '')) ? String(data.basketId) : hint;

  let order = null;
  if (orderId) {
    try {
      const rows = await db.request('fix_orders?id=eq.' + encodeURIComponent(orderId)
        + '&select=id,domain,status,price_discounted&limit=1');
      order = rows && rows[0];
    } catch (err) {
      return back(res, orderId, 'pending');
    }
  }

  const v = result.ok ? verify(data, order)
    : iyzico.isBankDecline(result.errorCode) ? { ok: false, reason: 'bank_declined', declined: true }
    : { ok: false, reason: result.reason || 'retrieve_failed' };
  if (!v.ok) {
    const kod = result.errorCode || (data && data.errorCode) || '';
    const odemeNo = String((data && data.paymentId) || result.paymentId || '-');
    if (console && console.warn) {
      console.warn('fix-pay-return: ' + v.reason + (kod ? ' ' + kod : '') + ' paymentId=' + odemeNo);
    }
    if (v.reason === 'order_not_pending') return back(res, orderId, 'already');
    await tg.sendTelegram(tg.mesaj.odemeBasarisiz(null, 'fix ' + v.reason + (kod ? ' ' + kod : '')
      + ' (sipariş ' + (orderId || '-') + ', ödeme ' + odemeNo + ')'
      + (v.declined ? ' — banka reddi' : '')
      + (v.review ? ' — iyzico incelemesinde; onaylanınca panelden "ödendi" işaretleyin' : '')),
      { type: 'alert', priority: true });
    return back(res, orderId, v.review ? 'pending' : v.declined ? 'declined' : 'failed');
  }

  let rows;
  try {
    rows = await db.request('fix_orders?id=eq.' + encodeURIComponent(order.id) + '&status=eq.pending', {
      method: 'PATCH',
      body: { status: 'paid', paid_at: new Date().toISOString() },
      headers: { 'Prefer': 'return=representation' }
    });
  } catch (err) {
    /* Para alındı ama sipariş yazılamadı: elle müdahale. */
    await tg.sendTelegram(tg.mesaj.odemeBasarisiz(null,
      'fix ödendi ama sipariş güncellenemedi (sipariş ' + order.id + ', ödeme ' + String(data.paymentId || '-') + ')'),
      { type: 'alert', priority: true });
    return back(res, order.id, 'pending');
  }
  const row = rows && rows[0];
  if (row) {
    /* Huni: yalnızca sipariş GERÇEKTEN pending → paid geçtiğinde (koşullu
       güncelleme), yani sipariş başına bir kez. Kaynak dönüş adresinden. */
    await funnel.record('fix_paid', req.query && req.query.kaynak);
    await tg.sendTelegram(tg.mesaj.fixOdendi(row.id, row.domain) + '\nÖdeme: ' + String(data.paymentId || '-')
      + ' · ' + String(data.paidPrice || data.price) + ' TL (KDV dahil, iyzico)', { type: 'payment', priority: true });
  }
  return back(res, order.id, 'success');
}

module.exports = tg.ucuSar(handler, '/api/fix-pay-return');
module.exports.verify = verify;
