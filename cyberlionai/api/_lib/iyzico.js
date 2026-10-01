'use strict';

/**
 * iyzico Subscription v2 istemcisi.
 *
 * NEDEN BU SAĞLAYICI
 *
 * Stripe Payment Link iptal edildi: Stripe Türkiye'deki şahıs şirketinde
 * canlıya geçmiyor. iyzico'nun abonelik ürünü (Subscription v2) TR şahıs
 * şirketiyle çalışıyor ve barındırılan ödeme formu sunuyor.
 *
 * HANGİ AKIŞ, NEDEN
 *
 * Barındırılan form (checkout form) akışı kullanılıyor: sunucu iyzico'dan bir
 * form adresi alıyor, müşteri oraya YÖNLENDİRİLİYOR. Kart numarası bizim
 * sunucumuza hiç gelmiyor, PCI kapsamı bizde değil. Diğer seçenek olan
 * `/v2/subscription/initialize` kart alanlarını bizden istiyordu; bir güvenlik
 * ürününün kendi sunucusunda kart numarası taşıması gereksiz bir risk.
 *
 * Form içeriğini sayfaya GÖMMÜYORUZ. Gömmek `script-src`'yi gevşetmek
 * demekti; CSP denetimi satan bir üründe bu tutarsız olurdu. Yönlendirme
 * CSP'ye hiç dokunmuyor.
 *
 * İMZA (IYZWSv2)
 *
 * iyzico isteği şöyle imzalıyor (resmi iyzipay-node istemcisinin kaynağından;
 * docs.iyzico.com bu ortamın ağ ilkesinde kapalı):
 *
 *   payload   = randomKey + uriPath + requestBodyJson      (ARALARINDA AYIRAÇ YOK)
 *   signature = HMAC-SHA256(secretKey, payload) → KÜÇÜK HARF HEX
 *   params    = "apiKey:<key>&randomKey:<rnd>&signature:<hex>"
 *   header    = "IYZWSv2 " + base64(params)
 *
 * `uriPath` bir eğik çizgiyle BAŞLIYOR ve sorgu dizesini İÇERMİYOR.
 * `x-iyzi-rnd` başlığı imzadaki randomKey ile AYNI olmak zorunda.
 *
 * Gövde imzaya birebir girdiği için gövde BİR KEZ stringify ediliyor: imzalanan
 * metin ile gönderilen metin aynı olmalı. İki kez stringify etmek (anahtar
 * sırası değişirse) imzayı geçersiz kılar ve hata "yanlış anahtar" gibi görünür.
 *
 * NE LOGLANMIYOR
 *
 * API anahtarı, gizli anahtar, imza, randomKey, barındırılan form adresi ve
 * form jetonu LOGLANMIYOR. Hata kayıtlarına yalnızca HTTP durumu, iyzico'nun
 * `errorCode`'u ve uç adı giriyor. 20 karakterden kısa bir anahtar
 * yapılandırılmamış sayılıyor: kırpılmış ya da yer tutucu bir değerle
 * iyzico'ya istek atmak, hatayı "ödeme bozuk" olarak müşteriye yansıtırdı.
 */

const crypto = require('node:crypto');

const TIMEOUT_MS = 10000;
const MIN_KEY_LENGTH = 20;
const CLIENT_VERSION = 'cyberlionai-1';

/* iyzico'nun barındırılan form adresinin olabileceği alan adları. Başka bir
   host yönlendirme hedefi OLAMAZ: bir güvenlik ürününün kendi sitesinde açık
   yönlendirme taşıması olmaz. */
const ALLOWED_FORM_HOSTS = [
  'sandbox-cpp.iyzipay.com',
  'cpp.iyzipay.com',
  'sandbox-api.iyzipay.com',
  'api.iyzipay.com',
  'www.iyzico.com',
  'sandbox-ode.iyzico.com',
  'ode.iyzico.com'
];

