'use strict';

/**
 * Dönüşüm hunisi sınaması (api/_lib/funnel.js, /kaynak.js, api/admin/funnel.js).
 * Ağ yok. Sabitlenen:
 *   - Anahtar `cl:fn:<İstanbul günü>:<olay>:<kaynak>`, bir yıldan uzun ömür;
 *     kaynak izinli listeden, dışındaki her değer 'direct' (anahtar uzayı sabit).
 *   - Sayma isteği BOZMAZ: depo yoksa/yazılamazsa false, fırlatma yok.
 *   - Rapor: gün × olay × kaynak, toplamlar doğru.
 *   - /kaynak.js tarayıcıya YALNIZCA "Kabul" (cookieConsent2) varsa yazar; onay
 *     yoksa yalnızca sayfa adresinden okur. İzinsiz değer yok sayılır.
 *   - Yönetici ucu: giriş yoksa 401, yönetici değilse 403.
 */
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const Module = require('node:module');
const API = path.join(__dirname, '..', 'api');

let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (b === e) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }
function sapla(rel, govde) { const tam = require.resolve(path.join(API, rel)); const m = new Module(tam, null); m.filename = tam; m.loaded = true; m.exports = govde; require.cache[tam] = m; }

/* --- Depo taklidi --- */
const sayac = {}; const omur = {}; let depoAcik = true; let depoDusuk = false;
sapla('_lib/store.js', {
  isConfigured: function () { return depoAcik; },
  incrCounter: async function (k, ttl) { if (depoDusuk) throw new Error('x'); sayac[k] = (sayac[k] || 0) + 1; omur[k] = ttl; return sayac[k]; },
  readCounters: async function (keys) { return keys.map(function (k) { return sayac[k] || 0; }); }
});
const funnel = require(path.join(API, '_lib', 'funnel.js'));

