'use strict';
/**
 * iyzico abonelik entegrasyonunun sınamaları. Ağdan bağımsız.
 *
 *   node tools/iyzico-test.js
 *
 * NEDEN
 *
 * Ödeme imzası sessizce yanlış olabilir: yanlış alan sırası ya da yanlış
 * kodlama, "yanlış anahtar" gibi görünen bir hataya ya da daha kötüsü FORGE
 * EDİLMİŞ bir webhook'un kabul edilmesine yol açar. Bu yüzden:
 *
 *   1. Giden isteğin IYZWSv2 imzası, resmi iyzipay-node istemcisinin
 *      algoritmasıyla birebir aynı mı (elle hesaplanmış referansla).
 *   2. Gelen webhook'un X-Iyz-Signature-V3 doğrulaması, iyzico'nun RESMİ PHP
 *      örneğindeki test vektörlerini geçiyor mu. Vektörler aşağıda; anahtar
 *      bir sandbox örnek anahtarı (iyzico'nun kendi örneğinden), gerçek bir
 *      sır değil.
 *   3. Yapılandırma eksikse/ kısa anahtarsa uç KAPALI kalıyor mu, bağlantı
 *      uyduruyor mu, iyzico dışı bir host yönlendirme hedefi olabiliyor mu.
 */

const crypto = require('node:crypto');

/* iyzico'nun kendi örneğindeki sandbox anahtarı (gerçek bir sır değil). */
const SANDBOX_SECRET = 'sandbox-UuLnD7wZa0a3DmytfIrwHQqAMfqCNJrs';
const SANDBOX_API_KEY = 'sandbox-aaaaaaaaaaaaaaaaaaaaaaaaaaa';

process.env.IYZICO_API_KEY = SANDBOX_API_KEY;
process.env.IYZICO_SECRET_KEY = SANDBOX_SECRET;
process.env.IYZICO_BASE_URL = 'https://sandbox-api.iyzipay.com';
delete process.env.IYZICO_SUBSCRIPTION_ENABLED;
delete process.env.IYZICO_PRICING_PLAN_PRO;
delete process.env.IYZICO_PRICING_PLAN_ENTERPRISE;

const iyzico = require('../api/_lib/iyzico.js');
const checkout = require('../api/checkout.js');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen)
              + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

console.log('iyzico abonelik entegrasyonu');

/* ---- 1. Yapılandırma ---- */
sina('yapılandırma okunuyor', iyzico.isConfigured(), true);
sina('sandbox taban adresi sandbox sayılıyor', iyzico.isSandbox(), true);
sina('ortam adı', iyzico.environmentName(), 'sandbox');

process.env.IYZICO_SECRET_KEY = 'kisa';
sina('kısa gizli anahtar yapılandırılmamış sayılıyor', iyzico.isConfigured(), false);
process.env.IYZICO_SECRET_KEY = SANDBOX_SECRET;

process.env.IYZICO_BASE_URL = 'http://sandbox-api.iyzipay.com';
sina('şifresiz taban adresi reddediliyor', iyzico.isConfigured(), false);
process.env.IYZICO_BASE_URL = 'https://sandbox-api.iyzipay.com';

process.env.IYZICO_SUBSCRIPTION_ENABLED = 'false';
sina('kill switch ödemeyi kapatıyor', iyzico.isEnabled(), false);
process.env.IYZICO_SUBSCRIPTION_ENABLED = 'true';
sina('kill switch açıkken ödeme açık', iyzico.isEnabled(), true);
delete process.env.IYZICO_SUBSCRIPTION_ENABLED;

/* ---- 2. Fiyat biçimi ----
   iyzico tam sayıya `.0` ekliyor ve imza gövdenin BİREBİR metnini kapsıyor:
   "299" göndermek imzayı değil, iyzico'nun kabulünü bozar. */
sina('299 → "299.0"', iyzico.formatPrice(299), '299.0');
sina('2499 → "2499.0"', iyzico.formatPrice(2499), '2499.0');
sina('10.99 olduğu gibi', iyzico.formatPrice(10.99), '10.99');

