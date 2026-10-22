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
  esit('başlık 500 (KDV dahil)', pricing.quote(['hsts'], 'single', 'free').price, 500);
  esit('Pro %50 → 250', pricing.quote(['hsts'], 'single', 'pro').priceDiscounted, 250);
  esit('Enterprise da %50', pricing.quote(['hsts'], 'single', 'enterprise').priceDiscounted, 250);
  esit('Free indirimsiz', pricing.quote(['hsts'], 'single', 'free').priceDiscounted, 500);
  esit('TLS 1000', pricing.quote(['tls_cert'], 'single', 'free').price, 1000);
  esit('SPF 1000', pricing.quote(['spf'], 'single', 'free').price, 1000);
  esit('sepet toplamı', pricing.quote(['hsts', 'xframe'], 'single', 'free').price, 1000);
  /* 2026-10-22 canlı şikâyet: Pro'da satırlar "₺250 + ₺250", toplam ₺598,80
     görünüyordu. İndirim artık kalem başına; toplam satırların toplamı. */
  esit('Pro 2 başlık: 250 + 250 = 500', pricing.quote(['hsts', 'xframe'], 'single', 'pro').priceDiscounted, 500);
  esit('Pro 3 başlık: 750', pricing.quote(['hsts', 'xframe', 'nosniff'], 'single', 'pro').priceDiscounted, 750);
  esit('tavan altındaki sepet toplanır', pricing.quote(['hsts', 'csp', 'tls_cert'], 'single', 'free').price, 2500);
  /* Yuvarlak fiyatlarla (2026-10-22): 3×1000 + 3×500 = 4500 tavanın altında;
     7. bulgu (bir başlık daha) sepeti TAM 5000'e, yani tavana çıkarıyor. Eski
     fiyatlarla aynı 7 bulgu 4993'tü ve tekil kalıyordu. */
  const alti = ['dnssec', 'dmarc', 'permissions', 'referrer', 'nosniff', 'tls_legacy'];
  const yedi = alti.concat(['xframe']);
  esit('6 bulgu: liste 4500', pricing.quote(alti, 'single', 'free').price, 4500);
  esit('6 bulgu: Pro 2250', pricing.quote(alti, 'single', 'pro').priceDiscounted, 2250);
  esit('7 bulgu tam 5000: tavana ulaşınca tam paket', [pricing.quote(yedi, 'single', 'free').type, pricing.quote(yedi, 'single', 'free').price], ['full', 5000]);
  /* iyzico başvurusu öncesi kontrol: 7 bulgu + "Tam paket" seçimi → liste 5000, Pro/Enterprise 2500. */
  esit('7 bulgu tam paket: liste 5000', pricing.quote(yedi, 'full', 'free').price, 5000);
  esit('7 bulgu tam paket: Pro 2500', pricing.quote(yedi, 'full', 'pro').priceDiscounted, 2500);
  esit('7 bulgu tam paket: Enterprise 2500', pricing.quote(yedi, 'full', 'enterprise').priceDiscounted, 2500);
  esit('7 bulgu tam paket: Free indirimsiz 5000', pricing.quote(yedi, 'full', 'free').priceDiscounted, 5000);
  const cok = ['https', 'csp', 'tls_cert', 'tls_protocol', 'spf', 'dmarc'];
  esit('sepet tam paket tavanıyla sınırlı (6×1000 → 5000)', pricing.quote(cok, 'single', 'free').price, 5000);
  esit('tavana ulaşınca tür full', pricing.quote(cok, 'single', 'free').type, 'full');
  esit('tavanda Pro 2500', pricing.quote(cok, 'single', 'pro').priceDiscounted, 2500);
  esit('tek TLS bulgusu Pro 500', pricing.quote(['csp'], 'single', 'pro').priceDiscounted, 500);
  esit('OWASP bulgusu tam paket', pricing.quote(['a03_xss_reflection'], 'single', 'free').price, 5000);
  esit('Pro tam paket 2500', pricing.quote(['hsts'], 'full', 'pro').priceDiscounted, 2500);
  esit('geçersiz kimlik atılır', pricing.quote(['<script>', 'hsts', 'hsts'], 'single', 'free').items.length, 1);
  esit('boş sepet', pricing.quote([], 'single', 'free').code, 'no_findings');

  /* ---------- tavanın KAPSAMI ----------
     Eski kusur: tavan yalnızca FİYATA uygulanıyordu; sipariş `type: 'full'`,
     `price: 5000` olarak kaydediliyor ama `finding_ids` seçilenleri taşıyordu.
     Müşteri tam paket öder, iş emri alt küme yazardı. Aşağısı o eşleşmeyi
     kilitliyor: tavana ulaşan sepetin kapsamı KATALOGUN TAMAMI. */
  const KATALOG = pricing.ALL_IDS.length;
  esit('katalog 23 düzeltme taşıyor (okuma doğru çalışıyor)', KATALOG, 23);

  /* 6 → 8 → 9: fiyat artar, tavanda sabitlenir; kapsam tavanda tamamına çıkar. */
  const sekiz = yedi.concat(['hsts']);              /* 5000 + 500 → tavan */
  const dokuz = sekiz.concat(['coop']);   /* katalogdan, 9. bulgu */
  esit('6 bulgu: tür single', pricing.quote(alti, 'single', 'free').type, 'single');
  esit('6 bulgu: kapsam seçilenler', pricing.quote(alti, 'single', 'free').items.length, 6);
  esit('6 bulgu: coversAll false', pricing.quote(alti, 'single', 'free').coversAll, false);
  esit('8 bulgu: tavan 5000', pricing.quote(sekiz, 'single', 'free').price, 5000);
  esit('8 bulgu: kapsam TÜM katalog', pricing.quote(sekiz, 'single', 'free').items.length, KATALOG);
  esit('8 bulgu: coversAll true', pricing.quote(sekiz, 'single', 'free').coversAll, true);
  esit('9 bulgu: tavan 5000', pricing.quote(dokuz, 'single', 'free').price, 5000);
  esit('9 bulgu: kapsam TÜM katalog', pricing.quote(dokuz, 'single', 'free').items.length, KATALOG);
  esit('6 < 8 fiyat artıyor',
    pricing.quote(alti, 'single', 'free').price < pricing.quote(sekiz, 'single', 'free').price, true);

  /* Kural (2026-10-22): her tutar KDV dahil ve 50'nin katı; ödenecek toplam
     = kalemlerin indirimli fiyatlarının toplamı. Katalogdaki her kimlikten
     1–4'lü tüm sepetler, üç planla. */
  (function () {
    const ids = pricing.ALL_IDS;
    let bozuk = 0; let toplamHata = 0; let denenen = 0;
    const plans = ['free', 'pro', 'enterprise'];
    for (let a = 0; a < ids.length; a++) for (let b = a; b < Math.min(ids.length, a + 4); b++) {
      const sepet = ids.slice(a, b + 1);
      plans.forEach(function (plan) {
        const q = pricing.quote(sepet, 'single', plan);
        denenen++;
        if (q.price % 50 || q.priceDiscounted % 50) bozuk++;
        if (q.type === 'single') {
          const satir = q.items.reduce(function (t, i) { return t + pricing.discounted(i.price, plan); }, 0);
          if (satir !== q.priceDiscounted) toplamHata++;
        }
      });
    }
    esit('tüm sepetlerde tutarlar 50\'nin katı (' + denenen + ' sepet)', bozuk, 0);
    esit('satırlar toplamı = ödenecek toplam', toplamHata, 0);
    esit('kademeler 50\'nin katı', Object.values(pricing.TIERS).every(function (v) { return v % 50 === 0; }), true);
    esit('fiyat tablosu KDV dahil diyor', pricing.table().vatIncluded, true);
  })();
  esit('8 ile 9 aynı fiyat ama ikisi de tam paket',
    [pricing.quote(sekiz, 'single', 'free').type, pricing.quote(dokuz, 'single', 'free').type],
    ['full', 'full']);
  esit('tavanda indirim yalnızca Pro/Enterprise',
    [pricing.quote(sekiz, 'single', 'free').priceDiscounted,
     pricing.quote(sekiz, 'single', 'pro').priceDiscounted,
     pricing.quote(sekiz, 'single', 'enterprise').priceDiscounted],
    [5000, 2500, 2500]);

  /* Seçilen bulgu kapsamdan DÜŞMEMELİ: katalogda olmayan OWASP bulgusu da
     iş emrinde kalsın (müşteri onu tıkladı). */
  (function () {
    const q = pricing.quote(['a03_xss_reflection', 'hsts'], 'single', 'free');
    esit('OWASP seçimi tam pakete giriyor', [q.type, q.price], ['full', 5000]);
    esit('kapsam katalog + OWASP', q.items.length, KATALOG + 1);
    esit('tıklanan OWASP bulgusu kapsamda',
      q.items.some(function (i) { return i.id === 'a03_xss_reflection'; }), true);
  })();

  /* Fiyat tablosu arayüze kapsam sayısını veriyor: "23 bulgunun tamamı"
     metni sabit yazılmasın. */
  esit('fiyat tablosu fullCoverageCount taşıyor', pricing.table().fullCoverageCount, KATALOG);

  /* Arayüz: sepet çubuğu tavanda ne yazıyor. Müşterinin gördüğü cümle
     "8 ve 9 aynı fiyat" şaşkınlığını açıklamak zorunda. */
  (function () {
    const fs = require('fs');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    esit('sepet metni kapsam sayısını SUNUCUDAN okuyor',
      /fullCoverageCount/.test(html) && !/23 bulgunun/.test(html.replace(/\{n\} bulgunun/g, '')), true);
    esit('tavan metni iki dilde', (html.match(/cartFullNote:/g) || []).length, 2);
    esit('TR metni tamamının düzeltileceğini söylüyor',
      /cartFullNote: 'Tam paket sınırına ulaştınız, \{n\} bulgunun tamamı düzeltilecek'/.test(html), true);
  })();

  /* ---------- öneri ---------- */
  plan = 'pro';
  let r = await cagir(suggestion, { method: 'POST', body: { domain: 'ornek.com', findingId: 'hsts', lang: 'tr' } });
  esit('öneri 200', r.statusCode, 200);
  dogru('öneri: Nginx kodu', /add_header Strict-Transport-Security/.test(r.body.fix.nginx));
  dogru('öneri: Apache kodu', /Header always set Strict-Transport-Security/.test(r.body.fix.apache));
  dogru('öneri: Cloudflare adımı', /Transform Rules/.test(r.body.fix.cloudflare));
  esit('öneri: fiyat + Pro indirimi', [r.body.price, r.body.priceDiscounted, r.body.isPro, r.body.severity], [500, 250, true, 'high']);
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
  esit('fiyat istemciden alınmadı (1000 → Pro 500)', [r.body.price, r.body.priceDiscounted], [1000, 500]);
  dogru('ödeme sayfası adresi', /^\/fix-checkout\?orderId=/.test(r.body.checkoutUrl));
  const s0 = siparisler[0];
  dogru('onay zaman damgaları kaydedildi', !!s0.agreements_at && !!s0.start_consent_at);
  esit('plan kaydedildi', s0.plan, 'pro');
  dogru('Telegram: fix siparişi', /🛠️ Fix siparişi: ornek\.com/.test(telegram[0] || ''));
  dogru('Telegram: e-posta maskeli', (telegram[0] || '').indexOf('ali.veli@') === -1 && (telegram[0] || '').indexOf('a***@ornek.com') !== -1);
  dogru('Telegram: tutar', /Tutar: 500 TL \(liste 1000 TL\) \(KDV dahil\)/.test(telegram[0] || ''));
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
