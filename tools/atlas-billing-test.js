'use strict';
/**
 * atlasasistan.com sipariş formu + iyzico uçlarının sınamaları. Ağdan bağımsız
 * (iyzico ve Supabase sahte fetch ile).
 *
 *   npm ci && node tools/atlas-billing-test.js
 *
 *   1. Kurallar (atlas-billing.js): TC / VKN sağlaması, VAT ID, e-posta,
 *      E.164 (TR/DE/US), boş fatura alanlarıyla geçerli sipariş, ülkeye göre
 *      yok sayılan alanlar, yurt dışı aktarım onayı.
 *   2. /api/atlas-checkout: tutar istemciden alınmıyor; abonelik / kurulum
 *      doğru iyzico ucuna gidiyor; identityNumber boşsa 11111111111; jeton
 *      düz değil özet olarak yazılıyor; kapalıyken 503.
 *   3. /api/atlas-checkout-return: sonuç iyzico'dan; tutar ya da plan
 *      uyuşmazsa ödenmiş sayılmıyor.
 */

const crypto = require('node:crypto');

process.env.IYZICO_API_KEY = 'sandbox-aaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.IYZICO_SECRET_KEY = 'sandbox-UuLnD7wZa0a3DmytfIrwHQqAMfqCNJrs';
process.env.IYZICO_BASE_URL = 'https://sandbox-api.iyzipay.com';
process.env.SUPABASE_URL = 'https://atlas-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.IYZICO_ATLAS_PLAN_STANDART = 'ref-standart-0001';
process.env.IYZICO_ATLAS_PLAN_PRO = 'ref-pro-0000000002';
process.env.SITE_URL = 'https://atlasasistan.com';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

const B = require('../atlas-billing.js');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen)
              + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

function siparis(ek) {
  return Object.assign({
    plan: 'pro', name: 'Ayşe Yılmaz', clinic: 'Işıl Klinik', email: 'Ayse@Ornek.com',
    country: 'TR', phone: '0532 123 45 67', address: 'Cevizli Mah. Zuhal Cad. No 46', city: 'İstanbul',
    billing: { type: 'individual' }, consentPpf: true, consentTransfer: true
  }, ek || {});
}

console.log('Kurallar');
sina('TC geçerli (10000000146)', B.isValidTckn('10000000146'), true);
sina('TC ilk hane 0', B.isValidTckn('01234567890'), false);
sina('TC sağlama hatalı (12345678901)', B.isValidTckn('12345678901'), false);
sina('TC 10 hane', B.isValidTckn('1000000014'), false);
sina('VKN geçerli (GİB örnekleri)', ['1234567890', '9876543217'].map(B.isValidVkn), [true, true]);
sina('VKN son hane hatalı', B.isValidVkn('1234567891'), false);
sina('VKN 9 hane', B.isValidVkn('123456789'), false);
sina('VAT AB: DE öneki zorunlu', [B.isValidVatId('DE123456789', 'DE'), B.isValidVatId('123456789', 'DE')], [true, false]);
sina('VAT Yunanistan EL öneki', B.isValidVatId('EL123456789', 'GR'), true);
sina('Tax ID AB dışı serbest', [B.isValidVatId('12-3456789', 'US'), B.isValidVatId('!', 'US')], [true, false]);
sina('e-posta', ['a@b.co', 'a@b', 'a b@c.com', 'a@@b.com'].map(B.isValidEmail), [true, false, false, false]);
sina('E.164 TR 0532…', B.toE164('0532 123 45 67', 'TR'), '+905321234567');
sina('E.164 DE 01512…', B.toE164('01512 3456789', 'DE'), '+4915123456789');
sina('E.164 US (201) 555-0123', B.toE164('(201) 555-0123', 'US'), '+12015550123');
sina('E.164 geçersiz kısa', B.toE164('0532 12', 'TR'), null);
sina('E.164 başka ülke numarası +49 TR seçiliyken de doğru', B.toE164('+4915123456789', 'TR'), '+4915123456789');
sina('aktarım onayı: TR/US gerekli, DE/NO değil', ['TR', 'US', 'DE', 'NO'].map(B.needsTransferConsent), [true, true, false, false]);