(async function () {
  const T = Date.parse('2026-10-25T22:30:00Z');   // İstanbul'da 26 Ekim 01:30
  esit('İstanbul günü', funnel.day(T), '2026-10-26');
  esit('kaynak izinli', funnel.source('SSL'), 'ssl');
  esit('kaynak izinsiz → direct', funnel.source('evil:key'), 'direct');
  esit('kaynak boş → direct', funnel.source(undefined), 'direct');

  esit('kayıt', await funnel.record('tool_use', 'ssl', T), true);
  esit('anahtar biçimi', sayac['cl:fn:2026-10-26:tool_use:ssl'], 1);
  esit('ömür bir yıldan uzun', omur['cl:fn:2026-10-26:tool_use:ssl'] > 365 * 86400, true);
  await funnel.record('scan', 'zararli\nanahtar', T);
  esit('izinsiz kaynak anahtara girmez', sayac['cl:fn:2026-10-26:scan:direct'], 1);
  esit('bilinmeyen olay sayılmaz', await funnel.record('page_view', 'ssl', T), false);
  depoDusuk = true;
  esit('depo düşerse fırlatmaz', await funnel.record('scan', 'ssl', T), false);
  depoDusuk = false; depoAcik = false;
  esit('depo yoksa sayılmaz', await funnel.record('scan', 'ssl', T), false);
  depoAcik = true;

  await funnel.record('scan', 'ssl', T);
  await funnel.record('checkout_start', 'ssl', T);
  await funnel.record('tool_use', 'ssl', T - 86400e3);
  const r = await funnel.report(2, T);
  esit('rapor günleri', r.days.join(), '2026-10-25,2026-10-26');
  esit('toplam araç kullanımı', r.totals.tool_use.ssl, 2);
  esit('toplam tarama', r.totals.scan.ssl, 1);
  esit('toplam ödeme formu', r.totals.checkout_start.ssl, 1);
  esit('doğrudan tarama', r.totals.scan.direct, 1);
  esit('günlük kırılım', r.daily[1].counts.tool_use.ssl, 1);
  esit('gün sınırı 90', (await funnel.report(500, T)).days.length, 90);

  /* --- /kaynak.js: onaya bağlı saklama --- */
  const KOD = fs.readFileSync(path.join(__dirname, '..', 'kaynak.js'), 'utf8');
  function tarayici(adres, onay, oturum) {
    const ls = { cookieConsent2: onay };
    const ss = Object.assign({}, oturum || {});
    const w = {
      location: { search: adres },
      localStorage: { getItem: function (k) { return ls[k] === undefined ? null : ls[k]; } },
      sessionStorage: { getItem: function (k) { return ss[k] === undefined ? null : ss[k]; }, setItem: function (k, v) { ss[k] = String(v); } }
    };
    const alan = { value: '' };
    const ctx = { window: w, localStorage: w.localStorage, sessionStorage: w.sessionStorage, URLSearchParams: URLSearchParams,
      document: { readyState: 'complete', getElementById: function (id) { return id === 'kaynakInput' ? alan : null; }, addEventListener: function () {} } };
    vm.runInNewContext(KOD, ctx);
    return { w: w, ss: ss, alan: alan };
  }
  let b = tarayici('?site=a.com&kaynak=ssl', 'accepted');
  esit('onaylı: oturum belleğine yazar', b.ss.cl_kaynak, 'ssl');
  esit('onaylı: kaynak okunur', b.w.clKaynak(), 'ssl');
  b = tarayici('?kaynak=ssl', 'declined');
  esit('reddedildi: yazmaz', b.ss.cl_kaynak, undefined);
  esit('reddedildi: aynı sayfada adresten okunur', b.w.clKaynak(), 'ssl');
  b = tarayici('', null, { cl_kaynak: 'ssl' });
  esit('onay yoksa saklanan okunmaz', b.w.clKaynak(), '');
  b = tarayici('', 'accepted', { cl_kaynak: 'blacklist' });
  esit('onaylı: sonraki sayfada saklanandan okunur', b.w.clKaynak(), 'blacklist');
  esit('ödeme formu gizli alanı doldurulur', b.alan.value, 'blacklist');
  b = tarayici('?kaynak=<script>', 'accepted');
  esit('izinsiz değer yok sayılır', b.w.clKaynak() + '|' + (b.ss.cl_kaynak || ''), '|');
  b = tarayici('?kaynak=email', null);
  b.w.localStorage.getItem = function () { return 'accepted'; };   // bildirimde "Kabul"
  b.w.clKaynakOnay();
  esit('kabul anında adresteki kaynak saklanır', b.ss.cl_kaynak, 'email');

  /* --- Yönetici ucu --- */
  let kullanici = null;
  process.env.ADMIN_EMAILS = 'yonetici@ornek.com';
  sapla('_lib/auth.js', { isConfigured: function () { return true; }, resolveUser: async function () { return kullanici; } });
  const uc = require(path.join(API, 'admin', 'funnel.js'));
  function istek() {
    const res = { statusCode: 0, headers: {}, body: null,
      setHeader: function (k, v) { this.headers[k] = v; },
      status: function (n) { this.statusCode = n; return this; },
      json: function (x) { this.body = x; return this; }, end: function () { return this; } };
    return uc({ method: 'GET', query: { days: '7' }, headers: {} }, res).then(function () { return res; });
  }
  esit('giriş yok → 401', (await istek()).statusCode, 401);
  kullanici = { email: 'baska@ornek.com' };
  esit('yönetici değil → 403', (await istek()).statusCode, 403);
  kullanici = { email: 'Yonetici@ornek.com' };
  const ok = await istek();
  esit('yönetici → 200', ok.statusCode, 200);
  esit('yönetici → 7 gün', ok.body.days.length, 7);
  esit('önbelleğe alınmaz', ok.headers['Cache-Control'], 'no-store');

  /* --- Uçlar doğru olayı doğru yerde sayıyor (kaynak düzeyinde) --- */
  const oku = function (f) { return fs.readFileSync(path.join(API, f), 'utf8'); };
  const tara = oku('scan.js');
  esit('tarama: kota ayrılmadan sayılmaz', tara.indexOf("funnel.record('scan'") > tara.indexOf('reserveQuota'), true);
  esit('tarama: hem eşzamanlı hem kuyruk yolu', (tara.match(/funnel\.record\('scan', body && body\.kaynak\)/g) || []).length, 2);
  esit('kuyruk ucu: başarıdan sonra', /if \(!kuyruk\.ok\)[\s\S]*funnel\.record\('scan', body && body\.kaynak\)/.test(oku('enqueue-scan.js')), true);
  const odeme = oku('checkout.js');
  esit('ödeme: yönlendirmeden hemen önce', /funnel\.record\('checkout_start', params\.kaynak\);\s*res\.setHeader\('Location', init\.url\)/.test(odeme), true);
  esit('ödeme: kaynak bekleyen eşlemeye yazılıyor', /kaynak: funnel\.source\(params\.kaynak\)/.test(odeme), true);
  esit('dönüş: başarı abonelik başına bir kez (tekSefer içinde)', /tekSefer\('pay:[\s\S]{0,400}if \(aktif\) await funnel\.record\('checkout_success'/.test(oku('checkout-return.js')), true);
  /* "Biz düzeltelim": ilk gerçek ödeme (2026-10-25) bu türdendi. */
  esit('düzeltme olayları tanımlı', funnel.EVENTS.indexOf('fix_checkout_start') !== -1 && funnel.EVENTS.indexOf('fix_paid') !== -1, true);
  const fixPay = oku('fix-pay.js');
  esit('düzeltme: iyzico yönlendirmesinden hemen önce', /funnel\.record\('fix_checkout_start', params\.kaynak\);\s*res\.setHeader\('Location', init\.url\)/.test(fixPay), true);
  esit('düzeltme: ödendi yalnızca satır gerçekten güncellendiğinde', /const row = rows && rows\[0\];\s*if \(row\) \{[\s\S]{0,300}funnel\.record\('fix_paid', req\.query && req\.query\.kaynak\)/.test(oku('fix-pay-return.js')), true);
  sapla('_lib/telegram.js', { ucuSar: function (h) { return h; }, sendTelegram: async function () {}, mesaj: {} });
  process.env.SITE_URL = 'https://www.cyberlionai.com';
  const fp = require(path.join(API, 'fix-pay.js'));
  const SIP = '33333333-3333-4333-8333-333333333333';
  esit('dönüş adresi kaynaksız eskisiyle aynı', fp.callbackUrl({ headers: {} }, SIP), 'https://www.cyberlionai.com/api/fix-pay-return?orderId=' + SIP);
  esit('dönüş adresi kaynakla', fp.callbackUrl({ headers: {} }, SIP, 'blacklist'), 'https://www.cyberlionai.com/api/fix-pay-return?orderId=' + SIP + '&kaynak=blacklist');
  esit('dönüş adresine izinsiz değer girmez', fp.callbackUrl({ headers: {} }, SIP, '&x=<y>'), 'https://www.cyberlionai.com/api/fix-pay-return?orderId=' + SIP);
  esit('düzeltme sayfası: gizli alan ve betik', /name="kaynak" id="kaynakInput"[\s\S]*src="\/kaynak\.js"/.test(fs.readFileSync(path.join(__dirname, '..', 'fix-checkout.html'), 'utf8')), true);
  await funnel.record('fix_paid', 'blacklist', T);
  esit('raporda düzeltme ödemesi', (await funnel.report(1, T)).totals.fix_paid.blacklist, 1);

  const anaSayfa = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  esit('ana sayfa: iki tarama isteği de kaynak gönderiyor', (anaSayfa.match(/kaynak: window\.clKaynak \? window\.clKaynak\(\) : ''/g) || []).length, 2);
  esit('ana sayfa: onay anahtarı sürümlü', /cookie: 'cookieConsent2'/.test(anaSayfa), true);
  esit('ödeme sayfası: gizli alan', /name="kaynak" id="kaynakInput"/.test(fs.readFileSync(path.join(__dirname, '..', 'odeme.html'), 'utf8')), true);

  if (hatalar.length) { console.error('Huni sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
  console.log('Huni sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (e) { console.error('sınama çöktü:', e && e.stack || e); process.exit(1); });
