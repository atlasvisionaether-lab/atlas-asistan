'use strict';
/**
 * Panelden ödeme: /api/atlas-checkout ve /api/atlas-checkout-return sınaması.
 *
 *   node tools/atlas-panel-checkout-test.js
 *
 * Ağ yok: global fetch sahte — Supabase Auth (/auth/v1/user), PostgREST
 * (users, atlas_orders) ve iyzico (abonelik formu) burada taklit edilir.
 *
 * Sınananlar: CORS yalnız panel origin'ine; oturumsuz 401; resepsiyon 403;
 * hatalı TC'de 400 + Türkçe mesaj; başarılı istekte siparişin jetonun
 * kurumuna bağlanması; iyzico dönüşünün panelin Kurulum ekranına gitmesi
 * (başarı ve jetonsuz durumda); ATLAS_PANEL_URL ayarı.
 */

const UID = '11111111-1111-4111-8111-111111111111';
const UID_RECEP = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const PANEL = 'https://atlas-asistan-panel-preview.vercel.app';
const GOOD = 'Bearer ' + 'a'.repeat(40);
const RECEP = 'Bearer ' + 'r'.repeat(40);

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxxxxxx',
  IYZICO_API_KEY: 'k'.repeat(30),
  IYZICO_SECRET_KEY: 's'.repeat(30),
  IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
  ATLAS_CHECKOUT_ENABLED: 'true',
  IYZICO_ATLAS_PLAN_STANDART: 'ref-std'
});
delete process.env.ATLAS_PANEL_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

let orderPosts = [];
let storedOrder = null;

function reply(status, body) {
  return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body),
    { status: status, headers: { 'Content-Type': 'application/json' } }));
}

global.fetch = function (url, opts) {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';
  const auth = opts && opts.headers && opts.headers.Authorization;
  if (u === 'https://db.test/auth/v1/user') {
    if (auth === GOOD) return reply(200, { id: UID, email: 'ayse@ornek.com' });
    if (auth === RECEP) return reply(200, { id: UID_RECEP, email: 'resepsiyon@ornek.com' });
    return reply(401, { msg: 'invalid JWT' });
  }
  if (u.startsWith('https://db.test/rest/v1/users?id=eq.' + UID + '&')) return reply(200, [{ organization_id: ORG, role: 'owner' }]);
  if (u.startsWith('https://db.test/rest/v1/users?id=eq.' + UID_RECEP + '&')) return reply(200, [{ organization_id: ORG, role: 'receptionist' }]);
  if (u === 'https://db.test/rest/v1/atlas_orders' && method === 'POST') {
    const body = JSON.parse(opts.body);
    orderPosts.push(body);
    storedOrder = Object.assign({ id: ORDER }, body);
    return reply(201, [storedOrder]);
  }
  if (u.startsWith('https://db.test/rest/v1/atlas_orders?iyzico_token_hash=eq.')) return reply(200, storedOrder ? [storedOrder] : []);
  if (u.startsWith('https://db.test/rest/v1/atlas_orders?') && method === 'PATCH') {
    Object.assign(storedOrder, JSON.parse(opts.body));
    return reply(200, [storedOrder]);
  }
  if (u === 'https://sandbox-api.iyzipay.com/v2/subscription/checkoutform/initialize') {
    return reply(200, { status: 'success', token: 'tok-123456789', checkoutFormUrl: 'https://sandbox-cpp.iyzipay.com/?token=tok-123456789' });
  }
  if (u === 'https://sandbox-api.iyzipay.com/v2/subscription/checkoutform/tok-123456789') {
    return reply(200, { status: 'success', data: { subscriptionStatus: 'ACTIVE', pricingPlanReferenceCode: 'ref-std', referenceCode: 'sub-1' } });
  }
  return Promise.reject(new Error('beklenmeyen istek: ' + method + ' ' + u));
};

const checkout = require('../api/atlas-checkout.js');
const checkoutReturn = require('../api/atlas-checkout-return.js');
const panel = require('../api/_atlas/panel.js');

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = function (k, v) { res.headers[k.toLowerCase()] = v; };
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.end = function () { return res; };
  return res;
}

async function call(handler, req) {
  const res = fakeRes();
  await handler(Object.assign({ headers: {}, query: {} }, req), res);
  return res;
}

