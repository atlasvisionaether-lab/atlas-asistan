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
 * `errorCode`/`errorMessage`'ı (anahtarlar maskelenmiş, kısa) ve uç adı giriyor. 20 karakterden kısa bir anahtar
 * yapılandırılmamış sayılıyor: kırpılmış ya da yer tutucu bir değerle
 * iyzico'ya istek atmak, hatayı "ödeme bozuk" olarak müşteriye yansıtırdı.
 */

const crypto = require('node:crypto');

/* Sınama kısaltabilsin diye nesnede; isteğin tamamını (başlık + gövde) kapsar. */
const LIMITS = { timeoutMs: 10000 };
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
/**
 * iyzico'nun hata cevabından loga yazılacak kısa açıklama: errorCode,
 * errorGroup, errorMessage. Canlıda yalnızca kod ("8") loglanınca 401'in
 * sebebi (yanlış anahtar mı, imza mı, ortam mı) görülemedi. Açıklamada
 * anahtar ya da gizli anahtar geçerse maskelenir; 200 karakterle sınırlı.
 * İstek gövdesi, başlıklar ve imza yine LOGLANMIYOR.
 */
function errorDetail(data, cfg) {
  if (!data || typeof data !== 'object') return '';
  let s = [data.errorCode, data.errorGroup, data.errorMessage]
    .filter(function (v) { return v !== undefined && v !== null && v !== ''; })
    .map(String).join(' | ');
  [cfg && cfg.apiKey, cfg && cfg.secretKey].forEach(function (k) {
    if (k) s = s.split(k).join('[key]');
  });
  return s.replace(/\s+/g, ' ').slice(0, 200);
}

async function request(method, uriPath, bodyObject) {
  const cfg = config();
  if (!cfg) return { ok: false, reason: 'iyzico_unconfigured' };

  /* Gövde BİR KEZ metne çevriliyor: imzalanan metin ile gönderilen metin aynı. */
  const bodyJson = JSON.stringify(bodyObject || {});
  const rnd = randomKey();

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, LIMITS.timeoutMs);

  /* Süre sınırı gövde okunana kadar sürüyor: fetch başlıklar gelince döner;
     zamanlayıcı orada temizlenirse gövdeyi bekleten bir cevap ödeme
     sayfasını süresiz asar (aynı hata embed.js'te PR #105'te düzeltildi). */
  let response;
  let data = null;
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

  try {
    data = await response.json();
  } catch (err) {
    data = null;
    if (controller.signal.aborted) {
      clearTimeout(timer);
      return { ok: false, reason: 'iyzico_timeout' };
    }
  }
  clearTimeout(timer);

  if (!response.ok) {
    /* İstek gövdesi ve başlıklar LOGLANMIYOR: durum, uç ve iyzico'nun
       (maskelenmiş, kısa) hata açıklaması. */
    if (console && console.error) {
      console.error('iyzico http error', response.status, uriPath, errorDetail(data, cfg));
    }
    return {
      ok: false, reason: 'iyzico_http_' + response.status, status: response.status,
      errorCode: (data && data.errorCode) || null
    };
  }

  /* iyzico 200 içinde de hata döndürebiliyor: `status: "failure"`. */
  if (data && data.status && data.status !== 'success') {
    if (console && console.error) {
      console.error('iyzico failure', uriPath, errorDetail(data, cfg));
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
    /* ACTIVE: ödeme alınınca abonelik başlar. PENDING ile başlatılan
       abonelik ayrıca etkinleştirilene kadar beklemede kalır ve dönüş ucu
       (yalnızca ACTIVE'i açık sayar) müşteriyi yükseltmezdi. */
    subscriptionInitialStatus: 'ACTIVE',
    customer: opts.customer
  });
  if (!result.ok) return result;

  /* Yanıtın biçimi (alan adı + tür + uzunluk; DEĞER YOK). Canlıda ilk
     başarılı yanıtta adres beklenen alanlarda değildi (form_url_missing);
     hangi alanların geldiğini görmek için. */
  if (console && console.warn) {
    console.warn('iyzico checkoutform shape', responseShape(result.data));
  }

  const url = formUrlOf(result.data) || hostedUrlFromToken(tokenOf(result.data));
  if (!url) return { ok: false, reason: 'iyzico_form_url_missing' };
  return { ok: true, url: url, token: tokenOf(result.data) };
}

/**
 * TEK SEFERLİK ödeme formu (abonelik değil): "Biz düzeltelim" siparişi.
 * Resmi istemcinin CreateCheckoutFormInitializeRequest'i; imza ve adres
 * çıkarma abonelikle aynı (request, formUrlOf, token yedeği).
 *
 *   opts: { orderId, priceTry (KDV DAHİL, karttan çekilecek), callbackUrl,
 *           buyer, address, itemName }
 *
 * Tutar çağırandan gelir ama çağıran onu VERİTABANINDAKİ siparişten hesaplar
 * (istemciden değil). Taksit kapalı (enabledInstallments [1]): taksit faizi
 * çekilen tutarı değiştirir, dönüşte tutar eşleştirmesi bozulurdu.
 */