/* ---- 3. Giden istek imzası (IYZWSv2) ----
   Referans elle hesaplanıyor: payload = rnd + uriPath + body, HMAC-SHA256
   hex, params "apiKey:…&randomKey:…&signature:…", base64. */
(function () {
  const cfg = iyzico.config();
  const uri = '/v2/subscription/checkoutform/initialize';
  const body = '{"locale":"tr"}';
  const rnd = '1700000000deadbeef';

  const expectedSig = crypto.createHmac('sha256', SANDBOX_SECRET)
    .update(rnd + uri + body, 'utf8').digest('hex');
  const expectedHeader = 'IYZWSv2 ' + Buffer.from(
    'apiKey:' + SANDBOX_API_KEY + '&randomKey:' + rnd + '&signature:' + expectedSig,
    'utf8').toString('base64');

  const header = iyzico.authorizationHeader(cfg, uri, body, rnd);
  sina('IYZWSv2 başlığı referansla aynı', header, expectedHeader);

  /* Başlık çözülünce imza küçük harf hex ve 64 karakter olmalı. */
  const decoded = Buffer.from(header.slice('IYZWSv2 '.length), 'base64').toString('utf8');
  const sig = /signature:([0-9a-f]+)$/.exec(decoded);
  sina('imza küçük harf hex, 64 karakter', sig !== null && sig[1].length === 64, true);

  /* Gövde imzaya giriyor: gövde değişince imza değişmeli. */
  const other = iyzico.authorizationHeader(cfg, uri, '{"locale":"en"}', rnd);
  sina('gövde imzayı etkiliyor', other !== header, true);
  /* Yol da imzaya giriyor. */
  const otherPath = iyzico.authorizationHeader(cfg, '/v2/subscription/products', body, rnd);
  sina('yol imzayı etkiliyor', otherPath !== header, true);
})();

/* ---- 4. Webhook imzası — iyzico'nun RESMİ test vektörleri ----
   Kaynak: iyzipay-php samples/webhook_Signature_Validation.php
   veri = secretKey + iyziEventType + iyziPaymentId [+ token]
          + paymentConversationId + status      (ayıraç YOK)
   imza = HMAC-SHA256(secretKey, veri) → küçük harf hex */
const VECTOR_CO_FORM = {
  paymentConversationId: 'conversationId',
  merchantId: 3382172,
  token: 'e828c62d-fd12-4b1a-ad5a-380f15fe6596',
  status: 'SUCCESS',
  iyziReferenceCode: '77e1635c-6b39-475a-8b7b-ca15ad0cd4ac',
  iyziEventType: 'CHECKOUT_FORM_AUTH',
  iyziEventTime: 1721825036103,
  iyziPaymentId: 22483975
};
const SIG_CO_FORM = '4031c575763486a2d2bf3f7ace0baebfcd6bed65393ab4df3fe80c00d5fd6878';

const VECTOR_API = {
  paymentConversationId: 'conversationId',
  merchantId: 3382172,
  paymentId: 22484059,
  status: 'SUCCESS',
  iyziReferenceCode: 'a9af8e6b-4401-4928-b6b8-40419aaa3d0f',
  iyziEventType: 'API_AUTH',
  iyziEventTime: 1721825828467,
  iyziPaymentId: 22484059
};
const SIG_API = '92c7a72b7741bc83eb696066605c894778c87297b2c88d6037670666230e18ae';

sina('resmi vektör 1 (checkout form) doğrulanıyor',
  iyzico.verifyWebhookSignature(SIG_CO_FORM, VECTOR_CO_FORM).ok, true);
sina('resmi vektör 2 (doğrudan API) doğrulanıyor',
  iyzico.verifyWebhookSignature(SIG_API, VECTOR_API).ok, true);

/* Gövdesi değiştirilmiş istek REDDEDİLMELİ: imza doğrulamasının tek işi bu. */
const tampered = Object.assign({}, VECTOR_CO_FORM, { status: 'FAILURE' });
sina('durumu değiştirilmiş gövde reddediliyor',
  iyzico.verifyWebhookSignature(SIG_CO_FORM, tampered),
  { ok: false, reason: 'signature_invalid' });

