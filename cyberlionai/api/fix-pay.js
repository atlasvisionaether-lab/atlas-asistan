'use strict';

/**
 * "Biz düzeltelim" siparişinin çevrimiçi ödemesi: iyzico tek seferlik form.
 *
 *   POST /api/fix-pay  (form, /fix-checkout'tan)
 *     { orderId, ad, gsm, adres, il, ilce, ulke, tckn }
 *     → 303 iyzico ödeme sayfası | 303 /fix-checkout?orderId=…&pay=<durum>
 *
 * KURALLAR
 *   - Giriş zorunlu; sipariş bu hesabın ve 'pending' olmalı.
 *   - TUTAR İSTEMCİDEN ALINMAZ: veritabanındaki price_discounted (KDV hariç)
 *     → grossTry (KDV dahil, karttan çekilen).
 *   - Fatura bilgileri abonelikteki gibi (billing-details.js): gövdede gelir,
 *     loglanmaz, veritabanına yazılmaz, yalnızca iyzico'ya gider.
 *   - iyzico'nun dönüşü siteler arası POST (SameSite=Lax çerez gelmez).
 *     Önbellekte eşleme TUTULMUYOR: iyzico'nun sonucu basketId (= sipariş)
 *     taşıyor; fix-pay-return siparişi ve beklenen tutarı VERİTABANINDAN
 *     okur (PR #115 incelemesi: eşleme yazılamazsa ödeme alınıp sipariş
 *     ödenmemiş kalıyordu).
 */

const auth = require('./_lib/auth.js');
const db = require('./_lib/db.js');
const iyzico = require('./_lib/iyzico.js');
const billing = require('./_lib/billing-details.js');
const pricing = require('./_lib/fixpricing.js');
const tg = require('./_lib/telegram.js');
const { clientIp } = require('./_lib/session.js');
const { formBody, customerName } = require('./checkout.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(res, orderId, durum, alan) {
  res.setHeader('Location', '/fix-checkout?orderId=' + encodeURIComponent(orderId || '')
    + '&pay=' + encodeURIComponent(durum) + (alan ? '&field=' + encodeURIComponent(alan) : ''));
  return res.status(303).end();
}

function callbackUrl(req) {
  const configured = process.env.SITE_URL;
  if (typeof configured === 'string' && /^https:\/\//.test(configured.trim())) {
    return configured.trim().replace(/\/+$/, '') + '/api/fix-pay-return';
  }
  const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  return 'https://' + String(host) + '/api/fix-pay-return';
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  const params = formBody(req);
  const orderId = String(params.orderId || '');
  if (!UUID_RE.test(orderId)) return back(res, '', 'invalid');
  if (!auth.isConfigured() || !db.isConfigured() || !iyzico.isConfigured() || !iyzico.isEnabled()) {
    return back(res, orderId, 'unavailable');
  }
  const user = await auth.resolveUser(req, res);
  if (!user) return back(res, orderId, 'login');

  let order;
  try {
    const rows = await db.request('fix_orders?id=eq.' + encodeURIComponent(orderId)
      + '&user_id=eq.' + encodeURIComponent(user.id) + '&select=id,domain,type,price_discounted,status&limit=1');
    order = rows && rows[0];
  } catch (err) {
    return back(res, orderId, 'unavailable');
  }
  if (!order) return back(res, orderId, 'invalid');
  if (order.status !== 'pending') return back(res, orderId, 'already');

  const details = billing.buildCustomer(params, user.email, customerName);
  if (!details.ok) return back(res, orderId, 'details_required', details.field);
  const alici = billing.buyerFrom(details.customer, user.id, clientIp(req));
  const tutar = pricing.grossTry(order.price_discounted);

  let init;
  try {
    init = await iyzico.initializePaymentForm({
      orderId: order.id, priceTry: tutar, callbackUrl: callbackUrl(req),
      buyer: alici.buyer, address: alici.address,
      itemName: 'Yazılım Güvenlik Düzeltme Hizmeti — ' + (order.type === 'full' ? 'tam paket' : 'seçili bulgular')
    });
  } catch (err) {
    init = { ok: false, reason: 'iyzico_error' };
  }
  if (!init.ok) {
    if (console && console.warn) console.warn('fix-pay: ' + init.reason);
    await tg.sendTelegram(tg.mesaj.odemeBasarisiz(user.email, 'fix ' + init.reason + ' (sipariş ' + order.id + ')'),
      { type: 'alert', priority: true });
    return back(res, orderId, 'unavailable');
  }
  res.setHeader('Location', init.url);
  return res.status(303).end();
}

module.exports = tg.ucuSar(handler, '/api/fix-pay');
module.exports.callbackUrl = callbackUrl;
