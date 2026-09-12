'use strict';
/**
 * Çapraz köken kontrollerinin (COOP, COEP, CORP, CORS, SRI) sınaması.
 * Ağdan bağımsız; `buildChecks` doğrudan çağrılıyor.
 *
 *   node tools/crossorigin-test.js
 *
 * TASARIM KARARI — ÖLÇÜLDÜ (koşu 34663226505)
 *
 * Observatory bu başlıkların YOKLUĞUNU başarısızlık saymıyor:
 *   coop-not-implemented                          pass=true   m=0
 *   coep-not-implemented                          pass=true   m=0
 *   corp-not-implemented                          pass=null   m=0
 *   cross-origin-resource-sharing-not-implemented pass=true   m=0
 *   sri-not-implemented-but-no-scripts-loaded     pass=null   m=0
 *
 * Bunlar derinlemesine savunma; yokluğu kusur değil. Yoklukta "fail" versek
 * hemen her siteyle çelişirdik ve haksız olurduk. Bu yüzden yokluk `skipped`,
 * yalnızca BİLEREK zayıflatılmış değer `fail`. Ağırlık `info` (0) — mevcut
 * müşterilerin skoru bu eklemeyle kaymıyor.
 *
 * Sınama üç yönü de kapsıyor: güçlü geçmeli, zayıf yakalanmalı, YOKLUK ne
 * geçmeli ne kalmalı. Son madde en önemlisi — yanlış alarm burada yalnızca
 * gürültü değil, Observatory ile sahte bir mutabakatsızlık üretirdi.
 */

const path = require('path');
const { buildChecks, scoreOf } = require(path.join(__dirname, '..', 'api', '_lib', 'scanner.js'));

const YESIL = '\x1b[32m', KIRMIZI = '\x1b[31m', KALIN = '\x1b[1m', BITIR = '\x1b[0m';
let gecen = 0, kalan = 0;

function ctx(hdr, html) {
  return {
    headers: new Headers(hdr || {}),
    finalUrl: new URL('https://ornek.test/'),
    html: html === undefined ? '<html></html>' : html,
    tls: null, legacy: null
  };
}

function sina(ad, hdr, html, beklenen) {
  const cikan = {};
  buildChecks(ctx(hdr, html)).forEach(function (c) {
    if (Object.prototype.hasOwnProperty.call(beklenen, c.id)) cikan[c.id] = c.status;
  });
  const a = JSON.stringify(beklenen), b = JSON.stringify(cikan);
  if (a === b) { console.log('  ' + YESIL + 'GEÇTİ' + BITIR + '  ' + ad); gecen++; }
  else { console.log('  ' + KIRMIZI + 'KALDI' + BITIR + '  ' + ad + '\n    beklenen ' + a + '\n    çıkan    ' + b); kalan++; }
}

console.log(KALIN + 'Yokluk cezalandırılmamalı (Observatory ile aynı duruş)' + BITIR);
sina('hiçbiri yok', {}, '<html></html>',
  { coop: 'skipped', coep: 'skipped', corp: 'skipped', cors: 'skipped', sri: 'skipped' });

console.log(KALIN + 'Güçlü yapılandırma geçmeli' + BITIR);
sina('COOP same-origin', { 'cross-origin-opener-policy': 'same-origin' }, undefined, { coop: 'pass' });
sina('COOP same-origin-allow-popups', { 'cross-origin-opener-policy': 'same-origin-allow-popups' }, undefined, { coop: 'pass' });
sina('COEP require-corp', { 'cross-origin-embedder-policy': 'require-corp' }, undefined, { coep: 'pass' });
sina('CORP same-origin', { 'cross-origin-resource-policy': 'same-origin' }, undefined, { corp: 'pass' });
sina('CORS belirli köken', { 'access-control-allow-origin': 'https://dost.test' }, undefined, { cors: 'pass' });

console.log(KALIN + 'Bilerek zayıflatılan yakalanmalı' + BITIR);
sina('COOP unsafe-none', { 'cross-origin-opener-policy': 'unsafe-none' }, undefined, { coop: 'fail' });
sina('COEP unsafe-none', { 'cross-origin-embedder-policy': 'unsafe-none' }, undefined, { coep: 'fail' });
sina('CORP geçersiz değer', { 'cross-origin-resource-policy': 'bogus-value' }, undefined, { corp: 'fail' });

console.log(KALIN + 'CORS: joker tek başına kusur değil, kimlikle birlikte kusur' + BITIR);
sina('ACAO * (kimliksiz)', { 'access-control-allow-origin': '*' }, undefined, { cors: 'pass' });
sina('ACAO * + credentials',
  { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' },
  undefined, { cors: 'fail' });

console.log(KALIN + 'SRI: yalnızca DIŞ kökenli script için anlamlı' + BITIR);
sina('dış script, bütünlüksüz', {}, '<script src="https://cdn.baska.test/a.js"></script>', { sri: 'fail' });
sina('dış script, bütünlüklü', {}, '<script src="https://cdn.baska.test/a.js" integrity="sha384-x"></script>', { sri: 'pass' });
sina('karışık: biri eksik', {},
  '<script src="https://a.test/1.js" integrity="sha384-x"></script><script src="https://b.test/2.js"></script>',
  { sri: 'fail' });
sina('kendi kökeninden', {}, '<script src="/kendi.js"></script>', { sri: 'skipped' });
sina('göreli yol', {}, '<script src="js/kendi.js"></script>', { sri: 'skipped' });
sina('HTML okunamadı', {}, null, { sri: 'skipped' });

console.log('\n' + KALIN + 'Ağırlık: bu kontroller skoru kaydırmamalı' + BITIR);
const temel = scoreOf(buildChecks(ctx({}, '<html></html>')));
const zayif = scoreOf(buildChecks(ctx({
  'cross-origin-opener-policy': 'unsafe-none',
  'cross-origin-embedder-policy': 'unsafe-none',
  'cross-origin-resource-policy': 'bogus-value'
}, '<html></html>')));
if (temel === zayif) {
  console.log('  ' + YESIL + 'GEÇTİ' + BITIR + '  üçü de başarısızken skor değişmiyor (' + temel + ')');
  gecen++;
} else {
  console.log('  ' + KIRMIZI + 'KALDI' + BITIR + '  skor kaydı: ' + temel + ' → ' + zayif);
  kalan++;
}

console.log('\nGeçen: ' + gecen + '   Kalan: ' + kalan);
process.exit(kalan ? 1 : 0);
