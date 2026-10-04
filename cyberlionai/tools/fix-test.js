'use strict';
/**
 * "Biz düzeltelim" (Model B) + düzeltme önerisi sınaması. Ağ ve DB yok.
 * Sabitlenen: fiyatlar ve Pro/Enterprise %50; sepet tam paketle sınırlı;
 * OWASP bulgusu tam paket; fiyat istemciden ALINMAZ; doğrulanmamış alan adı
 * 403; iki onay zorunlu; sipariş Telegram'a düşer; yönetici durum değişikliği
 * Telegram'a 'ödendi' / 'tamamlandı' gönderir; yönetici olmayan 403.
 */
const path = require('node:path');
const Module = require('node:module');
const API = path.join(__dirname, '..', 'api');
let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (JSON.stringify(b) === JSON.stringify(e)) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }
function dogru(ad, k) { if (k) { gecti += 1; return; } hatalar.push(ad); }
function sapla(rel, govde) { const tam = require.resolve(path.join(API, rel)); const m = new Module(tam, null); m.filename = tam; m.loaded = true; m.exports = govde; require.cache[tam] = m; }

let kullanici = { id: 'u1', email: 'ali.veli@ornek.com' };
let plan = 'free';
let dogrulanmis = true;
const siparisler = [];
const telegram = [];
sapla('_lib/auth.js', { isConfigured: function () { return true; }, resolveUser: async function () { return kullanici; } });
sapla('_lib/entitlement.js', { planFor: async function () { return plan; } });
sapla('_lib/ownership.js', Object.assign({}, require(path.join(API, '_lib', 'ownership.js')), { isVerified: async function () { return dogrulanmis; } }));
sapla('_lib/store.js', { isConfigured: function () { return true; }, hitRateLimit: async function () { return { count: 1, ttl: 60 }; }, setOnce: async function () { return true; } });
sapla('_lib/session.js', { clientIp: function () { return '198.51.100.4'; }, ipKey: function (x) { return x; } });
sapla('_lib/db.js', {
  isConfigured: function () { return true; },
  request: async function (q, o) {
    if (q === 'fix_orders' && o.method === 'POST') { const r = Object.assign({ id: '11111111-1111-4111-8111-11111111111' + siparisler.length, status: 'pending', created_at: 'x' }, o.body); siparisler.push(r); return [r]; }
    if (q.indexOf('fix_orders?id=eq.') === 0 && o && o.method === 'PATCH') { const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(q)[1]); const r = siparisler.find(function (x) { return x.id === id; }); if (!r) return []; Object.assign(r, o.body); return [r]; }
    return [];
  }
});
process.env.TELEGRAM_BOT_TOKEN = '7851234567:AAH9xKq-Zm3Rn4pQw7sTvB2cDeFgHiJkLmN';
process.env.TELEGRAM_CHAT_ID = '-1001';
global.fetch = async function (u, o) { telegram.push(JSON.parse(o.body).text); return { ok: true, status: 200 }; };

const pricing = require(path.join(API, '_lib', 'fixpricing.js'));
const order = require(path.join(API, 'fix-order.js'));
const suggestion = require(path.join(API, 'fix-suggestion.js'));
const admin = require(path.join(API, 'admin', 'fix-orders.js'));
function res() { const r = { statusCode: 0, body: null, headers: {}, headersSent: false, setHeader: function (k, v) { r.headers[k] = v; }, status: function (c) { r.statusCode = c; return r; }, json: function (b) { r.body = b; r.headersSent = true; return r; } }; return r; }
async function cagir(h, req) { const r = res(); await h(Object.assign({ headers: {}, query: {} }, req), r); return r; }

