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
const { plan: planDef } = require('./_lib/plans.js');
const tg = require('./_lib/telegram.js');
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

  const user = await auth.resolveUser(req, res);
  if (!user) {
    /* Oturum düşmüşse abonelik satırı açılamaz; müşteri girişe gidiyor ve
       webhook durumu zaten iyzico tarafında duruyor. */
    return backToPanel(res, 'login');
  }

  const token = readToken(req);
  if (!token) return backToPanel(res, 'invalid');

  /* Tek doğru kaynak: iyzico. */
  const result = await iyzico.getCheckoutForm(token);
  if (!result.ok) {
    if (console && console.warn) console.warn('checkout-return: ' + result.reason);
    await bildirBasarisiz(res, user, result.reason || 'checkout_form_failed');
    return backToPanel(res, 'failed');
  }

  const data = result.data || {};
  const subscriptionRef = iyzico.subscriptionRefOf(data);
  if (!subscriptionRef) {
    if (console && console.warn) console.warn('checkout-return: subscription_ref_missing');
    await bildirBasarisiz(res, user, 'subscription_ref_missing');
    return backToPanel(res, 'pending');
  }

  /* Plan, fiyat planı referansından değil iyzico'nun cevabından okunuyor;
     hangi plana abone olduğunu müşterinin isteği söylemiyor. */
  const planId = planOf(data);
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
    const tanim = planDef(planId);
    await tg.sendTelegram(aktif
      ? tg.mesaj.odemeBasarili(user.email, planId, subscriptionRef, tanim && tanim.priceTry)
      : tg.mesaj.odemeBeklemede(user.email, planId, status || 'unknown'),
      { type: 'payment', priority: true });
  }

  return backToPanel(res, aktif ? 'active' : 'pending');
}

/* 500/502/504 ya da fırlatan bir hata kritik uyarı üretir (bkz. telegram.js). */
module.exports = tg.ucuSar(handler, '/api/checkout-return');

/**
 * iyzico'nun cevabındaki fiyat planı referansını bizim plan kimliğimize
 * çevirir. Eşleşme env üzerinden: referans kodları sandbox ile canlıda farklı.
 */
function planOf(data) {
  const ref = String((data && data.pricingPlanReferenceCode) || '').trim();
  if (!ref) return null;
  if (ref === String(process.env.IYZICO_PRICING_PLAN_PRO || '').trim()) return 'pro';
  if (ref === String(process.env.IYZICO_PRICING_PLAN_ENTERPRISE || '').trim()) return 'enterprise';
  return null;
}

module.exports.readToken = readToken;
module.exports.planOf = planOf;
