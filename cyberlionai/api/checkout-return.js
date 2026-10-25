'use strict';

/**
 * Ödeme dönüşü — müşteri iyzico formundan siteye geri geldiğinde.
 *
 *   POST /api/checkout-return   (iyzico form jetonu ile gönderiyor)
 *   GET  /api/checkout-return?token=…
 *
 * NEDEN ABONELİK SATIRI BURADA AÇILIYOR
 *
 * Aboneliğin HANGİ hesaba ait olduğunu söyleyen eşleme yalnızca burada
 * kurulabiliyor: istek müşterinin oturum çerezini taşıyor. Webhook sunucudan
 * sunucuya geliyor ve oturumu yok; bu yüzden webhook yeni satır AÇMIYOR,
 * yalnızca burada açılmış satırın durumunu güncelliyor. Eşlemesi olmayan bir
 * referans için satır açmak, aboneliği rastgele bir hesaba yazmak olurdu.
 *
 * GÖVDEYE GÜVENİLMİYOR
 *
 * Jeton istekten geliyor ama durum istekten OKUNMUYOR: abonelik durumu
 * iyzico'ya sorulup oradan alınıyor. "status=SUCCESS" yazan bir POST'u kabul
 * etmek, kendini Enterprise ilan etmenin en kısa yolu olurdu.
 *
 * NE LOGLANMIYOR
 *
 * Jeton, imza ve anahtarlar LOGLANMIYOR; yalnızca sebep kodu.
 *
 * TELEGRAM
 *
 * Başarılı / beklemede / başarısız sonuçların hepsi öncelikli hattan
 * bildiriliyor (maskeli e-posta). Başarı ve beklemede mesajı abonelik
 * referansı başına BİR kez gidiyor: müşteri dönüş sayfasını yenilerse
 * kanala ikinci "ödeme başarılı" düşmesin.
 */

const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const iyzico = require('./_lib/iyzico.js');
const iyzicoPlans = require('./_lib/iyzico-plans.js');
const store = require('./_lib/store.js');
/* checkout.js ile aynı: ödeme formu token'ı → hesap. */
const PENDING_PREFIX = 'cl:checkout:pending:';
const tg = require('./_lib/telegram.js');
const funnel = require('./_lib/funnel.js');
const n8n = require('./_lib/n8n.js');

/** Başarısız ödeme: öncelikli uyarı. Sarmalayıcının genel uyarısı bastırılır. */
async function bildirBasarisiz(res, user, sebep) {
  tg.bildirimIsaretle(res);
  await tg.sendTelegram(tg.mesaj.odemeBasarisiz(user && user.email, sebep),
    { type: 'alert', priority: true });
}

const TOKEN_RE = /^[A-Za-z0-9-]{8,64}$/;

function readToken(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const fromBody = body && typeof body === 'object' ? (body.token || body.checkoutFormToken) : null;
  const fromQuery = req.query && (req.query.token || req.query.checkoutFormToken);
  const token = String(fromBody || fromQuery || '').trim();
  return TOKEN_RE.test(token) ? token : null;
}