const tamperedId = Object.assign({}, VECTOR_CO_FORM, { iyziPaymentId: 22483976 });
sina('ödeme kimliği değiştirilmiş gövde reddediliyor',
  iyzico.verifyWebhookSignature(SIG_CO_FORM, tamperedId).ok, false);

sina('imza yoksa reddediliyor',
  iyzico.verifyWebhookSignature('', VECTOR_CO_FORM),
  { ok: false, reason: 'signature_missing' });
sina('gövde yoksa reddediliyor',
  iyzico.verifyWebhookSignature(SIG_CO_FORM, null),
  { ok: false, reason: 'body_missing' });
sina('yanlış uzunlukta imza reddediliyor',
  iyzico.verifyWebhookSignature('deadbeef', VECTOR_CO_FORM).ok, false);

/* Anahtar yoksa doğrulama GEÇMEMELİ: anahtarsız "doğrulandı" demek,
   doğrulamayı hiç yapmamakla aynı kapıya çıkar. */
(function () {
  const saved = process.env.IYZICO_SECRET_KEY;
  delete process.env.IYZICO_SECRET_KEY;
  sina('anahtar yoksa doğrulama geçmiyor',
    iyzico.verifyWebhookSignature(SIG_CO_FORM, VECTOR_CO_FORM),
    { ok: false, reason: 'iyzico_unconfigured' });
  process.env.IYZICO_SECRET_KEY = saved;
})();

/* ---- 5. Abonelik referansı ve durumu ---- */
sina('abonelik referansı subscriptionReferenceCode alanından',
  iyzico.subscriptionRefOf({ subscriptionReferenceCode: 'abc12345-ef' }), 'abc12345-ef');
sina('yoksa iyziReferenceCode kullanılıyor',
  iyzico.subscriptionRefOf(VECTOR_CO_FORM), '77e1635c-6b39-475a-8b7b-ca15ad0cd4ac');
sina('biçimsiz referans alınmıyor',
  iyzico.subscriptionRefOf({ subscriptionReferenceCode: 'kisa' }), null);
sina('yalnızca ACTIVE abonelik açık sayılıyor', iyzico.isActiveStatus('ACTIVE'), true);
sina('PENDING abonelik açık SAYILMIYOR', iyzico.isActiveStatus('PENDING'), false);
sina('UNPAID abonelik açık SAYILMIYOR', iyzico.isActiveStatus('UNPAID'), false);
sina('CANCELED abonelik açık SAYILMIYOR', iyzico.isActiveStatus('CANCELED'), false);

/* ---- 6. Form adresi — açık yönlendirme koruması ---- */
sina('iyzico alan adı kabul ediliyor',
  iyzico.formUrlOf({ checkoutFormUrl: 'https://sandbox-cpp.iyzipay.com/form/abc' }),
  'https://sandbox-cpp.iyzipay.com/form/abc');
sina('iyzico dışı host reddediliyor',
  iyzico.formUrlOf({ checkoutFormUrl: 'https://kotu-site.example/form' }), null);
sina('benzer görünen host reddediliyor',
  iyzico.formUrlOf({ checkoutFormUrl: 'https://cpp.iyzipay.com.kotu.example/form' }), null);
sina('şifresiz adres reddediliyor',
  iyzico.formUrlOf({ checkoutFormUrl: 'http://cpp.iyzipay.com/form' }), null);
sina('adres yoksa uydurulmuyor', iyzico.formUrlOf({}), null);
sina('ayrıştırılamayan adres reddediliyor',
  iyzico.formUrlOf({ checkoutFormUrl: 'bu bir adres degil' }), null);