async function initializePaymentForm(opts) {
  const tutar = formatPrice(opts.priceTry);
  const result = await request('POST', '/payment/iyzipos/checkoutform/initialize/auth/ecom', {
    locale: 'tr',
    conversationId: String(opts.orderId),
    price: tutar,
    paidPrice: tutar,
    currency: 'TRY',
    basketId: String(opts.orderId),
    paymentGroup: 'PRODUCT',
    callbackUrl: opts.callbackUrl,
    enabledInstallments: [1],
    buyer: opts.buyer,
    billingAddress: opts.address,
    shippingAddress: opts.address,
    basketItems: [{
      id: String(opts.orderId),
      name: String(opts.itemName || 'Yazılım Güvenlik Düzeltme Hizmeti').slice(0, 100),
      category1: 'Hizmet',
      itemType: 'VIRTUAL',
      price: tutar
    }]
  });
  if (!result.ok) return result;
  if (console && console.warn) console.warn('iyzico paymentform shape', responseShape(result.data));
  const url = formUrlOf(result.data) || hostedUrlFromToken(tokenOf(result.data));
  if (!url) return { ok: false, reason: 'iyzico_form_url_missing' };
  return { ok: true, url: url, token: tokenOf(result.data) };
}

/** Tek seferlik ödeme formunun sonucu (dönüşte; tek doğru kaynak iyzico). */
async function retrievePaymentForm(token, conversationId) {
  /* Resmi RetrieveCheckoutFormRequest: locale, conversationId, token. */
  const body = { locale: 'tr' };
  if (conversationId) body.conversationId = String(conversationId);
  body.token = String(token);
  return request('POST', '/payment/iyzipos/checkoutform/auth/ecom/detail', body);
}

/** Yanıtta token (üst düzeyde ya da `data` altında); biçimsizse null. */
function tokenOf(data) {
  const t = (data && data.token) || (data && data.data && data.data.token);
  return typeof t === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(t) ? t : null;
}

/**
 * Adres alanı yoksa token'dan barındırılan ödeme sayfası: iyzico'nun ortak
 * ödeme sayfası (CPP) `?token=` ile açılıyor — standart ödeme formunun
 * `paymentPageUrl`'i bu biçimde. Host ortamdan seçilir, token biçimi
 * doğrulanmış; yine de ALLOWED_FORM_HOSTS içinde.
 */
function hostedUrlFromToken(token) {
  if (!token) return null;
  const host = isSandbox() ? 'sandbox-cpp.iyzipay.com' : 'cpp.iyzipay.com';
  return 'https://' + host + '/?token=' + encodeURIComponent(token) + '&lang=tr';
}

/** Değer içermeyen biçim özeti: `token:str(36) data:{a:num,…}`. */
function responseShape(data, depth) {
  if (!data || typeof data !== 'object') return typeof data;
  return Object.keys(data).sort().map(function (k) {
    const v = data[k];
    if (v === null) return k + ':null';
    if (typeof v === 'string') return k + ':str(' + v.length + ')';
    if (Array.isArray(v)) return k + ':arr(' + v.length + ')';
    if (typeof v === 'object') return k + ':' + ((depth || 0) < 1 ? '{' + responseShape(v, 1) + '}' : 'obj');
    return k + ':' + typeof v;
  }).join(' ');
}

/**
 * Yanıttan barındırılan form adresini çıkarır ve HOST'u doğrular.
 * Hedef iyzico'nun kendi alan adlarından biri değilse adres KULLANILMIYOR:
 * sağlayıcıdan gelen bir alan, açık yönlendirme fırsatına çevrilmemeli.
 */
function formUrlOf(data) {
  /* Alan adları sağlayıcı sürümüne göre değişebiliyor; üst düzey ve `data`
     altı ikisi de deneniyor. `paymentPageUrl` iyzico ödeme formunun adı. */
  const yerler = [data, data && data.data];
  const adlar = ['paymentPageUrl', 'checkoutFormUrl', 'payWithIyzicoPageUrl', 'formUrl'];
  const candidates = [];
  yerler.forEach(function (o) {
    if (o && typeof o === 'object') adlar.forEach(function (a) { candidates.push(o[a]); });
  });
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
  formatPrice, authorizationHeader, request, errorDetail, LIMITS,
  createProduct, createPricingPlan, createCustomer,
  initializeCheckoutForm, formUrlOf, getSubscription, tokenOf, hostedUrlFromToken, responseShape,
  initializePaymentForm, retrievePaymentForm,
  hmacSignature, signatureMatches, isActiveStatus,
  getCheckoutForm, webhookSignedData, verifyWebhookSignature, subscriptionRefOf,
  ALLOWED_FORM_HOSTS, KNOWN_STATUSES, MIN_KEY_LENGTH
};