function trimmed(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Yapılandırma. Eksik ya da kısa anahtar = yapılandırılmamış.
 * Değerler DÖNDÜRÜLÜYOR ama hiçbir yerde loglanmıyor.
 */
function config() {
  const apiKey = trimmed('IYZICO_API_KEY');
  const secretKey = trimmed('IYZICO_SECRET_KEY') || trimmed('IYZICO_SECRET');
  const baseUrl = trimmed('IYZICO_BASE_URL');

  if (apiKey.length < MIN_KEY_LENGTH) return null;
  if (secretKey.length < MIN_KEY_LENGTH) return null;
  if (!baseUrl) return null;

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (err) {
    return null;
  }
  /* Ödeme sağlayıcısına şifresiz bağlanmak olmaz. */
  if (parsed.protocol !== 'https:') return null;

  return {
    apiKey: apiKey,
    secretKey: secretKey,
    /* İmzalanan yol tek bir eğik çizgiyle başlamak zorunda: taban adresin
       sonundaki eğik çizgi atılıyor. */
    baseUrl: baseUrl.replace(/\/+$/, ''),
    host: parsed.hostname
  };
}

function isConfigured() { return config() !== null; }

/**
 * Kill switch. `IYZICO_SUBSCRIPTION_ENABLED` açıkça kapatılmışsa ödeme ucu
 * anahtarlar yerinde olsa bile kapalı kalıyor: canlıya geçmeden önce ucu
 * kapatmanın yolu anahtarı silmek olmamalı.
 */
function isEnabled() {
  const flag = trimmed('IYZICO_SUBSCRIPTION_ENABLED').toLowerCase();
  if (!flag) return true;
  return flag !== 'false' && flag !== '0' && flag !== 'off' && flag !== 'no';
}

/** 'sandbox' | 'production' — taban adresten türetiliyor, elle ayarlanmıyor. */
function environmentName() {
  const cfg = config();
  if (!cfg) return null;
  return /sandbox/i.test(cfg.host) ? 'sandbox' : 'production';
}

function isSandbox() { return environmentName() === 'sandbox'; }

/** iyzico'nun fiyat biçimi: tam sayıya `.0` ekleniyor (299 → "299.0"). */
function formatPrice(value) {
  const n = parseFloat(value);
  if (!isFinite(n)) throw new Error('iyzico_price_invalid');
  const s = String(n);
  return s.indexOf('.') === -1 ? s + '.0' : s;
}

function randomKey() {
  return String(Math.floor(Date.now() / 1000)) + crypto.randomBytes(8).toString('hex');
}

/**
 * IYZWSv2 Authorization başlığı.
 *
 * @param {string} uriPath  '/v2/subscription/...' (sorgu dizesi YOK)
 * @param {string} bodyJson gönderilecek gövdenin BİREBİR metni ('{}' olabilir)
 */
function authorizationHeader(cfg, uriPath, bodyJson, rnd) {
  const payload = rnd + uriPath + bodyJson;
  const signature = crypto.createHmac('sha256', cfg.secretKey).update(payload, 'utf8').digest('hex');
  const params = 'apiKey:' + cfg.apiKey + '&randomKey:' + rnd + '&signature:' + signature;
  return 'IYZWSv2 ' + Buffer.from(params, 'utf8').toString('base64');
}

/**
 * İmzalı istek.
 *
 * @returns {{ok: true, data: object} | {ok: false, reason: string, status?: number}}
 */
async function request(method, uriPath, bodyObject) {
  const cfg = config();
  if (!cfg) return { ok: false, reason: 'iyzico_unconfigured' };

  /* Gövde BİR KEZ metne çevriliyor: imzalanan metin ile gönderilen metin aynı. */
  const bodyJson = JSON.stringify(bodyObject || {});
  const rnd = randomKey();

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(cfg.baseUrl + uriPath, {
      method: method,
      signal: controller.signal,
      headers: {
        'Authorization': authorizationHeader(cfg, uriPath, bodyJson, rnd),
        'x-iyzi-rnd': rnd,
        'x-iyzi-client-version': CLIENT_VERSION,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: method === 'GET' ? undefined : bodyJson
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: 'iyzico_unreachable' };
  }
  clearTimeout(timer);

  let data = null;
  try {
    data = await response.json();
  } catch (err) {
    data = null;
  }

  if (!response.ok) {
    /* İstek gövdesi ve başlıklar LOGLANMIYOR: yalnızca durum ve iyzico'nun
       hata kodu. */
    if (console && console.error) {
      console.error('iyzico http error', response.status, uriPath,
        (data && data.errorCode) || '');
    }
    return { ok: false, reason: 'iyzico_http_' + response.status, status: response.status };
  }

  /* iyzico 200 içinde de hata döndürebiliyor: `status: "failure"`. */
  if (data && data.status && data.status !== 'success') {
    if (console && console.error) {
      console.error('iyzico failure', uriPath, (data && data.errorCode) || '');
    }
    return { ok: false, reason: 'iyzico_failure', errorCode: data.errorCode || null };
  }

  return { ok: true, data: data || {} };
}

/* ---- Abonelik kaynakları ---- */

function createProduct(name, description) {
  return request('POST', '/v2/subscription/products', {
    locale: 'tr',
    name: name,
    description: description || name
  });
}

function createPricingPlan(productRef, plan) {
  return request('POST', '/v2/subscription/products/' + encodeURIComponent(productRef) + '/pricing-plans', {
    locale: 'tr',
    name: plan.name,
    price: formatPrice(plan.priceTry),
    currencyCode: 'TRY',
    paymentInterval: 'MONTHLY',
    paymentIntervalCount: 1,
    trialPeriodDays: 0,
    planPaymentType: 'RECURRING'
  });
}

function createCustomer(customer) {
  return request('POST', '/v2/subscription/customers', Object.assign({ locale: 'tr' }, customer));
}

/**
 * Barındırılan abonelik formunu başlatır.
 *
 * Dönen adres `checkoutFormUrl` / `payWithIyzicoPageUrl` / `formUrl`
 * alanlarından birinde olabiliyor: iyzipay-node yanıtı modellemiyor ve resmi
 * doküman bu ortamdan okunamıyor. Üçü de deneniyor, hiçbiri yoksa uydurulmuyor.
 */
async function initializeCheckoutForm(opts) {
  const result = await request('POST', '/v2/subscription/checkoutform/initialize', {
    locale: 'tr',
    callbackUrl: opts.callbackUrl,
    pricingPlanReferenceCode: opts.pricingPlanRef,
    subscriptionInitialStatus: 'PENDING',
    customer: opts.customer
  });
  if (!result.ok) return result;

  const url = formUrlOf(result.data);
  if (!url) return { ok: false, reason: 'iyzico_form_url_missing' };
  return { ok: true, url: url, token: (result.data && result.data.token) || null };
}

/**
 * Yanıttan barındırılan form adresini çıkarır ve HOST'u doğrular.
 * Hedef iyzico'nun kendi alan adlarından biri değilse adres KULLANILMIYOR:
 * sağlayıcıdan gelen bir alan, açık yönlendirme fırsatına çevrilmemeli.
 */
function formUrlOf(data) {
  const candidates = [
    data && data.checkoutFormUrl,
    data && data.payWithIyzicoPageUrl,
    data && data.formUrl
  ];
  for (let i = 0; i < candidates.length; i++) {
    const raw = candidates[i];
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try { parsed = new URL(raw); } catch (err) { continue; }
    if (parsed.protocol !== 'https:') continue;
    if (ALLOWED_FORM_HOSTS.indexOf(parsed.hostname) === -1) continue;
    return parsed.toString();
  }
  return null;
}

/** Aboneliğin iyzico'daki GÜNCEL durumu. Webhook gövdesine güvenmek yerine bu. */
function getSubscription(subscriptionRef) {
  return request('GET', '/v2/subscription/subscriptions/' + encodeURIComponent(subscriptionRef), {});
}

/**
 * iyzico'nun HMAC yardımcı fonksiyonu: alanlar ':' ile birleştirilip gizli
 * anahtarla HMAC-SHA256, küçük harf hex (iyzipay-node `utils.js`).
 */
function hmacSignature(params) {
  const cfg = config();
  if (!cfg) return null;
  return crypto.createHmac('sha256', cfg.secretKey)
    .update(params.join(':'), 'utf8').digest('hex');
}

/** Sabit zamanlı karşılaştırma: `===` imzayı bayt bayt tahmin etmeye kapı açar. */
function signatureMatches(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* Abonelik durumları (iyzipay-node `SUBSCRIPTION_STATUS`). Hangi durum
   "abonelik açık" demek: yalnızca ACTIVE. PENDING ödeme beklemede, UNPAID
   ödeme başarısız; ikisinde de haftalık tarama tetiklenmemeli. */
const ACTIVE_STATUSES = ['ACTIVE'];
const KNOWN_STATUSES = ['ACTIVE', 'PENDING', 'UNPAID', 'CANCELED', 'EXPIRED', 'UPGRADED'];

function isActiveStatus(status) {
  return ACTIVE_STATUSES.indexOf(String(status || '').toUpperCase()) !== -1;
}


/** Barındırılan formun sonucunu jetonla okur (müşteri döndükten sonra). */
function getCheckoutForm(token) {
  return request('GET', '/v2/subscription/checkoutform/' + encodeURIComponent(token), {});
}

/* ============================================================
   Webhook imzası (X-Iyz-Signature-V3).

   iyzico'nun resmi PHP istemcisindeki örnekten (samples/
   webhook_Signature_Validation.php). DİKKAT — bu şema isteğe gönderdiğimiz
   IYZWSv2 imzasından FARKLI ve iki noktayla birleştiren eski `signature`
   şemasından da farklı:

     veri  = secretKey + iyziEventType + iyziPaymentId [+ token]
             + paymentConversationId + status          (ARALARINDA AYIRAÇ YOK)
     imza  = HMAC-SHA256(secretKey, veri) → KÜÇÜK HARF HEX

   Gizli anahtar hem verinin başına ekleniyor hem de HMAC anahtarı olarak
   kullanılıyor; örnekte böyle. İki değişken var: barındırılan form / "iyzico
   ile öde" olaylarında `token` alanı veriye GİRİYOR, doğrudan API ödemelerinde
   girmiyor. Abonelik olayları için resmi bir alan listesi hiçbir resmi
   istemcide YOK (doküman sitesi bu ortamın ağ ilkesinde kapalı), bu yüzden
   iki değişken de deneniyor.

   İMZA DOĞRULANSA BİLE GÖVDEYE GÜVENİLMİYOR: abonelik durumu iyzico'dan
   yeniden okunuyor. Alan sırası doğrulanamadığı için imza tek dayanak
   olmamalı; yazma kararı her hâlükârda iyzico'nun kendi cevabına dayanıyor.
   ============================================================ */

function webhookSignedData(body, withToken) {
  const cfg = config();
  if (!cfg) return null;
  const str = function (v) { return v === undefined || v === null ? '' : String(v); };
  return cfg.secretKey
    + str(body.iyziEventType)
    + str(body.iyziPaymentId !== undefined ? body.iyziPaymentId : body.paymentId)
    + (withToken ? str(body.token) : '')
    + str(body.paymentConversationId)
    + str(body.status);
}

/**
 * @returns {{ok: true, variant: string} | {ok: false, reason: string}}
 */
function verifyWebhookSignature(signature, body) {
  const cfg = config();
  if (!cfg) return { ok: false, reason: 'iyzico_unconfigured' };
  if (typeof signature !== 'string' || !signature.trim()) {
    return { ok: false, reason: 'signature_missing' };
  }
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_missing' };

  const variants = [
    { name: 'checkout_form', withToken: true },
    { name: 'api', withToken: false }
  ];
  for (let i = 0; i < variants.length; i++) {
    const data = webhookSignedData(body, variants[i].withToken);
    const expected = crypto.createHmac('sha256', cfg.secretKey)
      .update(data, 'utf8').digest('hex');
    if (signatureMatches(expected, signature)) {
      return { ok: true, variant: variants[i].name };
    }
  }
  return { ok: false, reason: 'signature_invalid' };
}

/** Gövdedeki abonelik referansı. Birden çok ad kullanılıyor. */
function subscriptionRefOf(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [body.subscriptionReferenceCode, body.iyziReferenceCode, body.referenceCode];
  for (let i = 0; i < candidates.length; i++) {
    const v = candidates[i];
    if (typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v)) return v;
  }
  return null;
}

module.exports = {
  config, isConfigured, isEnabled, environmentName, isSandbox,
  formatPrice, authorizationHeader, request,
  createProduct, createPricingPlan, createCustomer,
  initializeCheckoutForm, formUrlOf, getSubscription,
  hmacSignature, signatureMatches, isActiveStatus,
  getCheckoutForm, webhookSignedData, verifyWebhookSignature, subscriptionRefOf,
  ALLOWED_FORM_HOSTS, KNOWN_STATUSES, MIN_KEY_LENGTH
};
