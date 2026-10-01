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
 */

const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const iyzico = require('./_lib/iyzico.js');

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

module.exports = async function handler(req, res) {
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
    return backToPanel(res, 'failed');
  }

  const data = result.data || {};
  const subscriptionRef = iyzico.subscriptionRefOf(data);
  if (!subscriptionRef) {
    if (console && console.warn) console.warn('checkout-return: subscription_ref_missing');
    return backToPanel(res, 'pending');
  }

  /* Plan, fiyat planı referansından değil iyzico'nun cevabından okunuyor;
     hangi plana abone olduğunu müşterinin isteği söylemiyor. */
  const planId = planOf(data);
  if (!planId) {
    if (console && console.warn) console.warn('checkout-return: plan_unresolved');
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
    return backToPanel(res, 'pending');
  }

  return backToPanel(res, iyzico.isActiveStatus(status) ? 'active' : 'pending');
};

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
