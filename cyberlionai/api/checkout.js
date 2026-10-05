'use strict';

/**
 * Ödeme başlatma — iyzico Subscription v2 barındırılan formuna yönlendirir.
 *
 *   GET /api/checkout?plan=pro
 *   GET /api/checkout?plan=enterprise
 *
 * NEDEN STRIPE DEĞİL
 *
 * Stripe Payment Link yolu iptal edildi: Stripe Türkiye'deki şahıs şirketinde
 * canlıya geçmiyor. iyzico Subscription v2 geçiyor ve barındırılan ödeme formu
 * sunuyor; kart numarası bizim sunucumuza hiç gelmiyor.
 *
 * NEDEN BİR UÇ, NEDEN HTML'DE DÜZ BAĞLANTI DEĞİL
 *
 * Abonelik formunun adresi her müşteri için iyzico'dan ayrı alınıyor; sayfaya
 * gömülebilecek sabit bir adres yok. Ayrıca sağlayıcı değişimi (Stripe →
 * iyzico) HTML'e hiç dokunmadan oldu: /pricing butonları aynı adrese bakıyor.
 *
 * YAPILANDIRILMAMIŞSA UYDURMUYOR
 *
 * Anahtar yoksa, kısa/yer tutucu bir anahtarsa ya da plan referansı tanımsızsa
 * uç 503 `checkout_unconfigured` dönüyor ve tarayıcı /pricing'e geri gidiyor;
 * sayfa orada ödemenin henüz açılmadığını yazıyor. Çalışmayan bir ödeme
 * sayfasına yönlendirmek, müşteriyi ödeme sandığı bir hataya göndermek olurdu.
 *
 * GİRİŞ ZORUNLU
 *
 * Abonelik bir HESABA bağlanıyor: iyzico'nun müşteri kaydı ve bizim
 * `cl_subscriptions` satırımız kullanıcı kimliği olmadan kurulamaz. Anonim
 * tarayıcı /panel'e gönderiliyor (giriş, sonra ödeme), makine isteği 401 alıyor.
 *
 * NE LOGLANMIYOR
 *
 * Form adresi, form jetonu, anahtarlar ve imza LOGLANMIYOR; hata kayıtlarına
 * yalnızca sebep kodu ve plan adı giriyor.
 *
 * BİLİNEN EKSİKLER
 *
 * 1. iyzico'nun müşteri kaydı ad, soyad, TC kimlik ve adres isteyebiliyor;
 *    elimizde yalnızca e-posta var. Bu alanlar gerekiyorsa iyzico `errorCode`
 *    ile reddediyor ve ödeme açılmıyor — uydurma bir TC kimlik numarası
 *    göndermek seçenek değil. Gerekirse ödeme öncesi küçük bir form eklenecek.
 * 2. Pro'nun "ayda 50 tarama" sınırı hâlâ kodda zorlanmıyor (Faz 6).
 */

const { isPaidPlan, plan: planOf, PLANS } = require('./_lib/plans.js');
const iyzico = require('./_lib/iyzico.js');
const auth = require('./_lib/auth.js');

/* Plan başına fiyat planı referansı. iyzico panelinde (ya da
   createPricingPlan ile) bir kez oluşturulup env'e yazılıyor; kodda sabit
   referans tutmak, sandbox ile canlıyı karıştırmak demekti. */
const PLAN_REF_ENV = {
  pro: 'IYZICO_PRICING_PLAN_PRO',
  enterprise: 'IYZICO_PRICING_PLAN_ENTERPRISE'
};

