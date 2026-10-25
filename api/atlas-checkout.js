'use strict';

/**
 * atlasasistan.com sipariş formu → iyzico barındırılan ödeme sayfası.
 *
 *   GET  /api/atlas-checkout?mode=1   → { enabled, testMode }  (panel ödeme
 *                                       kapalıysa formu açmaz; WhatsApp'a düşülmez)
 *   POST /api/atlas-checkout  (JSON)  → 200 { url } | 400 { errors, messages }
 *                                       | 401 | 403 | 503 | 502
 *
 * Çağıran müşteri paneli (başka origin, CORS — bkz. _atlas/panel.js). Oturum
 * ZORUNLU: Authorization: Bearer <Supabase jetonu>; sipariş jetonun kurumuna
 * bağlanır (atlas_orders.organization_id). Yalnız owner/manager ödeme başlatır.
 *
 * Akış: gövde atlas-billing.js ile doğrulanır → atlas_orders'a 'pending' satır
 * → iyzico formu başlatılır → jeton özeti siparişe yazılır → tarayıcı iyzico'ya
 * gider. Dönüş: atlas-checkout-return → panelin Kurulum ekranı.
 *
 *   standart / pro  → abonelik (iyzico Subscription v2)
 *   starter / vip   → tek seferlik kurulum ödemesi; aylık ücret teslimde ayrı
 *
 * TUTAR istemciden alınmaz (api/_atlas/plans.js).
 *
 * identityNumber iyzico'da ZORUNLU alan: TC (bireysel) ya da VKN (kurumsal)
 * girilmediyse — ve yurt dışı müşteride — GİB'in kimliği bilinmeyen alıcı
 * değeri 11111111111 gider (cyberlionai billing-details.js ile aynı).
 *
 * Fatura bilgileri ve telefon LOGLANMAZ; hata kayıtlarında yalnızca sebep kodu.
 */

const billingRules = require('../atlas-billing.js');
const plans = require('./_atlas/plans.js');
const orders = require('./_atlas/orders.js');
const iyzico = require('../cyberlionai/api/_lib/iyzico.js');
const { UNKNOWN_TCKN, buyerFrom } = require('../cyberlionai/api/_lib/billing-details.js');
const { clientIp } = require('../cyberlionai/api/_lib/session.js');
const tg = require('../cyberlionai/api/_lib/telegram.js');
const panel = require('./_atlas/panel.js');

function jsonBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : '');
  try { return raw ? JSON.parse(raw) || {} : {}; } catch (e) { return {}; }
}

function isReady() {
  return plans.checkoutEnabled() && iyzico.isConfigured() && iyzico.isEnabled() && orders.isConfigured();
}

function callbackUrl(req) {
  const configured = String(process.env.SITE_URL || '').trim();
  if (/^https:\/\//.test(configured)) return configured.replace(/\/+$/, '') + '/api/atlas-checkout-return';
  const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  return 'https://' + String(host) + '/api/atlas-checkout-return';
}

/** "Ad Soyad" → iyzico ad/soyad: son kelime soyad. */
function splitName(full) {
  const parts = full.split(' ');
  return { name: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

/** İngilizce ülke adı (iyzico adres alanı serbest metin; örnekleri İngilizce). */
function countryName(iso2) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(iso2) || iso2; } catch (e) { return iso2; }
}

function identityOf(billing) {
  return billing.tcNo || billing.taxNo || UNKNOWN_TCKN;
}

/** Doğrulanmış formdan iyzico abonelik müşterisi (SubscriptionCustomer). */
function customerOf(v) {
  const n = splitName(v.name);
  const address = {
    contactName: v.name,
    city: v.city,
    country: countryName(v.country),
    address: v.address
  };
  return {
    name: n.name,
    surname: n.surname,
    email: v.email,
    gsmNumber: v.phoneE164,
    identityNumber: identityOf(v.billing),
    billingAddress: address,
    shippingAddress: Object.assign({}, address)
  };
}

/** Hata kodlarını formun dilinde metne çevirir (panel aynı metni gösterir). */
function messagesOf(errors, lang) {
  const out = {};
  Object.keys(errors).forEach(function (field) { out[field] = billingRules.msg(lang, errors[field]); });
  return out;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  panel.cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET' && req.query && req.query.mode !== undefined) {
    const ready = isReady();
    return res.status(200).json({ enabled: ready, testMode: ready ? iyzico.isSandbox() : null });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const body = jsonBody(req);
  const lang = body.lang === 'en' ? 'en' : 'tr';
  const plan = plans.planOf(body.plan);
  if (!plan) return res.status(400).json({ error: { code: 'plan' } });

  const checked = billingRules.validateOrder(body);
  if (!checked.ok) {
    return res.status(400).json({ error: { code: 'invalid' }, errors: checked.errors, messages: messagesOf(checked.errors, lang) });
  }

  if (!isReady()) return res.status(503).json({ error: { code: 'unavailable' } });
  const member = await panel.memberFromRequest(req);
  if (!member) return res.status(401).json({ error: { code: 'auth' } });
  if (!panel.canPay(member)) return res.status(403).json({ error: { code: 'role' } });
  const pricingPlanRef = plans.refOf(plan);
  if (plan.kind === 'subscription' && !pricingPlanRef) {
    console.warn('atlas-checkout: pricing_plan_ref_missing (plan=' + plan.id + ')');
    return res.status(503).json({ error: { code: 'unavailable' } });
  }

  const v = checked.value;
  const order = await orders.create(v, plan, lang, member.orgId);
  if (!order) throw new Error('order_create_failed');

  const customer = customerOf(v);
  let result;
  if (plan.kind === 'subscription') {
    result = await iyzico.initializeCheckoutForm({
      callbackUrl: callbackUrl(req),
      pricingPlanRef: pricingPlanRef,
      customer: customer
    });
  } else {
    const party = buyerFrom(customer, order.id, clientIp(req));
    result = await iyzico.initializePaymentForm({
      orderId: order.id,
      priceTry: plan.amountTry,
      callbackUrl: callbackUrl(req),
      buyer: party.buyer,
      address: party.address,
      itemName: plan.name + ' — kurulum'
    });
  }

  if (!result.ok || !result.token) {
    const reason = (result && result.reason) || 'iyzico_token_missing';
    console.warn('atlas-checkout: ' + reason + ' (plan=' + plan.id + ')');
    await orders.settle(order.id, 'failed', { fail_reason: String(reason).slice(0, 80) });
    tg.bildirimIsaretle(res);
    await tg.sendTelegram('[Atlas] ❌ Ödeme açılamadı: ' + tg.maskEmail(v.email)
      + ', plan=' + plan.id + ', sebep=' + String(reason).slice(0, 80), { type: 'alert', priority: true });
    return res.status(502).json({ error: { code: 'payment' } });
  }

  await orders.attachToken(order.id, result.token);
  await tg.sendTelegram('[Atlas] 💳 Ödeme başlatıldı: ' + tg.maskEmail(v.email) + ', plan=' + plan.id
    + ', tutar=' + plan.amountTry + ' TL' + (iyzico.isSandbox() ? ' (sandbox)' : ''), { type: 'payment' });
  return res.status(200).json({ url: result.url });
}

/* 500 ya da fırlatan hata kritik uyarı üretir (bkz. telegram.js ucuSar). */
module.exports = tg.ucuSar(handler, '/api/atlas-checkout');
module.exports.customerOf = customerOf;
module.exports.isReady = isReady;