/** Müşteriyi panele gönderir; sonucu panel gösteriyor. */
function backToPanel(res, state) {
  res.setHeader('Location', '/panel?checkout=' + encodeURIComponent(state));
  return res.status(303).end();
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!iyzico.isConfigured() || !db.isConfigured() || !auth.isConfigured()) {
    return backToPanel(res, 'unavailable');
  }

  /* Token önce: iyzico'nun dönüşü siteler arası POST, SameSite=Lax oturum
     çerezi gelmez (canlı deneme 2026-10-22: hiçbir iz kalmadan 'login'e
     düşüyordu). Kullanıcı çerezden, yoksa ödeme başlarken kaydedilen
     token → hesap eşlemesinden bulunur. Hiçbir değer loglanmaz. */
  const token = readToken(req);
  const sessionUser = await auth.resolveUser(req, res);
  const user = sessionUser || await pendingUser(token);
  if (console && console.warn) {
    console.warn('checkout-return: received method=' + req.method + ' token=' + (token ? 'yes' : 'no')
      + ' session=' + (sessionUser ? 'yes' : 'no') + ' user=' + (user ? 'yes' : 'no'));
  }
  if (!token) return backToPanel(res, 'invalid');
  if (!user) {
    /* Ne çerez ne eşleme: ödeme başlatılırken depo yazılamadı ya da süre
       doldu. Müşteri girişe gider; ödeme alındıysa elle eşleme gerekir. */
    await bildirBasarisiz(res, null, 'user_unresolved');
    return backToPanel(res, 'login');
  }

  /* Tek doğru kaynak: iyzico. */
  const result = await iyzico.getCheckoutForm(token);
  if (!result.ok) {
    /* Banka ret kodu (100xx, ör. 10012): müşteriye kartın internet
       alışverişi iznini açmasını ya da başka kart denemesini söyleyen
       'declined'; diğer hatalar genel 'failed'. */
    const reddi = iyzico.isBankDecline(result.errorCode);
    const sebep = reddi
      ? 'bank_declined ' + result.errorCode + ' (ödeme ' + (result.paymentId || '-')
        + ') — banka reddi'
      : (result.reason || 'checkout_form_failed') + (result.errorCode ? ' ' + result.errorCode : '');
    if (console && console.warn) {
      console.warn('checkout-return: ' + (reddi ? 'bank_declined' : result.reason)
        + (result.errorCode ? ' ' + result.errorCode : '') + ' paymentId=' + (result.paymentId || '-'));
    }
    await bildirBasarisiz(res, user, sebep);
    return backToPanel(res, reddi ? 'declined' : 'failed');
  }

  const data = result.data || {};
  /* Sonucun durum alanları (değer değil kimlik bilgisi taşımıyor). */
  if (console && console.warn) {
    console.warn('checkout-return: iyzico result status=' + String(data.status || '-')
      + ' subscriptionStatus=' + String(data.subscriptionStatus || (data.data && data.data.subscriptionStatus) || '-')
      + ' shape=' + iyzico.responseShape(data));
  }
  const subscriptionRef = iyzico.subscriptionRefOf(data);
  if (!subscriptionRef) {
    if (console && console.warn) console.warn('checkout-return: subscription_ref_missing');
    await bildirBasarisiz(res, user, 'subscription_ref_missing');
    return backToPanel(res, 'pending');
  }

  /* Plan, isteğin söylediğinden değil iyzico'nun cevabındaki fiyat planı
     referansından okunuyor (dört seçenek: plan × dönem). Veritabanına plan
     kimliği (pro/enterprise) yazılır; dönem referansta saklı. */
  const option = optionOf(data);
  const planId = option ? option.id : null;
  if (!planId) {
    if (console && console.warn) console.warn('checkout-return: plan_unresolved');
    await bildirBasarisiz(res, user, 'plan_unresolved');
    return backToPanel(res, 'pending');
  }

  const status = String(data.subscriptionStatus || data.status || '').toUpperCase();

  try {
    await db.upsertIyzicoSubscription({
      userId: user.id,
      /* Alan adı burada seçilmiyor: müşteri haftalık taranacak alan adını
         panelden belirliyor. Uydurma bir alan adı yazmak, haftalık taramanın
         yanlış hedefi taraması olurdu. */
      domain: null,
      plan: planId,
      active: iyzico.isActiveStatus(status),
      status: status || null,
      env: iyzico.environmentName(),
      subscriptionRef: subscriptionRef,
      customerRef: data.customerReferenceCode || null,
      planRef: data.pricingPlanReferenceCode || null,
      productRef: data.productReferenceCode || null
    });
  } catch (err) {
    if (console && console.error) console.error('checkout-return: db write failed');
    /* Ödeme alındı ama hesaba yazılamadı: elle müdahale gerekiyor. */
    await bildirBasarisiz(res, user, 'db_write_failed ref=' + subscriptionRef);
    return backToPanel(res, 'pending');
  }

  const aktif = iyzico.isActiveStatus(status);
  n8n.notify('cyberlion-payment', {
    email: user.email || '',
    plan: planId,
    status: aktif ? 'success' : 'pending',
    subscriptionRef: subscriptionRef,
  });
  if (await tg.tekSefer('pay:' + subscriptionRef + ':' + (aktif ? 'active' : 'pending'), 7 * 86400)) {
    /* Huni: başarı abonelik başına BİR kez (tekSefer), ödemenin başladığı
       kaynakla. Kaynak bekleyen eşlemeden okunur; yoksa 'direct'. */
    if (aktif) await funnel.record('checkout_success', await pendingKaynak(token));
    await tg.sendTelegram(aktif
      ? tg.mesaj.odemeBasarili(user.email, option.key, subscriptionRef, option.priceTry)
      : tg.mesaj.odemeBeklemede(user.email, planId, status || 'unknown'),
      { type: 'payment', priority: true });
  }

  return backToPanel(res, aktif ? 'active' : 'pending');
}

/* 500/502/504 ya da fırlatan bir hata kritik uyarı üretir (bkz. telegram.js). */
module.exports = tg.ucuSar(handler, '/api/checkout-return');

/**
 * iyzico'nun cevabındaki fiyat planı referansını ödeme seçeneğine çevirir.
 * Eşleşme env üzerinden (bkz. _lib/iyzico-plans.js): referans kodları
 * sandbox ile canlıda farklı.
 */
function optionOf(data) {
  return iyzicoPlans.optionOfRef(data && data.pricingPlanReferenceCode);
}

/** Plan kimliği (pro/enterprise); eşleşmezse null. */
function planOf(data) {
  const opt = optionOf(data);
  return opt ? opt.id : null;
}

/** Ödeme başlarken kaydedilen huni kaynağı; yoksa null ('direct' sayılır). */
async function pendingKaynak(token) {
  if (!token || !store.isConfigured()) return null;
  try {
    const v = await store.cacheGet(PENDING_PREFIX + token);
    return v && typeof v.kaynak === 'string' ? v.kaynak : null;
  } catch (err) {
    return null;
  }
}

/** Ödeme başlarken kaydedilen token → hesap eşlemesi; yoksa null. */
async function pendingUser(token) {
  if (!token || !store.isConfigured()) return null;
  try {
    const v = await store.cacheGet(PENDING_PREFIX + token);
    return v && typeof v.id === 'string' && v.id ? { id: v.id, email: typeof v.email === 'string' ? v.email : '' } : null;
  } catch (err) {
    return null;
  }
}

module.exports.readToken = readToken;
module.exports.pendingUser = pendingUser;
module.exports.planOf = planOf;
module.exports.optionOf = optionOf;