function pricingPlanRef(planId) {
  const name = PLAN_REF_ENV[planId];
  if (!name) return null;
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * /odeme formundaki "Ad Soyad"ı iyzico'nun ad/soyad alanlarına böler: son
 * kelime soyad, öncesi ad. Geçersizse (boş, tek kelime, aşırı uzun, harf
 * dışı karakter) e-postadan türetilen eski yer tutucuya döner.
 */
function customerName(raw, email) {
  const fallback = { name: String(email || '').split('@')[0] || 'Musteri', surname: '-' };
  if (typeof raw !== 'string') return fallback;
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 100) return fallback;
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(clean)) return fallback;
  const parts = clean.split(' ');
  if (parts.length < 2) return fallback;
  return { name: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

/** İsteği bir tarayıcı gezinmesi mi yapıyor: cevap HTML mi JSON mu olacak. */
function wantsHtml(req) {
  const accept = (req.headers && req.headers.accept) || '';
  return String(accept).indexOf('text/html') !== -1;
}

/** Ödeme dönüşünün geleceği adres. Host başlığından kuruluyor. */
function callbackUrl(req) {
  const configured = process.env.SITE_URL;
  if (typeof configured === 'string' && /^https:\/\//.test(configured.trim())) {
    return configured.trim().replace(/\/+$/, '') + '/api/checkout-return';
  }
  const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  return 'https://' + String(host) + '/api/checkout-return';
}

function unavailable(req, res, reason, planId) {
  if (console && console.warn) console.warn('checkout: ' + reason + ' (plan=' + planId + ')');
  if (wantsHtml(req)) {
    res.setHeader('Location', '/pricing?checkout=unavailable&plan=' + encodeURIComponent(planId));
    return res.status(303).end();
  }
  return res.status(503).json({ error: { code: 'checkout_unconfigured' } });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  /* --- Ödemenin durumu (kamuya açık) ---
     /pricing sayfası "test modu" rozetini buna göre gösteriyor. Dönen şey bir
     sır değil: ödemenin açık olup olmadığı ve sandbox mı olduğu. Müşterinin
     gerçek bir kart girmeden önce bunu BİLMESİ gerekiyor. Anahtar, referans
     kodu ya da adres dönmüyor. */
  if (req.query && req.query.mode !== undefined) {
    const ready = iyzico.isConfigured() && iyzico.isEnabled();
    return res.status(200).json({
      enabled: ready,
      testMode: ready ? iyzico.isSandbox() : null,
      plans: ready
        ? Object.keys(PLAN_REF_ENV).filter(function (id) { return pricingPlanRef(id) !== null; })
        : []
    });
  }

  const planId = String((req.query && req.query.plan) || '').toLowerCase();

  if (!planId) {
    return res.status(400).json({ error: { code: 'missing_plan' } });
  }
  if (!planOf(planId) || !isPaidPlan(planId)) {
    /* Free planın ödemesi yok; bilinmeyen plan da buraya düşer. */
    return res.status(400).json({ error: { code: 'invalid_plan' } });
  }

  /* --- Yapılandırma --- */
  if (!iyzico.isConfigured() || !iyzico.isEnabled()) {
    return unavailable(req, res, 'iyzico_unconfigured', planId);
  }
  const planRef = pricingPlanRef(planId);
  if (!planRef) {
    return unavailable(req, res, 'pricing_plan_ref_missing', planId);
  }

  /* --- Giriş --- */
  if (!auth.isConfigured()) {
    return unavailable(req, res, 'auth_unavailable', planId);
  }
  const user = await auth.resolveUser(req, res);
  if (!user) {
    if (wantsHtml(req)) {
      res.setHeader('Location', '/panel?checkout=' + encodeURIComponent(planId));
      return res.status(303).end();
    }
    return res.status(401).json({ error: { code: 'auth_required' } });
  }

  /* --- iyzico aboneliği --- */
  let init;
  try {
    init = await iyzico.initializeCheckoutForm({
      callbackUrl: callbackUrl(req),
      pricingPlanRef: planRef,
      customer: Object.assign(
        /* /odeme formundan gelen ad soyad varsa o; yoksa e-postadan türetilen
           yer tutucu. iyzico daha fazlasını isterse `errorCode` ile
           reddediyor; uydurma TC kimlik gönderilmiyor. */
        { email: user.email || '' },
        customerName(req.query && req.query.ad, user.email)
      )
    });
  } catch (err) {
    return unavailable(req, res, 'iyzico_error', planId);
  }

  if (!init.ok) {
    return unavailable(req, res, init.reason, planId);
  }

  /* 303: tarayıcı GET ile izlesin; geri tuşu ödeme sayfasına değil fiyat
     sayfasına dönsün. Adresin host'u iyzico'nun kendi alan adı olduğu
     `formUrlOf` içinde zaten doğrulandı. */
  res.setHeader('Location', init.url);
  return res.status(303).end();
};

module.exports.pricingPlanRef = pricingPlanRef;
module.exports.wantsHtml = wantsHtml;
module.exports.customerName = customerName;
module.exports.callbackUrl = callbackUrl;
module.exports.PLAN_REF_ENV = PLAN_REF_ENV;
module.exports.PLANS = PLANS;