function body(extra) {
  return Object.assign({
    plan: 'standart', lang: 'tr', name: 'Ayşe Yılmaz', clinic: 'Işıl Güzellik', email: 'ayse@ornek.com',
    country: 'TR', phone: '+905321234567', address: 'Atatürk Cad. No:5 Kadıköy', city: 'İstanbul',
    billing: { type: 'individual', tcNo: '10000000146' }, consentPpf: true, consentTransfer: true
  }, extra || {});
}

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? 'ok   ' : 'HATA ') + ad + (ok ? '' : ' — bulunan ' + JSON.stringify(bulunan) + ', beklenen ' + JSON.stringify(beklenen)));
}

(async function () {
  const origin = { origin: PANEL };

  let r = await call(checkout, { method: 'OPTIONS', headers: origin });
  sina('OPTIONS panel → 204', r.statusCode, 204);
  sina('OPTIONS panel → izinli origin', r.headers['access-control-allow-origin'], PANEL);
  sina('Authorization başlığına izin', /Authorization/.test(r.headers['access-control-allow-headers']), true);

  r = await call(checkout, { method: 'OPTIONS', headers: { origin: 'https://kotu.example' } });
  sina('başka origin → CORS başlığı yok', r.headers['access-control-allow-origin'], undefined);

  r = await call(checkout, { method: 'POST', headers: origin, body: body() });
  sina('oturumsuz → 401', [r.statusCode, r.body.error.code], [401, 'auth']);

  r = await call(checkout, { method: 'POST', headers: Object.assign({ authorization: 'Bearer ' + 'x'.repeat(40) }, origin), body: body() });
  sina('geçersiz jeton → 401', r.statusCode, 401);

  r = await call(checkout, { method: 'POST', headers: Object.assign({ authorization: RECEP }, origin), body: body() });
  sina('resepsiyon → 403', [r.statusCode, r.body.error.code], [403, 'role']);

  r = await call(checkout, { method: 'POST', headers: Object.assign({ authorization: GOOD }, origin), body: body({ billing: { type: 'individual', tcNo: '12345678901' } }) });
  sina('hatalı TC → 400', r.statusCode, 400);
  sina('hatalı TC → Türkçe mesaj', /TC Kimlik No geçersiz/.test(r.body.messages && r.body.messages.tcNo), true);
  sina('hatalı TC → sipariş açılmadı', orderPosts.length, 0);

  r = await call(checkout, { method: 'POST', headers: Object.assign({ authorization: GOOD }, origin), body: body() });
  sina('geçerli → 200 + iyzico adresi', [r.statusCode, r.body.url], [200, 'https://sandbox-cpp.iyzipay.com/?token=tok-123456789']);
  sina('sipariş jetonun kurumuna bağlı', orderPosts[0] && orderPosts[0].organization_id, ORG);
  sina('tutar sunucudan', orderPosts[0] && orderPosts[0].amount_try, 4900);

  r = await call(checkoutReturn, { method: 'GET', query: { token: 'tok-123456789' } });
  sina('dönüş → 303', r.statusCode, 303);
  sina('dönüş → panelin Kurulum ekranı (başarılı)', r.headers.location, PANEL + '/?odeme=success#onboarding');
  sina('sipariş ödendi', storedOrder.status, 'paid');

  r = await call(checkoutReturn, { method: 'GET', query: {} });
  sina('jetonsuz dönüş → panel (başarısız)', r.headers.location, PANEL + '/?odeme=failed#onboarding');
  sina('dönüşte WhatsApp yok', /wa\.me|whatsapp/i.test(r.headers.location), false);

  process.env.ATLAS_PANEL_URL = 'https://panel.atlasasistan.com/';
  sina('ATLAS_PANEL_URL ayarı', panel.panelUrl(), 'https://panel.atlasasistan.com');
  process.env.ATLAS_PANEL_URL = 'http://panel.atlasasistan.com';
  sina('https olmayan ATLAS_PANEL_URL yok sayılır', panel.panelUrl(), PANEL);
  delete process.env.ATLAS_PANEL_URL;

  console.log(hata ? '\n' + hata + ' sınama BAŞARISIZ' : '\nTümü geçti');
  process.exit(hata ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
