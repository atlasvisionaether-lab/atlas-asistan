'use strict';

/**
 * Güven Damgası ön kontrolü sınaması (api/_lib/trustcheck.js). Ağ yok.
 * Sabitlenen: yalnızca AYNI sitedeki bağlantılar sayılır; eksik unsur 'fail';
 * bağlantı var ama sayfa açılmıyorsa 'warn'; üçüncü taraf betik varken çerez
 * onayı yoksa 'fail'; bilinen CMP onay sayılır.
 */
const path = require('node:path');
const Module = require('node:module');
const API = path.join(__dirname, '..', 'api');
let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (b === e) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }
function sapla(rel, govde) { const tam = require.resolve(path.join(API, rel)); const m = new Module(tam, null); m.filename = tam; m.loaded = true; m.exports = govde; require.cache[tam] = m; }

const sayfalar = {};
sapla('_lib/ownership.js', { safeGet: async function (url) { return Object.prototype.hasOwnProperty.call(sayfalar, url) ? sayfalar[url] : null; } });
const trust = require(path.join(API, '_lib', 'trustcheck.js'));

const EKSIK = '<html><body><a href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</a>'
  + '<a href="https://baska-site.com/kvkk">KVKK</a><a href="/gizlilik">Gizlilik</a>'
  + '<script src="https://www.googletagmanager.com/gtm.js"></script><script src="/app.js"></script>'
  + '<p>Bize yazın: info@magaza.com</p></body></html>';

(async function () {
  const a = trust.analyzeHome(EKSIK, 'www.magaza.com');
  esit('aynı site bağlantısı bulunur', a.pages.distance_sales, 'https://www.magaza.com/mesafeli-satis');
  esit('başka siteye KVKK bağlantısı sayılmaz', a.pages.kvkk_notice, null);
  esit('e-posta bulundu', a.contact.email, true);
  esit('telefon yok', a.contact.phone, false);
  esit('VKN yok', a.contact.taxId, false);
  esit('üçüncü taraf betik', a.cookies.thirdPartyScripts.join(), 'www.googletagmanager.com');
  esit('onay bildirimi yok', a.cookies.consentBanner, false);

  sayfalar['https://www.magaza.com/'] = EKSIK;
  sayfalar['https://www.magaza.com/mesafeli-satis'] = '<html>sözleşme</html>';
  const r = await trust.run('www.magaza.com');
  const durum = {}; r.items.forEach(function (i) { durum[i.id] = i.status; });
  esit('sözleşme açılıyor → pass', durum.distance_sales, 'pass');
  esit('gizlilik bağlantısı var ama açılmıyor → warn', durum.privacy, 'warn');
  esit('ön bilgilendirme yok → fail', durum.pre_information, 'fail');
  esit('3. taraf varken onay yok → fail', durum.cookie_banner, 'fail');
  esit('özet sayısı', r.summary.pass, 3);

  const cmp = trust.analyzeHome('<script src="https://consent.cookiebot.com/uc.js"></script>', 'x.com');
  esit('bilinen CMP onay sayılır', cmp.cookies.consentBanner, true);
  const tr = trust.analyzeHome('<p>Satıcı: Ali Veli, Cevizli Mahallesi Zuhal Caddesi No:4, VKN: 5810910912, Tel: 0534 468 27 69</p>', 'x.com');
  esit('adres', tr.contact.address, true);
  esit('VKN', tr.contact.taxId, true);
  esit('telefon', tr.contact.phone, true);
  esit('ulaşılamayan site', (await trust.run('yok.com')).code, 'unreachable');

  if (hatalar.length) { console.error('Güven damgası sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
  console.log('Güven damgası sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (e) { console.error('sınama çöktü:', e && e.stack || e); process.exit(1); });