/* ---- 7. Ödeme ucu ---- */
sina('plan referansı yoksa null', checkout.pricingPlanRef('pro'), null);
process.env.IYZICO_PRICING_PLAN_PRO = 'plan-ref-pro';
sina('plan referansı env\'den okunuyor', checkout.pricingPlanRef('pro'), 'plan-ref-pro');
sina('free planın referansı yok', checkout.pricingPlanRef('free'), null);
sina('bilinmeyen planın referansı yok', checkout.pricingPlanRef('kurumsal-plus'), null);

sina('tarayıcı isteği HTML istiyor sayılıyor',
  checkout.wantsHtml({ headers: { accept: 'text/html,application/xhtml+xml' } }), true);
sina('JSON isteği HTML istemiyor',
  checkout.wantsHtml({ headers: { accept: 'application/json' } }), false);
sina('Accept başlığı yoksa JSON', checkout.wantsHtml({ headers: {} }), false);

/* Dönüş adresi HTTPS ve kendi alan adımız olmalı. */
sina('dönüş adresi host başlığından kuruluyor',
  checkout.callbackUrl({ headers: { host: 'cyberlionai.com' } }),
  'https://cyberlionai.com/api/checkout-return');
process.env.SITE_URL = 'https://www.cyberlionai.com/';
sina('SITE_URL varsa o kullanılıyor',
  checkout.callbackUrl({ headers: { host: 'baska.example' } }),
  'https://www.cyberlionai.com/api/checkout-return');
delete process.env.SITE_URL;

/* ---- 8. Uç davranışı: yapılandırma yoksa bağlantı UYDURULMUYOR ---- */
function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; },
    status: function (c) { this.statusCode = c; return this; },
    json: function (o) { this.body = o; return this; },
    end: function () { return this; }
  };
}

