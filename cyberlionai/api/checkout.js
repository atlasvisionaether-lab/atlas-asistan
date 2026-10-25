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
 * TELEGRAM
 *
 * Başlatılan ödeme öncelikli hattan bildiriliyor (maskeli e-posta, plan,
 * tutar). Ödemeyi açamayan her durum uyarı olarak gidiyor. Yapılandırma
 * eksikliği gibi her tıklamada tekrar eden sebepler saatte bir kez gidiyor;
 * yoksa her ziyaretçi kanala aynı mesajı yazardı.
 *
 * BİLİNEN EKSİKLER
 *
 * 1. iyzico'nun müşteri kaydı ad, soyad, TC kimlik ve adres isteyebiliyor;
 *    elimizde yalnızca e-posta var. Bu alanlar gerekiyorsa iyzico `errorCode`
 *    ile reddediyor ve ödeme açılmıyor — uydurma bir TC kimlik numarası
 *    göndermek seçenek değil. Gerekirse ödeme öncesi küçük bir form eklenecek.
 * 2. Pro'nun "ayda 50 tarama" sınırı hâlâ kodda zorlanmıyor (Faz 6).
 */

const { PLANS, checkoutOption } = require('./_lib/plans.js');
const iyzicoPlans = require('./_lib/iyzico-plans.js');
const billing = require('./_lib/billing-details.js');
const store = require('./_lib/store.js');
const funnel = require('./_lib/funnel.js');

/* Ödeme formu token'ı → hesap eşlemesi (bkz. checkout-return.js). iyzico
   token'ı 30 dk geçerli; pay bırakıldı. */
const PENDING_TTL_SECONDS = 2 * 3600;
const PENDING_PREFIX = 'cl:checkout:pending:';
const iyzico = require('./_lib/iyzico.js');
const auth = require('./_lib/auth.js');
const tg = require('./_lib/telegram.js');

/* Hesaba bağlı olmayan, her tıklamada tekrarlayan sebepler: saatte bir bildirim. */
const TEKRARLI_SEBEPLER = ['iyzico_unconfigured', 'pricing_plan_ref_missing', 'auth_unavailable'];

/* Ödeme seçeneği (plan × dönem) başına fiyat planı referansı: env'den,
   bkz. _lib/iyzico-plans.js. Eski `pro`/`enterprise` adları aylık. */
const PLAN_REF_ENV = iyzicoPlans.PLAN_REF_ENV;
const pricingPlanRef = iyzicoPlans.refOf;

/** POST gövdesi (application/x-www-form-urlencoded ya da JSON) → düz nesne.
    Vercel gövdeyi ayrıştırır; ham metin gelirse burada ayrıştırılır. */
function formBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : '');
  if (!raw) return {};
  if (/^\s*\{/.test(raw)) { try { return JSON.parse(raw) || {}; } catch (e) { return {}; } }
  const out = {};
  new URLSearchParams(raw).forEach(function (v, k) { out[k] = v; });
  return out;
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

async function unavailable(req, res, reason, planId, user) {
  if (console && console.warn) console.warn('checkout: ' + reason + ' (plan=' + planId + ')');
  const bildir = TEKRARLI_SEBEPLER.indexOf(reason) === -1
    || await tg.tekSefer('checkout:' + reason + ':' + planId, 3600);
  if (bildir) {
    tg.bildirimIsaretle(res);
    await tg.sendTelegram(
      tg.mesaj.odemeBasarisiz(user && user.email, reason + ' (plan=' + planId + ')'),
      { type: 'alert', priority: true });
  }
  if (wantsHtml(req)) {
    res.setHeader('Location', '/pricing?checkout=unavailable&plan=' + encodeURIComponent(planId));
    return res.status(303).end();
  }
  return res.status(503).json({ error: { code: 'checkout_unconfigured' } });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  /* POST: /odeme formu. Fatura bilgileri (telefon, adres, isteğe bağlı TC
     kimlik) URL'de değil gövdede gelir: tarayıcı geçmişine, erişim
     kayıtlarına ve yönlendirme başlıklarına düşmesin (KVKK). GET eski
     bağlantılar ve durum ucu (?mode=1) için. */
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  const params = req.method === 'POST' ? formBody(req) : (req.query || {});

  /* --- Ödemenin durumu (kamuya açık) ---
     /pricing sayfası "test modu" rozetini buna göre gösteriyor. Dönen şey bir
     sır değil: ödemenin açık olup olmadığı ve sandbox mı olduğu. Müşterinin
     gerçek bir kart girmeden önce bunu BİLMESİ gerekiyor. Anahtar, referans
     kodu ya da adres dönmüyor. */
  if (req.method === 'GET' && req.query && req.query.mode !== undefined) {
    const ready = iyzico.isConfigured() && iyzico.isEnabled();
    return res.status(200).json({
      enabled: ready,
      testMode: ready ? iyzico.isSandbox() : null,
      /* Referansı tanımlı seçenekler: pro_monthly, pro_yearly, … */
      plans: ready ? iyzicoPlans.readyKeys() : []
    });
  }

  /* `planId` istekteki değer (yönlendirmelerde aynen geri yazılır, sayfa
     seçimi korunsun); `option` çözülmüş seçenek. */
  const planId = String(params.plan || '').trim().toLowerCase();

  if (!planId) {
    return res.status(400).json({ error: { code: 'missing_plan' } });
  }
  const option = checkoutOption(planId);
  if (!option) {
    /* Free planın ödemesi yok; bilinmeyen plan ya da dönem de buraya düşer. */
    return res.status(400).json({ error: { code: 'invalid_plan' } });
  }

  /* --- Tarama yetkisi beyanı ---
     Ödeme, kullanıcının taranacak alan adlarının sahibi ya da yetkilisi
     olduğunu beyan etmesine bağlı (fiyatlandırmadaki onay kutusu). Beyan
     yoksa ödeme BAŞLAMAZ; tarayıcı fiyat sayfasına geri gönderilir. */
  if (params.declaration !== '1') {
    if (wantsHtml(req)) {
      res.setHeader('Location', '/pricing?checkout=declaration_required&plan=' + encodeURIComponent(planId));
      return res.status(303).end();
    }
    return res.status(400).json({ error: { code: 'declaration_required' } });
  }

  /* --- Sözleşme onayı ---
     Mesafeli Sözleşmeler Yönetmeliği: tüketici ön bilgilendirmeyi ve
     sözleşmeyi okuduğunu SİPARİŞTEN ÖNCE onaylamalı. Fiyat sayfasındaki
     ikinci kutu; onaysız ödeme başlamaz. */
  if (params.agreements !== '1') {
    if (wantsHtml(req)) {
      res.setHeader('Location', '/pricing?checkout=agreements_required&plan=' + encodeURIComponent(planId));
      return res.status(303).end();
    }
    return res.status(400).json({ error: { code: 'agreements_required' } });
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

  /* --- Fatura bilgileri ---
     iyzico abonelik formunu ad, cep telefonu, TC kimlik ve fatura adresi
     olmadan başlatmıyor (200702). Eksik/geçersizse ödeme başlamaz, müşteri
     hangi alanın düzeltilmesi gerektiğiyle forma döner; değer geri
     yansıtılmaz, loglanmaz. Giriş kontrolünden SONRA: girişe gönderilen
     müşterinin bilgisi zaten taşınmıyor. */
  const details = billing.buildCustomer(params, user.email, customerName);
  if (!details.ok) {
    if (wantsHtml(req) || req.method === 'POST') {
      res.setHeader('Location', '/odeme?plan=' + encodeURIComponent(planId)
        + '&checkout=details_required&field=' + encodeURIComponent(details.field));
      return res.status(303).end();
    }
    return res.status(400).json({ error: { code: 'details_required', field: details.field } });
  }

  /* --- iyzico aboneliği --- */
  let init;
  try {
    init = await iyzico.initializeCheckoutForm({
      callbackUrl: callbackUrl(req),
      pricingPlanRef: planRef,
      customer: details.customer
    });
  } catch (err) {
    return unavailable(req, res, 'iyzico_error', planId, user);
  }

  if (!init.ok) {
    return unavailable(req, res, init.reason, planId, user);
  }

  /* iyzico'nun dönüşü cpp.iyzipay.com'dan siteler arası POST: SameSite=Lax
     oturum çerezi o istekte GÖNDERİLMİYOR, dönüş ucu kullanıcıyı çerezden
     tanıyamaz. Token → hesap eşlemesi sunucuda tutuluyor; dönüş ucu
     kullanıcıyı buradan bulur, sonucu yine iyzico'ya sorarak doğrular.
     Depo yazılamazsa ödeme durmaz (çerez geldiyse dönüş yine çalışır). */
  if (init.token && store.isConfigured()) {
    try {
      /* `kaynak`: huni sayacı için (bkz. _lib/funnel.js); dönüşte başarı da
         aynı kaynakla sayılır. Kimlik değil, izinli listeden bir araç adı. */
      await store.cacheSet(PENDING_PREFIX + init.token,
        { id: user.id, email: user.email || '', kaynak: funnel.source(params.kaynak) }, PENDING_TTL_SECONDS);
    } catch (err) {
      if (console && console.warn) console.warn('checkout: pending_map_failed');
    }
  }

  await tg.sendTelegram(tg.mesaj.odemeBasladi(option.key, user.email, option.priceTry),
    { type: 'payment', priority: true });

  /* 303: tarayıcı GET ile izlesin; geri tuşu ödeme sayfasına değil fiyat
     sayfasına dönsün. Adresin host'u iyzico'nun kendi alan adı olduğu
     `formUrlOf` içinde zaten doğrulandı. */
  await funnel.record('checkout_start', params.kaynak);

  res.setHeader('Location', init.url);
  return res.status(303).end();
}

/* 500/502/504 ya da fırlatan bir hata kritik uyarı üretir (bkz. telegram.js). */
module.exports = tg.ucuSar(handler, '/api/checkout');
module.exports.pricingPlanRef = pricingPlanRef;
module.exports.wantsHtml = wantsHtml;
module.exports.customerName = customerName;
module.exports.formBody = formBody;
module.exports.PENDING_PREFIX = PENDING_PREFIX;
module.exports.callbackUrl = callbackUrl;
module.exports.PLAN_REF_ENV = PLAN_REF_ENV;
module.exports.PLANS = PLANS;
