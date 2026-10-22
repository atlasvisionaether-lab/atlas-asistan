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
delete process.env.IYZICO_PRICING_PLAN_PRO_YEARLY;
delete process.env.IYZICO_PRICING_PLAN_ENTERPRISE_YEARLY;

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
sina('paymentPageUrl okunuyor',
  iyzico.formUrlOf({ paymentPageUrl: 'https://cpp.iyzipay.com?token=abc&lang=tr' }), 'https://cpp.iyzipay.com/?token=abc&lang=tr');
sina('data altındaki adres okunuyor',
  iyzico.formUrlOf({ data: { paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=abc' } }), 'https://sandbox-cpp.iyzipay.com/?token=abc');
sina('data altındaki yabancı host yine reddediliyor',
  iyzico.formUrlOf({ data: { paymentPageUrl: 'https://kotu-site.example/?token=abc' } }), null);
sina('token biçimi doğrulanıyor', [iyzico.tokenOf({ token: '<script>alert(1)</script>' }), iyzico.tokenOf({ token: 'kisa' }),
  iyzico.tokenOf({ data: { token: 'f1e2d3c4-b5a6-7890-abcd-ef1234567890' } })], [null, null, 'f1e2d3c4-b5a6-7890-abcd-ef1234567890']);
sina('token yoksa adres kurulmuyor', iyzico.hostedUrlFromToken(null), null);
sina('yanıt biçimi değer içermiyor',
  iyzico.responseShape({ token: 'gizli-token-degeri-1234', checkoutFormContent: '<script>x</script>', tokenExpireTime: 1800, data: { a: 'b' } }),
  'checkoutFormContent:str(18) data:{a:str(1)} token:str(23) tokenExpireTime:number');
sina('ayrıştırılamayan adres reddediliyor',
  iyzico.formUrlOf({ checkoutFormUrl: 'bu bir adres degil' }), null);

/* ---- 7. Ödeme ucu ---- */
sina('plan referansı yoksa null', checkout.pricingPlanRef('pro'), null);
process.env.IYZICO_PRICING_PLAN_PRO = 'plan-ref-pro';
sina('plan referansı env\'den okunuyor', checkout.pricingPlanRef('pro'), 'plan-ref-pro');
sina('free planın referansı yok', checkout.pricingPlanRef('free'), null);
sina('bilinmeyen planın referansı yok', checkout.pricingPlanRef('kurumsal-plus'), null);

/* Plan × dönem: dört seçenek, dört ayrı referans. Eski `pro` aylık. */
sina('pro_monthly = eski pro referansı', checkout.pricingPlanRef('pro_monthly'), 'plan-ref-pro');
sina('yıllık referans yoksa null (aylığa düşmez)', checkout.pricingPlanRef('pro_yearly'), null);
process.env.IYZICO_PRICING_PLAN_PRO_YEARLY = ' plan-ref-pro-yil ';
sina('yıllık referans ayrı env\'den, kırpılmış', checkout.pricingPlanRef('pro_yearly'), 'plan-ref-pro-yil');
sina('bilinmeyen dönemin referansı yok', checkout.pricingPlanRef('pro_weekly'), null);
sina('free_yearly diye bir seçenek yok', checkout.pricingPlanRef('free_yearly'), null);
sina('dört seçenek, dört env adı', Object.keys(checkout.PLAN_REF_ENV).sort().join(','),
  'enterprise_monthly,enterprise_yearly,pro_monthly,pro_yearly');
{
  const { checkoutOption } = require('../api/_lib/plans.js');
  sina('yıllık seçenek tutarı', checkoutOption('enterprise_yearly'),
    { key: 'enterprise_yearly', id: 'enterprise', period: 'yearly', priceTry: 19900 });
  sina('eski enterprise aylık', checkoutOption('enterprise').key, 'enterprise_monthly');
}
delete process.env.IYZICO_PRICING_PLAN_PRO_YEARLY;

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
  sina('sözleşme onayı yoksa 400', res.body, { error: { code: 'agreements_required' } });
  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { plan: 'pro', declaration: '1' }, headers: { accept: 'text/html' } }, res);
  sina('sözleşme onayı yoksa fiyat sayfasına', res.headers.location, '/pricing?checkout=agreements_required&plan=pro');

  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { plan: 'pro', declaration: '1', agreements: '1' }, headers: {} }, res);
  sina('yapılandırma yoksa 503', res.statusCode, 503);
  sina('yapılandırma yoksa sebep kodu', res.body, { error: { code: 'checkout_unconfigured' } });
  sina('yapılandırma yoksa Location başlığı YOK', res.headers.location === undefined, true);

  /* Tarayıcı isteği: fiyat sayfasına geri. */
  res = fakeRes();
  await require('../api/checkout.js')(
    { method: 'GET', query: { plan: 'pro', declaration: '1', agreements: '1' }, headers: { accept: 'text/html' } }, res);
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

  /* Durum ucu, ödeme açıkken yalnızca referansı tanımlı seçenekleri listeler. */
  {
    const eskiAcik = process.env.IYZICO_SUBSCRIPTION_ENABLED;
    process.env.IYZICO_SUBSCRIPTION_ENABLED = 'true';
    process.env.IYZICO_PRICING_PLAN_PRO_YEARLY = 'plan-ref-pro-yil';
    res = fakeRes();
    await require('../api/checkout.js')({ method: 'GET', query: { mode: '1' }, headers: {} }, res);
    sina('durum ucu hazır seçenekleri listeliyor', res.body.plans, ['pro_monthly', 'pro_yearly']);
    delete process.env.IYZICO_PRICING_PLAN_PRO_YEARLY;
    if (eskiAcik === undefined) delete process.env.IYZICO_SUBSCRIPTION_ENABLED; else process.env.IYZICO_SUBSCRIPTION_ENABLED = eskiAcik;
  }

  /* Bilinmeyen dönem ödenemez. */
  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { plan: 'pro_weekly' }, headers: {} }, res);
  sina('bilinmeyen dönem 400', [res.statusCode, res.body.error.code], [400, 'invalid_plan']);

  /* Plan denetimi: free ve bilinmeyen plan ödenemez. */
  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: { plan: 'free' }, headers: {} }, res);
  sina('free planı ödenemez', res.body, { error: { code: 'invalid_plan' } });

  res = fakeRes();
  await require('../api/checkout.js')({ method: 'GET', query: {}, headers: {} }, res);
  sina('plan verilmezse 400', res.body, { error: { code: 'missing_plan' } });

  res = fakeRes();
  await require('../api/checkout.js')({ method: 'PUT', query: {}, headers: {} }, res);
  sina('GET/POST dışı yöntem 405', res.statusCode, 405);
  sina('405 Allow başlığı', res.headers.allow, 'GET, POST');

  /* POST: /odeme formu gövdeyle gelir (fatura bilgileri URL'de değil). */
  res = fakeRes();
  await require('../api/checkout.js')({ method: 'POST', query: {}, headers: { accept: 'text/html' },
    body: 'plan=pro_yearly&declaration=1' }, res);
  sina('POST gövdeden okunuyor: sözleşme onayı yoksa fiyat sayfasına',
    res.headers.location, '/pricing?checkout=agreements_required&plan=pro_yearly');
  sina('POST durum ucu değil (mode yok sayılır)',
    checkout.formBody({ body: 'mode=1&plan=pro' }), { mode: '1', plan: 'pro' });
  sina('JSON gövde de okunuyor', checkout.formBody({ body: '{"plan":"pro"}' }), { plan: 'pro' });
  sina('nesne gövde aynen', checkout.formBody({ body: { plan: 'x' } }), { plan: 'x' });

  /* CSP form-action: /odeme POST'u iyzico'ya 303 ile gidiyor; Chrome
     form-action'ı yönlendirmeye de uyguluyor (PR #112 incelemesi). Kodun
     izin verdiği her form host'u yayınlanan CSP'de olmalı. */
  {
    const fs = require('node:fs');
    const path = require('node:path');
    const kaynak = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'iyzico.js'), 'utf8');
    const hostlar = (/const ALLOWED_FORM_HOSTS = \[([\s\S]*?)\];/.exec(kaynak)[1].match(/'([^']+)'/g) || [])
      .map(function (h) { return h.replace(/'/g, ''); });
    ['vercel.json', '_headers'].forEach(function (f) {
      const csp = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      const fa = (/form-action ([^;"]*)/.exec(csp) || [, ''])[1];
      sina(f + ': form-action iyzico form host\'larını içeriyor (' + hostlar.length + ')',
        hostlar.length >= 4 && hostlar.every(function (h) { return fa.split(/\s+/).indexOf('https://' + h) !== -1; }), true);
      sina(f + ': form-action başka dış host içermiyor',
        fa.split(/\s+/).filter(Boolean).every(function (x) { return x === "'self'" || hostlar.indexOf(x.replace('https://', '')) !== -1; }), true);
    });
  }

  /* ---- 8b. Fatura bilgileri (iyzico 200702, canlı 2026-10-22) ---- */
  {
    const b = require('../api/_lib/billing-details.js');
    sina('0555 444 33 33 → +90', b.normalizeGsm('0555 444 33 33'), '+905554443333');
    sina('5554443333 → +90', b.normalizeGsm('5554443333'), '+905554443333');
    sina('+90 (555) 444-33-33 → +90', b.normalizeGsm('+90 (555) 444-33-33'), '+905554443333');
    sina('sabit hat reddediliyor (iyzico cep istiyor)', b.normalizeGsm('0212 444 33 33'), null);
    sina('yurt dışı + ile kabul', b.normalizeGsm('+44 7911 123456'), '+447911123456');
    sina('harf reddediliyor', b.normalizeGsm('0555abc'), null);
    sina('geçerli TC kimlik', b.isValidTckn('10000000146'), true);
    sina('sağlaması tutmayan TC reddediliyor', b.isValidTckn('12345678901'), false);
    sina('0 ile başlayan TC reddediliyor', b.isValidTckn('01234567890'), false);

    const tam = { ad: 'Ali Veli Kaya', gsm: '0555 444 33 33', adres: 'Atatürk Cad. No: 1 Daire 2',
      il: 'İstanbul', ilce: 'Kadıköy', ulke: 'Türkiye' };
    const c = b.buildCustomer(tam, 'ali@ornek.com', checkout.customerName);
    sina('müşteri iyzico modeliyle kuruluyor', c.ok && c.customer, {
      name: 'Ali Veli', surname: 'Kaya', email: 'ali@ornek.com', gsmNumber: '+905554443333',
      identityNumber: '11111111111',
      billingAddress: { contactName: 'Ali Veli Kaya', city: 'İstanbul', country: 'Türkiye',
        address: 'Atatürk Cad. No: 1 Daire 2', district: 'Kadıköy' },
      shippingAddress: { contactName: 'Ali Veli Kaya', city: 'İstanbul', country: 'Türkiye',
        address: 'Atatürk Cad. No: 1 Daire 2', district: 'Kadıköy' } });
    sina('TC boşsa 11111111111', c.customer.identityNumber, '11111111111');
    sina('geçerli TC aynen gidiyor',
      b.buildCustomer(Object.assign({}, tam, { tckn: '100 000 001 46' }), 'a@b.co', checkout.customerName).customer.identityNumber, '10000000146');
    const alan = function (deg) { return b.buildCustomer(Object.assign({}, tam, deg), 'a@b.co', checkout.customerName).field; };
    sina('geçersiz TC → tckn', alan({ tckn: '12345678901' }), 'tckn');
    sina('telefon yok → gsm', alan({ gsm: '' }), 'gsm');
    sina('adres kısa → adres', alan({ adres: 'kısa' }), 'adres');
    sina('il yok → il', alan({ il: '' }), 'il');
    sina('il rakam → il', alan({ il: '34' }), 'il');
    sina('tek kelime ad → ad (fatura yer tutucu kabul etmez)', alan({ ad: 'Ali' }), 'ad');
    sina('ülke boşsa Türkiye', b.buildCustomer(Object.assign({}, tam, { ulke: '' }), 'a@b.co', checkout.customerName).customer.billingAddress.country, 'Türkiye');
    sina('ilçe isteğe bağlı', 'district' in b.buildCustomer(Object.assign({}, tam, { ilce: '' }), 'a@b.co', checkout.customerName).customer.billingAddress, false);
    sina('kontrol karakterleri temizleniyor',
      b.buildCustomer(Object.assign({}, tam, { adres: 'Atatürk\u0000 Cad.\n No: 1 Daire 2' }), 'a@b.co', checkout.customerName).customer.billingAddress.address,
      'Atatürk Cad. No: 1 Daire 2');
  }

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

  /* Yıllık referans plan kimliğine (yetki) ve seçeneğe (tutar) çevriliyor. */
  process.env.IYZICO_PRICING_PLAN_ENTERPRISE_YEARLY = 'plan-ref-ent-yil';
  sina('yıllık referans → enterprise', ret.planOf({ pricingPlanReferenceCode: 'plan-ref-ent-yil' }), 'enterprise');
  sina('yıllık referans → yıllık seçenek ve tutar',
    ret.optionOf({ pricingPlanReferenceCode: 'plan-ref-ent-yil' }),
    { key: 'enterprise_yearly', id: 'enterprise', period: 'yearly', priceTry: 19900 });
  sina('aylık referans aylık kalıyor', ret.optionOf({ pricingPlanReferenceCode: 'plan-ref-ent' }).period, 'monthly');
  delete process.env.IYZICO_PRICING_PLAN_ENTERPRISE_YEARLY;

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

  /* ---- 10b. "Biz düzeltelim" tek seferlik iyzico ödemesi ----
     Gösterilen = çekilen = KDV dahil; tutar veritabanındaki siparişten;
     dönüşte iyzico sonucu sipariş ve tutarla karşılaştırılıyor. */
  {
    const fs = require('node:fs');
    const path = require('node:path');
    const pricing = require('../api/_lib/fixpricing.js');
    sina('KDV dahil: 2.500 → 3.000', pricing.grossTry(2500), 3000);
    sina('KDV dahil: 499 → 598,80', pricing.grossTry(499), 598.8);
    sina('fiyat tablosu KDV oranını veriyor', pricing.table().vatRate, 0.2);

    const eskiFetch = global.fetch;
    const eskiWarn = console.warn;
    console.warn = function () {};
    process.env.IYZICO_API_KEY = SANDBOX_API_KEY;
    process.env.IYZICO_SECRET_KEY = SANDBOX_SECRET;
    let adres = null; let govde = null;
    global.fetch = async function (u, o) {
      adres = u; govde = JSON.parse(o.body);
      return { ok: true, status: 200, json: async function () {
        return { status: 'success', token: 'f1e2d3c4-b5a6-7890-abcd-ef1234567890', paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=f1e2d3c4-b5a6-7890-abcd-ef1234567890&lang=tr' };
      } };
    };
    const SIP = '22222222-2222-4222-8222-222222222222';
    const b = require('../api/_lib/billing-details.js');
    const musteri = b.buildCustomer({ ad: 'Ali Veli Kaya', gsm: '05554443333', adres: 'Atatürk Cad. No: 1 Daire 2', il: 'İstanbul' },
      'ali@ornek.com', checkout.customerName).customer;
    const alici = b.buyerFrom(musteri, '11111111-1111-4111-8111-111111111111', '203.0.113.7');
    const r = await iyzico.initializePaymentForm({ orderId: SIP, priceTry: 3000, callbackUrl: 'https://www.cyberlionai.com/api/fix-pay-return',
      buyer: alici.buyer, address: alici.address, itemName: 'Düzeltme' });
    sina('tek seferlik form ucu', new URL(adres).pathname, '/payment/iyzipos/checkoutform/initialize/auth/ecom');
    sina('çekilen tutar KDV dahil, price = paidPrice = sepet', [govde.price, govde.paidPrice, govde.basketItems[0].price], ['3000.0', '3000.0', '3000.0']);
    sina('taksit kapalı (tutar eşleşmesi bozulmasın)', govde.enabledInstallments, [1]);
    sina('sepet = sipariş, hizmet VIRTUAL', [govde.basketId, govde.basketItems[0].id, govde.basketItems[0].itemType, govde.currency], [SIP, SIP, 'VIRTUAL', 'TRY']);
    sina('alıcı iyzico modeliyle', [govde.buyer.gsmNumber, govde.buyer.identityNumber, govde.buyer.city, govde.buyer.ip, govde.billingAddress.contactName],
      ['+905554443333', '11111111111', 'İstanbul', '203.0.113.7', 'Ali Veli Kaya']);
    sina('ödeme sayfası adresi', [r.ok, r.url], [true, 'https://sandbox-cpp.iyzipay.com/?token=f1e2d3c4-b5a6-7890-abcd-ef1234567890&lang=tr']);
    global.fetch = eskiFetch;
    console.warn = eskiWarn;

    const { verify } = require('../api/fix-pay-return.js');
    /* Sipariş veritabanından: KDV hariç 2.500 → beklenen 3.000. */
    const sip = { id: SIP, status: 'pending', price_discounted: 2500 };
    const ok = { status: 'success', paymentStatus: 'SUCCESS', fraudStatus: 1, basketId: SIP, price: '3000.0' };
    const v = function (fark, s2) { return verify(Object.assign({}, ok, fark), s2 === undefined ? sip : s2); };
    sina('başarılı ve fraud onaylı ödeme doğrulanıyor', v({}).ok, true);
    sina('tutar farklıysa REDDEDİLİYOR', v({ price: '2500.0' }).reason, 'amount_mismatch');
    sina('başka sepet REDDEDİLİYOR', v({ basketId: 'baska' }).reason, 'basket_mismatch');
    sina('ödeme başarısızsa REDDEDİLİYOR', v({ paymentStatus: 'FAILURE' }).reason, 'payment_failure');
    sina('iyzico failure REDDEDİLİYOR', verify({ status: 'failure' }, sip).ok, false);
    /* PR #115 incelemesi: fraud incelemesindeki ödeme hizmeti başlatmamalı. */
    sina('fraud incelemesinde (0) ödendi SAYILMIYOR', [v({ fraudStatus: 0 }).reason, v({ fraudStatus: 0 }).review], ['fraud_review', true]);
    sina('fraud durumu yoksa da incelemede sayılıyor', v({ fraudStatus: undefined }).reason, 'fraud_review');
    sina('fraud reddi (-1)', v({ fraudStatus: -1 }).reason, 'fraud_rejected');
    sina('sipariş yoksa REDDEDİLİYOR', v({}, null).reason, 'order_not_found');
    sina('zaten ödenmiş sipariş tekrar ödendi yapılmıyor', v({}, Object.assign({}, sip, { status: 'paid' })).reason, 'order_not_pending');

    const kok = path.join(__dirname, '..');
    const payJs = fs.readFileSync(path.join(kok, 'api', 'fix-pay.js'), 'utf8');
    sina('tutar veritabanındaki siparişten (istemciden değil)',
      /grossTry\(order\.price_discounted\)/.test(payJs) && !/params\.(amount|price|tutar)/.test(payJs), true);
    sina('yalnızca bekleyen sipariş ödenebiliyor', /order\.status !== 'pending'/.test(payJs), true);
    /* PR #115 incelemesi: eşleme yazılamazsa ödeme alınıp sipariş ödenmemiş
       kalıyordu. Artık önbellek yok; dönüş siparişi basketId ile VT'den okur. */
    sina('ödeme ucu önbellek eşlemesine bağlı değil', /store\.|cacheSet/.test(payJs), false);
    const retJs = fs.readFileSync(path.join(kok, 'api', 'fix-pay-return.js'), 'utf8');
    sina('dönüş yalnızca pending siparişi paid yapıyor (tekrar dönüş etkisiz)', /status=eq\.pending/.test(retJs), true);
    sina('dönüş siparişi iyzico basketId ile veritabanından okuyor', /data\.basketId/.test(retJs) && /fix_orders\?id=eq\./.test(retJs) && !/cacheGet/.test(retJs), true);
    const fc = fs.readFileSync(path.join(kok, 'fix-checkout.html'), 'utf8');
    sina('/fix-checkout formu POST /api/fix-pay', /<form[^>]*id="payForm"[^>]*method="post"[^>]*action="\/api\/fix-pay"/.test(fc), true);
    sina('/fix-checkout "Güvenli Öde - iyzico ile"', /Güvenli Öde - iyzico ile/.test(fc), true);
    sina('/fix-checkout "Fiyatlara KDV dahildir"', /Fiyatlara KDV dahildir/.test(fc) && !/KDV hariçtir/.test(fc), true);
    sina('/fix-checkout artık "ödeme bağlantısı gönderilir" demiyor', /ödeme bağlantısı/.test(fc), false);
    const ix = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
    sina('sepet butonu "Güvenli Öde"', /cartOrder: 'Güvenli Öde'/.test(ix) && !/cartOrder: 'Sipariş ver'/.test(ix), true);
    sina('sepet KDV dahil gösteriyor', /cartVat: '\(KDV dahil\)'/.test(ix) && /cartVatNote: 'Fiyatlara KDV dahildir/.test(ix) && /fmtTL\(gross\(list\)\)/.test(ix), true);
  }

  /* ---- 11a. Dönüşte kullanıcı çerezsiz bulunuyor ----
     iyzico'nun dönüşü siteler arası POST; SameSite=Lax oturum çerezi
     gelmez. Ödeme başlarken token → hesap eşlemesi depoya yazılıyor, dönüş
     ucu kullanıcıyı oradan buluyor (canlı deneme 2026-10-22). */
  {
    const Module = require('node:module');
    const path = require('node:path');
    const depoYolu = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'store.js'));
    const donusYolu = require.resolve(path.join(__dirname, '..', 'api', 'checkout-return.js'));
    const eskiDepo = require.cache[depoYolu];
    const eskiDonus = require.cache[donusYolu];
    const veri = {};
    const sahte = new Module(depoYolu); sahte.filename = depoYolu; sahte.loaded = true;
    sahte.exports = Object.assign({}, eskiDepo ? eskiDepo.exports : {}, {
      isConfigured: function () { return true; },
      cacheGet: async function (k) { return Object.prototype.hasOwnProperty.call(veri, k) ? veri[k] : null; },
      cacheSet: async function (k, v) { veri[k] = v; }
    });
    require.cache[depoYolu] = sahte;
    delete require.cache[donusYolu];
    const donus = require(donusYolu);
    const T = 'e828c62d-fd12-4b1a-ad5a-380f15fe6596';
    sina('eşleme yoksa kullanıcı yok', await donus.pendingUser(T), null);
    veri[checkout.PENDING_PREFIX + T] = { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co' };
    sina('token → hesap eşlemesinden kullanıcı', await donus.pendingUser(T),
      { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co' });
    sina('token yoksa eşleme aranmıyor', await donus.pendingUser(null), null);
    veri[checkout.PENDING_PREFIX + 'bozuk'] = { id: 42 };
    sina('bozuk eşleme kabul edilmiyor', await donus.pendingUser('bozuk'), null);
    const kaynak = require('node:fs').readFileSync(donusYolu, 'utf8');
    sina('dönüş ucu kullanıcıyı çerezden SONRA eşlemeden arıyor',
      /sessionUser \|\| await pendingUser\(token\)/.test(kaynak), true);
    sina('dönüş ucu ve ödeme ucu aynı anahtar önekini kullanıyor',
      kaynak.indexOf("'" + checkout.PENDING_PREFIX + "'") !== -1, true);
    if (eskiDepo) require.cache[depoYolu] = eskiDepo; else delete require.cache[depoYolu];
    if (eskiDonus) require.cache[donusYolu] = eskiDonus; else delete require.cache[donusYolu];
  }

  /* ---- 11b. Form başlatma: canlıda başarılı yanıtta adres beklenen
     alanlarda değildi (iyzico_form_url_missing, 2026-10-22). Yanıtta yalnızca
     token + checkoutFormContent varken CPP adresi token'dan kuruluyor;
     istek ACTIVE ile gidiyor; yanıt biçimi değersiz loglanıyor. */
  {
    const eskiFetch = global.fetch;
    const eskiWarn = console.warn;
    const uyarilar = [];
    console.warn = function () { uyarilar.push(Array.prototype.slice.call(arguments).join(' ')); };
    process.env.IYZICO_API_KEY = SANDBOX_API_KEY;
    process.env.IYZICO_SECRET_KEY = SANDBOX_SECRET;
    let govde = null;
    const TOKEN = 'f1e2d3c4-b5a6-7890-abcd-ef1234567890';
    global.fetch = async function (u, o) {
      govde = JSON.parse(o.body);
      return { ok: true, status: 200, json: async function () {
        return { status: 'success', systemTime: 1, token: TOKEN, checkoutFormContent: '<script>iyzi</script>', tokenExpireTime: 1800 };
      } };
    };
    const r = await iyzico.initializeCheckoutForm({ callbackUrl: 'https://www.cyberlionai.com/api/checkout-return',
      pricingPlanRef: 'ref', customer: { name: 'A' } });
    sina('abonelik ACTIVE ile başlatılıyor (PENDING yükseltmezdi)', govde.subscriptionInitialStatus, 'ACTIVE');
    sina('callbackUrl gidiyor', govde.callbackUrl, 'https://www.cyberlionai.com/api/checkout-return');
    sina('adres alanı yokken token\'dan sandbox CPP adresi',
      [r.ok, r.url, r.token], [true, 'https://sandbox-cpp.iyzipay.com/?token=' + TOKEN + '&lang=tr', TOKEN]);
    const sekil = uyarilar.join('\n');
    sina('yanıt biçimi loglanıyor', /iyzico checkoutform shape .*token:str\(36\)/.test(sekil), true);
    sina('logda token değeri yok', sekil.indexOf(TOKEN) === -1 && sekil.indexOf('iyzi</script>') === -1, true);

    global.fetch = async function () {
      return { ok: true, status: 200, json: async function () { return { status: 'success', checkoutFormContent: '<script></script>' }; } };
    };
    const yok = await iyzico.initializeCheckoutForm({ callbackUrl: 'x', pricingPlanRef: 'r', customer: {} });
    sina('ne adres ne token: form_url_missing', yok.reason, 'iyzico_form_url_missing');
    global.fetch = eskiFetch;
    console.warn = eskiWarn;
  }

  /* ---- 12. iyzico hata ayrıntısı ve süre sınırı (canlı 401, 2026-10-22) ----
     Canlıda yalnızca "401 … 8" loglandı; sebep görünmüyordu. Açıklama artık
     loglanıyor, anahtarlar maskeli; gövdesi gelmeyen cevap asmıyor. */
  {
    const eskiFetch = global.fetch;
    const eskiHata = console.error;
    const loglar = [];
    console.error = function () { loglar.push(Array.prototype.slice.call(arguments).map(String).join(' ')); };
    process.env.IYZICO_API_KEY = SANDBOX_API_KEY;
    process.env.IYZICO_SECRET_KEY = SANDBOX_SECRET;
    global.fetch = async function () {
      return { ok: false, status: 401, json: async function () {
        return { status: 'failure', errorCode: '1001', errorGroup: 'AUTH',
          errorMessage: 'api bilgileri bulunamadı ' + SANDBOX_API_KEY + ' / ' + SANDBOX_SECRET };
      } };
    };
    const r401 = await iyzico.request('POST', '/v2/subscription/checkoutform/initialize', { a: 1 });
    sina('401 sebebi korunuyor', [r401.reason, r401.errorCode], ['iyzico_http_401', '1001']);
    const satir = loglar.join('\n');
    sina('logda iyzico açıklaması var', /1001 \| AUTH \| api bilgileri bulunamadı/.test(satir), true);
    sina('logda API anahtarı yok (maskeli)', satir.indexOf(SANDBOX_API_KEY) === -1 && /\[key\]/.test(satir), true);
    sina('logda gizli anahtar yok', satir.indexOf(SANDBOX_SECRET) === -1, true);
    sina('logda istek gövdesi yok', satir.indexOf('"a":1') === -1, true);
    sina('açıklama 200 karakterle sınırlı',
      iyzico.errorDetail({ errorMessage: 'x'.repeat(500) }, {}).length, 200);

    /* Başlık gelir, gövde gelmez: süre sınırında kesilir. */
    const eskiSure = iyzico.LIMITS.timeoutMs;
    iyzico.LIMITS.timeoutMs = 50;
    let sinyal = null;
    global.fetch = async function (u, o) {
      sinyal = o.signal;
      return { ok: true, status: 200, json: function () {
        return new Promise(function (_, red) { o.signal.addEventListener('abort', function () { red(new Error('aborted')); }); });
      } };
    };
    const t0 = Date.now();
    const asili = await Promise.race([
      iyzico.request('POST', '/v2/subscription/checkoutform/initialize', {}),
      new Promise(function (ok) { setTimeout(function () { ok({ reason: 'TAKILDI' }); }, 2000); })
    ]);
    sina('gövdesi gelmeyen cevap süre sınırında kesilir', asili.reason, 'iyzico_timeout');
    sina('asılı istek hızlı bitiyor', Date.now() - t0 < 1000, true);
    sina('asılı bağlantı iptal edildi', Boolean(sinyal && sinyal.aborted), true);
    iyzico.LIMITS.timeoutMs = eskiSure;
    global.fetch = eskiFetch;
    console.error = eskiHata;
  }

  console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
  process.exit(hata === 0 ? 0 : 1);
})();