(async function () {
  /* Makine isteği: 503, uydurma adres yok. */
  const saved = process.env.IYZICO_API_KEY;
  delete process.env.IYZICO_API_KEY;

  /* Tarama yetkisi beyanı olmadan ödeme başlamaz (yapılandırmadan da önce). */
  let res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { plan: 'pro' }, headers: {} }, res);
  sina('beyan yoksa 400', res.statusCode, 400);
  sina('beyan yoksa kod', res.body, { error: { code: 'declaration_required' } });
  res = fakeRes();
  await require('../api/checkout.js')(
    { method: 'GET', query: { plan: 'pro' }, headers: { accept: 'text/html' } }, res);
  sina('beyan yoksa tarayıcı fiyat sayfasına', res.headers.location, '/pricing?checkout=declaration_required&plan=pro');
  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { plan: 'pro', declaration: 'true' }, headers: {} }, res);
  sina('beyan yalnızca "1" kabul', res.statusCode, 400);

  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { plan: 'pro', declaration: '1' }, headers: {} }, res);
  sina('yapılandırma yoksa 503', res.statusCode, 503);
  sina('yapılandırma yoksa sebep kodu', res.body, { error: { code: 'checkout_unconfigured' } });
  sina('yapılandırma yoksa Location başlığı YOK', res.headers.location === undefined, true);

  /* Tarayıcı isteği: fiyat sayfasına geri. */
  res = fakeRes();
  await require('../api/checkout.js')(
    { method: 'GET', query: { plan: 'pro', declaration: '1' }, headers: { accept: 'text/html' } }, res);
  sina('tarayıcı /pricing uyarısına dönüyor', res.statusCode, 303);
  sina('dönüş adresi fiyat sayfası',
    res.headers.location, '/pricing?checkout=unavailable&plan=pro');

  /* Durum ucu: ödeme kapalıyken testMode söylenmiyor. */
  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { mode: '1' }, headers: {} }, res);
  sina('durum ucu 200', res.statusCode, 200);
  sina('ödeme kapalıyken enabled false', res.body.enabled, false);
  sina('ödeme kapalıyken testMode bilinmiyor', res.body.testMode, null);

  process.env.IYZICO_API_KEY = saved;

  /* Plan denetimi: free ve bilinmeyen plan ödenemez. */
  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { plan: 'free' }, headers: {} }, res);
  sina('free planı ödenemez', res.body, { error: { code: 'invalid_plan' } });

  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: {}, headers: {} }, res);
  sina('plan verilmezse 400', res.body, { error: { code: 'missing_plan' } });

  res = fakeRes();
  await require('../api/checkout.js')({ method: 'POST', query: {}, headers: {} }, res);
  sina('GET dışı yöntem 405', res.statusCode, 405);
  sina('405 Allow başlığı', res.headers.allow, 'GET');

  /* ---- 9. Webhook ucu: imzasız istek yazmıyor ----
     Veritabanı yapılandırması sahte: imza denetimi veritabanına HİÇ
     dokunmadan önce çalışıyor, bu sınamalar ağa çıkmıyor. */
  process.env.SUPABASE_URL = 'https://ornek.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sahte-servis-rolu-anahtari-yalnizca-sinama';
  const webhook = require('../api/webhooks/iyzico.js');
  res = fakeRes();
  await webhook({ method: 'POST', headers: {}, body: VECTOR_CO_FORM }, res);
  sina('imzasız webhook 401', res.statusCode, 401);
  sina('imzasız webhook sebebi', res.body, { error: { code: 'unauthorized' } });

  res = fakeRes();
  await webhook({ method: 'GET', headers: {}, body: null }, res);
  sina('webhook POST dışına 405', res.statusCode, 405);

  res = fakeRes();
  await webhook({ method: 'POST', headers: { 'x-iyz-signature-v3': SIG_CO_FORM }, body: 'bu json degil' }, res);
  sina('ayrıştırılamayan gövde 400', res.statusCode, 400);

  /* ---- 10. Dönüş ucu: jeton biçimi ---- */
  const ret = require('../api/checkout-return.js');
  sina('jeton gövdeden okunuyor',
    ret.readToken({ body: { token: 'e828c62d-fd12-4b1a-ad5a-380f15fe6596' }, query: {} }),
    'e828c62d-fd12-4b1a-ad5a-380f15fe6596');
  sina('biçimsiz jeton alınmıyor', ret.readToken({ body: { token: 'kisa' }, query: {} }), null);
  sina('jeton yoksa null', ret.readToken({ body: {}, query: {} }), null);

  process.env.IYZICO_PRICING_PLAN_PRO = 'plan-ref-pro';
  process.env.IYZICO_PRICING_PLAN_ENTERPRISE = 'plan-ref-ent';
  sina('plan referansı plan kimliğine çevriliyor',
    ret.planOf({ pricingPlanReferenceCode: 'plan-ref-ent' }), 'enterprise');
  sina('tanınmayan plan referansı kabul edilmiyor',
    ret.planOf({ pricingPlanReferenceCode: 'baska-ref' }), null);
  sina('referans yoksa plan yok', ret.planOf({}), null);

  /* ---- 11. Göç: upsert'in dayandığı tekil indeks KISMİ OLMAMALI ----
     PostgREST'in `on_conflict=` parametresi ON CONFLICT'e WHERE koşulu
     ekleyemiyor; kısmi indeks arbiter olarak kabul edilmediği için upsert
     `42P10` ile patlıyor ve ödeyen müşteriye satır açılmıyor. Bu sınama,
     koşulun göç dosyasına geri sızmasını engelliyor. */
  const fs = require('node:fs');
  const path = require('node:path');
  const gocYolu = path.join(__dirname, '..', 'db', '2026-10-01-cl-subscriptions-iyzico.sql');
  const goc = fs.readFileSync(gocYolu, 'utf8');
  const tekilIndeks = (goc.match(
    /create unique index[^;]*cl_subscriptions_iyzico_subscription_ref_key[^;]*;/i) || [''])[0];
  sina('abonelik referansı tekil indeksi göçte var', tekilIndeks !== '', true);
  sina('tekil indeks kısmi değil (where yok)', /\bwhere\b/i.test(tekilIndeks), false);
  sina('upsert bu indeksi arbiter olarak kullanıyor',
    /on_conflict=iyzico_subscription_ref/.test(
      fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'db.js'), 'utf8')),
    true);

  console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
  process.exit(hata === 0 ? 0 : 1);
})();