(async function () {
  /* ---------- fiyatlar ---------- */
  esit('başlık 499', pricing.quote(['hsts'], 'single', 'free').price, 499);
  esit('Pro %50 → 250', pricing.quote(['hsts'], 'single', 'pro').priceDiscounted, 250);
  esit('Enterprise da %50', pricing.quote(['hsts'], 'single', 'enterprise').priceDiscounted, 250);
  esit('Free indirimsiz', pricing.quote(['hsts'], 'single', 'free').priceDiscounted, 499);
  esit('TLS 999', pricing.quote(['tls_cert'], 'single', 'free').price, 999);
  esit('SPF 999', pricing.quote(['spf'], 'single', 'free').price, 999);
  esit('sepet toplamı', pricing.quote(['hsts', 'xframe'], 'single', 'free').price, 998);
  esit('tavan altındaki sepet toplanır', pricing.quote(['hsts', 'csp', 'tls_cert'], 'single', 'free').price, 2497);
  /* Kullanıcının örneği: 3×999 + 4×499 = 4993 (tavanın altında). */
  const yedi = ['dnssec', 'dmarc', 'permissions', 'referrer', 'nosniff', 'xframe', 'tls_legacy'];
  esit('7 bulgu: liste 4993', pricing.quote(yedi, 'single', 'free').price, 4993);
  esit('7 bulgu: Pro 2497', pricing.quote(yedi, 'single', 'pro').priceDiscounted, 2497);
  const cok = ['https', 'csp', 'tls_cert', 'tls_protocol', 'spf', 'dmarc'];
  esit('sepet tam paket tavanıyla sınırlı (6×999 → 5000)', pricing.quote(cok, 'single', 'free').price, 5000);
  esit('tavana ulaşınca tür full', pricing.quote(cok, 'single', 'free').type, 'full');
  esit('tavanda Pro 2500', pricing.quote(cok, 'single', 'pro').priceDiscounted, 2500);
  esit('tek TLS bulgusu Pro 500', pricing.quote(['csp'], 'single', 'pro').priceDiscounted, 500);
  esit('OWASP bulgusu tam paket', pricing.quote(['a03_xss_reflection'], 'single', 'free').price, 5000);
  esit('Pro tam paket 2500', pricing.quote(['hsts'], 'full', 'pro').priceDiscounted, 2500);
  esit('geçersiz kimlik atılır', pricing.quote(['<script>', 'hsts', 'hsts'], 'single', 'free').items.length, 1);
  esit('boş sepet', pricing.quote([], 'single', 'free').code, 'no_findings');

  /* ---------- öneri ---------- */
  plan = 'pro';
  let r = await cagir(suggestion, { method: 'POST', body: { domain: 'ornek.com', findingId: 'hsts', lang: 'tr' } });
  esit('öneri 200', r.statusCode, 200);
  dogru('öneri: Nginx kodu', /add_header Strict-Transport-Security/.test(r.body.fix.nginx));
  dogru('öneri: Apache kodu', /Header always set Strict-Transport-Security/.test(r.body.fix.apache));
  dogru('öneri: Cloudflare adımı', /Transform Rules/.test(r.body.fix.cloudflare));
  esit('öneri: fiyat + Pro indirimi', [r.body.price, r.body.priceDiscounted, r.body.isPro, r.body.severity], [499, 250, true, 'high']);
  r = await cagir(suggestion, { method: 'POST', body: { findingId: 'a01__env' } });
  esit('öneri: OWASP → kod yok, tam paket', [r.body.fix, r.body.tier, r.body.price], [null, 'full', 5000]);
  r = await cagir(suggestion, { method: 'POST', body: { findingId: '../etc' } });
  esit('öneri: geçersiz kimlik 400', r.statusCode, 400);

  /* ---------- sipariş ---------- */
  const govde = { domain: 'ornek.com', findingIds: ['hsts', 'xframe'], type: 'single', agreements: true, startConsent: true, price: 1 };
  dogrulanmis = false;
  r = await cagir(order, { method: 'POST', body: govde });
  esit('doğrulanmamış → 403 ownership_required', [r.statusCode, r.body.error.code], [403, 'ownership_required']);
  esit('doğrulanmamışta sipariş yazılmadı', siparisler.length, 0);
  dogrulanmis = true;
  r = await cagir(order, { method: 'POST', body: Object.assign({}, govde, { agreements: false }) });
  esit('sözleşme onayı yok → 400', r.body.error.code, 'agreements_required');
  r = await cagir(order, { method: 'POST', body: Object.assign({}, govde, { startConsent: false }) });
  esit('ifaya başlama onayı yok → 400', r.body.error.code, 'start_consent_required');
  telegram.length = 0;
  r = await cagir(order, { method: 'POST', body: govde });
  esit('sipariş 201', r.statusCode, 201);
  esit('fiyat istemciden alınmadı (998 → Pro 499)', [r.body.price, r.body.priceDiscounted], [998, 499]);
  dogru('ödeme sayfası adresi', /^\/fix-checkout\?orderId=/.test(r.body.checkoutUrl));
  const s0 = siparisler[0];
  dogru('onay zaman damgaları kaydedildi', !!s0.agreements_at && !!s0.start_consent_at);
  esit('plan kaydedildi', s0.plan, 'pro');
  dogru('Telegram: fix siparişi', /🛠️ Fix siparişi: ornek\.com/.test(telegram[0] || ''));
  dogru('Telegram: e-posta maskeli', (telegram[0] || '').indexOf('ali.veli@') === -1 && (telegram[0] || '').indexOf('a***@ornek.com') !== -1);
  dogru('Telegram: tutar', /Tutar: 499 TL \(liste 998 TL\) \+ KDV/.test(telegram[0] || ''));
  kullanici = null;
  r = await cagir(order, { method: 'POST', body: govde });
  esit('girişsiz 401', r.statusCode, 401);
  kullanici = { id: 'u1', email: 'ali.veli@ornek.com' };

  /* ---------- yönetici ---------- */
  delete process.env.ADMIN_EMAILS;
  r = await cagir(admin, { method: 'GET' });
  esit('ADMIN_EMAILS yoksa kapalı', r.statusCode, 503);
  process.env.ADMIN_EMAILS = 'patron@cyberlionai.com';
  r = await cagir(admin, { method: 'POST', body: { id: s0.id, status: 'paid' } });
  esit('yönetici olmayan 403', r.statusCode, 403);
  kullanici = { id: 'a1', email: 'Patron@CyberLionAI.com' };
  telegram.length = 0;
  r = await cagir(admin, { method: 'POST', body: { id: s0.id, status: 'paid' } });
  esit('ödendi 200', r.statusCode, 200);
  dogru('Telegram: ödeme alındı', /✅ Fix ödemesi alındı/.test(telegram[0] || ''));
  dogru('ödeme zamanı', !!s0.paid_at);
  r = await cagir(admin, { method: 'POST', body: { id: s0.id, status: 'done' } });
  dogru('Telegram: tamamlandı', /✅ Fix tamamlandı: ornek\.com — hsts, xframe/.test(telegram[1] || ''));
  r = await cagir(admin, { method: 'POST', body: { id: s0.id, status: 'refunded' } });
  esit('geçersiz durum 400', r.statusCode, 400);

  if (hatalar.length) { console.error('Düzeltme hizmeti sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
  console.log('Düzeltme hizmeti sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (e) { console.error('sınama çöktü:', e && e.stack || e); process.exit(1); });