let r = B.validateOrder(siparis());
sina('fatura alanları boşken sipariş geçerli', [r.ok, r.errors], [true, {}]);
sina('telefon E.164, e-posta küçük harf', [r.value.phoneE164, r.value.email], ['+905321234567', 'ayse@ornek.com']);
sina('boş billing yapısı', r.value.billing, { type: 'individual', tcNo: '', taxNo: '', taxOffice: '', country: 'TR', vatId: '', companyRegNo: '' });
r = B.validateOrder(siparis({ billing: { type: 'individual', tcNo: '12345678901' } }));
sina('hatalı TC → tcNo hatası', r.errors, { tcNo: 'tcNo' });
r = B.validateOrder(siparis({ billing: { type: 'corporate', taxNo: '123456789', taxOffice: 'K' } }));
sina('hatalı VKN + kısa vergi dairesi', r.errors, { taxNo: 'taxNo', taxOffice: 'taxOffice' });
r = B.validateOrder(siparis({ billing: { type: 'corporate', taxNo: '1234567890', taxOffice: 'Kadıköy', tcNo: '12345678901' } }));
sina('kurumsalda TC yok sayılır', [r.ok, r.value.billing.tcNo, r.value.billing.taxNo], [true, '', '1234567890']);
r = B.validateOrder(siparis({ country: 'DE', phone: '+4915123456789', consentTransfer: false, billing: { type: 'corporate', vatId: 'de 123 456 789', companyRegNo: 'HRB 12345', tcNo: '10000000146' } }));
sina('DE: VAT + sicil, TC yok sayılır, aktarım onayı gerekmez', [r.ok, r.value.billing.vatId, r.value.billing.companyRegNo, r.value.billing.tcNo], [true, 'DE123456789', 'HRB 12345', '']);
r = B.validateOrder(siparis({ country: 'US', phone: '2015550123', consentTransfer: false }));
sina('US: aktarım onayı zorunlu', r.errors, { consentTransfer: 'consentTransfer' });
r = B.validateOrder(siparis({ name: 'Ayşe', email: 'x', phone: '123', address: 'kısa', city: '', consentPpf: false }));
sina('zorunlu alan hataları', r.errors, { name: 'name', email: 'email', phone: 'phone', address: 'address', city: 'required', consentPpf: 'consentPpf' });
r = B.validateOrder(siparis({ country: 'tr' }));
sina('ülke kodu büyük harfe çevrilir', r.value.country, 'TR');
r = B.validateOrder(siparis({ country: 'XX' }));
sina('bilinmeyen ülke', r.errors.country, 'country');
sina('hata metinleri TR/EN', [B.msg('tr', 'tcNo').slice(0, 13), B.msg('en', 'tcNo').slice(0, 10)], ['TC Kimlik No ', 'Invalid Tu']);

/* --------------------------------------------------------------- uçlar */

const db = [];
const istekler = [];
let iyzicoCevap = {};

function json(status, body) {
  return { ok: status < 400, status: status, json: async function () { return body; }, text: async function () { return JSON.stringify(body); } };
}

global.fetch = async function (url, opts) {
  const u = new URL(url);
  const govde = opts && opts.body ? JSON.parse(opts.body) : null;
  istekler.push({ host: u.host, path: u.pathname, search: u.search, method: (opts && opts.method) || 'GET', body: govde });
  if (u.host === 'atlas-test.supabase.co') {
    const q = new URLSearchParams(u.search);
    const eslesir = function (row) {
      let ok = true;
      q.forEach(function (v, k) { if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) ok = false; });
      return ok;
    };
    if (opts.method === 'POST') {
      const row = Object.assign({ id: crypto.randomUUID() }, govde);
      db.push(row);
      return json(201, [row]);
    }
    if (opts.method === 'PATCH') {
      const rows = db.filter(eslesir);
      rows.forEach(function (row) { Object.assign(row, govde); });
      return json(200, rows);
    }
    return json(200, db.filter(eslesir).slice(0, 1));
  }
  if (u.host === 'sandbox-api.iyzipay.com') {
    const c = iyzicoCevap[u.pathname] || iyzicoCevap['*'];
    return json(200, typeof c === 'function' ? c(govde) : c);
  }
  throw new Error('beklenmeyen ağ: ' + url);
};

function sahteRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.setHeader = function (k, v) { res.headers[k.toLowerCase()] = v; };
  res.status = function (s) { res.statusCode = s; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.end = function () { return res; };
  return res;
}
async function cagir(handler, req) {
  const res = sahteRes();
  await handler(Object.assign({ headers: { host: 'atlasasistan.com' }, query: {} }, req), res);
  return res;
}

(async function () {
  const checkout = require('../api/atlas-checkout.js');
  const ret = require('../api/atlas-checkout-return.js');

  console.log('\n/api/atlas-checkout');
  process.env.ATLAS_CHECKOUT_ENABLED = 'false';
  let res = await cagir(checkout, { method: 'GET', query: { mode: '1' } });
  sina('kapalıyken mode → enabled false', res.body, { enabled: false, testMode: null });
  res = await cagir(checkout, { method: 'POST', body: siparis() });
  sina('kapalıyken POST → 503, kayıt yok', [res.statusCode, db.length], [503, 0]);

  process.env.ATLAS_CHECKOUT_ENABLED = 'true';
  res = await cagir(checkout, { method: 'GET', query: { mode: '1' } });
  sina('açıkken mode → sandbox', res.body, { enabled: true, testMode: true });

  res = await cagir(checkout, { method: 'POST', body: siparis({ billing: { type: 'individual', tcNo: '12345678901' } }) });
  sina('hatalı TC → 400 + alan hatası, kayıt yok', [res.statusCode, res.body.errors, db.length], [400, { tcNo: 'tcNo' }, 0]);
  res = await cagir(checkout, { method: 'POST', body: siparis({ plan: 'ultra' }) });
  sina('bilinmeyen paket → 400', [res.statusCode, res.body.error.code], [400, 'plan']);

  iyzicoCevap = { '*': { status: 'success', token: 'tok-pro-1234567890', checkoutFormContent: '', paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=tok-pro-1234567890' } };
  res = await cagir(checkout, { method: 'POST', body: siparis({ plan: 'pro', amountTry: 1, price: 1 }) });
  const abonelik = istekler.filter(function (i) { return i.host === 'sandbox-api.iyzipay.com'; }).pop();
  sina('Pro → abonelik formu, 200 + iyzico adresi', [res.statusCode, abonelik.path, /^https:\/\/sandbox-cpp\.iyzipay\.com/.test(res.body.url)], [200, '/v2/subscription/checkoutform/initialize', true]);
  sina('fiyat planı referansı env\'den', abonelik.body.pricingPlanReferenceCode, 'ref-pro-0000000002');
  sina('müşteri: E.164, boş TC → 11111111111, ülke adı İngilizce', [abonelik.body.customer.gsmNumber, abonelik.body.customer.identityNumber, abonelik.body.customer.billingAddress.country], ['+905321234567', '11111111111', 'Türkiye']);
  sina('dönüş adresi', abonelik.body.callbackUrl, 'https://atlasasistan.com/api/atlas-checkout-return');
  const proRow = db[db.length - 1];
  sina('sipariş: tutar sunucudan (7900), pending, jeton düz değil', [proRow.amount_try, proRow.status, proRow.iyzico_token_hash, JSON.stringify(proRow).indexOf('tok-pro-1234567890')],
    [7900, 'pending', crypto.createHash('sha256').update('tok-pro-1234567890').digest('hex'), -1]);

  iyzicoCevap = { '*': { status: 'success', token: 'tok-vip-1234567890', paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=tok-vip-1234567890' } };
  res = await cagir(checkout, { method: 'POST', headers: { host: 'atlasasistan.com', 'x-vercel-forwarded-for': '203.0.113.9' }, body: siparis({ plan: 'vip', billing: { type: 'corporate', taxNo: '1234567890', taxOffice: 'Kadıköy' } }) });
  const kurulum = istekler.filter(function (i) { return i.host === 'sandbox-api.iyzipay.com'; }).pop();
  const vipRow = db[db.length - 1];
  sina('VIP → tek seferlik form, kurulum tutarı 24900', [res.statusCode, kurulum.path, kurulum.body.price, kurulum.body.basketId === vipRow.id], [200, '/payment/iyzipos/checkoutform/initialize/auth/ecom', '24900.0', true]);
  sina('kurumsal: identityNumber = VKN, alıcı IP', [kurulum.body.buyer.identityNumber, kurulum.body.buyer.ip], ['1234567890', '203.0.113.9']);
  sina('billing jsonb kaydı', vipRow.billing, { type: 'corporate', tcNo: '', taxNo: '1234567890', taxOffice: 'Kadıköy', country: 'TR', vatId: '', companyRegNo: '' });

  iyzicoCevap = { '*': { status: 'failure', errorCode: '200702', errorMessage: 'x' } };
  const once = db.length;
  res = await cagir(checkout, { method: 'POST', body: siparis({ plan: 'standart' }) });
  sina('iyzico reddi → 502, sipariş failed', [res.statusCode, db.length - once, db[db.length - 1].status], [502, 1, 'failed']);

  console.log('\n/api/atlas-checkout-return');
  iyzicoCevap = { '*': { status: 'success', paymentStatus: 'SUCCESS', fraudStatus: 1, basketId: vipRow.id, price: '24900.0', paidPrice: '24900.0', paymentId: 'pay-1' } };
  res = await cagir(ret, { method: 'POST', body: { token: 'tok-vip-1234567890' } });
  sina('kurulum ödemesi doğrulandı → paid + success', [res.headers.location, vipRow.status, vipRow.iyzico_ref], ['/checkout?plan=vip&status=success', 'paid', 'pay-1']);
  res = await cagir(ret, { method: 'POST', body: { token: 'tok-vip-1234567890' } });
  sina('ikinci dönüş: yine success, durum değişmez', [res.headers.location, vipRow.status], ['/checkout?plan=vip&status=success', 'paid']);

  /* Tutar uyuşmazlığı: aynı VIP siparişini yeniden pending yapıp düşük tutarla. */
  vipRow.status = 'pending';
  iyzicoCevap = { '*': { status: 'success', paymentStatus: 'SUCCESS', fraudStatus: 1, basketId: vipRow.id, price: '1.0', paidPrice: '1.0' } };
  res = await cagir(ret, { method: 'POST', body: { token: 'tok-vip-1234567890' } });
  sina('tutar uyuşmazlığı → failed', [res.headers.location, vipRow.status, vipRow.fail_reason], ['/checkout?plan=vip&status=failed', 'failed', 'amount_mismatch']);

  iyzicoCevap = { '*': { status: 'success', data: { subscriptionStatus: 'ACTIVE', pricingPlanReferenceCode: 'ref-standart-0001', referenceCode: 'sub-1' } } };
  res = await cagir(ret, { method: 'GET', query: { token: 'tok-pro-1234567890' } });
  sina('Pro siparişi Standart planıyla döndü → failed', [res.headers.location, proRow.status, proRow.fail_reason], ['/checkout?plan=pro&status=failed', 'failed', 'plan_mismatch']);

  proRow.status = 'pending';
  iyzicoCevap = { '*': { status: 'success', data: { subscriptionStatus: 'ACTIVE', pricingPlanReferenceCode: 'ref-pro-0000000002', referenceCode: 'sub-2' } } };
  res = await cagir(ret, { method: 'GET', query: { token: 'tok-pro-1234567890' } });
  sina('abonelik ACTIVE → paid', [res.headers.location, proRow.status, proRow.iyzico_ref], ['/checkout?plan=pro&status=success', 'paid', 'sub-2']);

  res = await cagir(ret, { method: 'POST', body: { token: 'tok-bilinmeyen-123456' } });
  sina('bilinmeyen jeton → failed', res.headers.location, '/checkout?plan=&status=failed');

  console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
  process.exit(hata === 0 ? 0 : 1);
})();
