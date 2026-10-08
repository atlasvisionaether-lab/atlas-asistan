'use strict';
/**
 * Fiyat tutarlılığını ve ödeme ucunu sınar. Ağdan bağımsız.
 *
 *   node tools/pricing-test.js
 *
 * NEDEN
 *
 * Fiyat sayfasında yazan şey bir TAAHHÜT. Aynı plan üç yerde görünüyor (ana
 * sayfanın tablosu, /pricing, SSS cevabı) ve bunlar elle yazılırken bir kez
 * ayrıştı: ana sayfa Pro için "SINIRSIZ Tarama" diyordu, oysa sınırsız olan
 * Enterprise'dı. Müşteriye iki farklı söz vermek, yanlış fiyat yazmaktan
 * daha sinsi bir hata, çünkü kimse fark etmiyor.
 *
 * Sınananlar:
 *
 *   1. Fiyatlar api/_lib/plans.js ile AYNI: HTML'de ₺299 ve ₺2.499, iki
 *      sayfada ve iki dilde.
 *   2. Yasaklı ifade hiçbir yerde yok: "Tam Otomatik Düzeltme". Doğrusu
 *      "Cloudflare ile 1-Tık Düzeltme (kendi token'ınızla)" ve bu, ürünün
 *      gerçekte yaptığı şey.
 *   3. Pro "sınırsız" demiyor: sınırsız olan plan Enterprise.
 *   4. Satış sayfasındaki ödeme sağlayıcısının adı doğru: ödeme iyzico
 *      üzerinden alınıyor (Stripe yolu iptal edildi; TR şahıs şirketinde
 *      canlıya geçmiyor). Ödeme ucunun kendi sınamaları tools/iyzico-test.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pricing = fs.readFileSync(path.join(ROOT, 'pricing.html'), 'utf8');

const { PLANS } = require('../api/_lib/plans.js');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen)
              + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

console.log('Fiyatlandırma tutarlılığı ve ödeme ucu');

/* ---- 1. Fiyatlar tek kaynakla aynı ---- */
[['pro', 'tr'], ['pro', 'en'], ['enterprise', 'tr'], ['enterprise', 'en']].forEach(function (pair) {
  const planId = pair[0], lang = pair[1];
  const fiyat = PLANS[planId][lang].price;
  sina(planId + ' ' + lang + ' fiyatı /pricing sayfasında', pricing.indexOf(fiyat) !== -1, true);
  sina(planId + ' ' + lang + ' fiyatı ana sayfada', index.indexOf(fiyat) !== -1, true);
});

/* Eski Enterprise metni kalmamış olmalı: "Özel Teklif" artık bir fiyat değil. */
sina('ana sayfada "Özel Teklif" kalmadı', /Özel Teklif/.test(index), false);
sina('ana sayfada "Custom" fiyatı kalmadı', /price: 'Custom'/.test(index), false);

/* ---- 2. Yasaklı ifade ----
   Satış yapan iki sayfada bu ifade HİÇ geçmemeli — yorum içinde bile, çünkü
   yorumlar HTML ile birlikte gidiyor ve bir sonraki düzenleyen onu metne
   taşıyabilir. panel.html bilerek dışarıda: orada ifade "bu o değil" diyen
   uyarı cümlesinin parçası. */
[['index.html', index], ['pricing.html', pricing]].forEach(function (pair) {
  sina(pair[0] + ': "Tam Otomatik Düzeltme" hiç geçmiyor',
    /Tam Otomatik Düzeltme/.test(pair[1]), false);
  sina(pair[0] + ': "fully automatic" hiç geçmiyor',
    /fully automatic/i.test(pair[1]), false);
});

/* ---- 3. Pro sınırsız demiyor ---- */
sina('ana sayfada Pro için SINIRSIZ yok', /SINIRSIZ Tarama/.test(index), false);
sina('ana sayfada Pro için "Unlimited Scans" yalnızca Enterprise satırında',
  (index.match(/Unlimited Scans/g) || []).length, 1);
sina('/pricing Pro kartında 50 tarama yazıyor', /Ayda 50 Tarama/.test(pricing), true);

/* ---- 4. Sağlayıcı adı doğru ---- */
sina('/pricing ödemenin iyzico ile alındığını yazıyor', /iyzico/.test(pricing), true);
sina('/pricing artık Stripe demiyor', /Stripe/.test(pricing), false);
sina('ana sayfa Stripe demiyor', /Stripe/.test(index), false);

/* ---- 5. KDV dahil tutarlar ve /odeme ----
   KDV dahil tutar plans.js'te elle yazılı; burada priceTry × (1 + VAT_RATE)
   ile aynı olduğu ve sayfalarda geçtiği sınanıyor. /odeme tutarı tarayıcıda
   odeme.js hesaplıyor; oradaki net fiyat ve oran da aynı olmalı. */
const { VAT_RATE } = require('../api/_lib/plans.js');
const odemeJs = fs.readFileSync(path.join(ROOT, 'odeme.js'), 'utf8');
['pro', 'enterprise'].forEach(function (planId) {
  const p = PLANS[planId];
  const brut = Math.round(p.priceTry * (1 + VAT_RATE) * 100) / 100;
  const trBeklenen = '₺' + brut.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
  sina(planId + ' KDV dahil tutar oranla tutarlı', p.tr.gross, trBeklenen);
  sina(planId + ' KDV dahil tutar ana sayfada (tr)', index.indexOf(p.tr.gross) !== -1, true);
  sina(planId + ' KDV dahil tutar ana sayfada (en)', index.indexOf(p.en.gross) !== -1, true);
  sina(planId + ' KDV dahil tutar /pricing sayfasında', pricing.indexOf(p.tr.gross) !== -1, true);
  sina(planId + ' net fiyat odeme.js ile aynı',
    new RegExp('\\b' + planId + ': ' + p.priceTry + '\\b').test(odemeJs), true);
  sina(planId + ' butonu /odeme sayfasına gidiyor (ana sayfa)',
    index.indexOf('href="/odeme?plan=' + planId + '"') !== -1, true);
  sina(planId + ' butonu /odeme sayfasına gidiyor (/pricing)',
    pricing.indexOf('href="/odeme?plan=' + planId + '"') !== -1, true);
});
sina('odeme.js KDV oranı plans.js ile aynı',
  new RegExp('VAT_RATE = ' + String(VAT_RATE).replace('.', '\\.') + '0?;').test(odemeJs), true);

/* ---- 5b. Ücretsiz hak sayısı = FREE_SCAN_LIMIT ----
   Sayfadaki "N ücretsiz tarama" bir taahhüt; sunucudaki kota ile aynı olmalı.
   Başka bir sayı (eski "5") hiçbir yerde kalmamalı. */
const { FREE_SCAN_LIMIT } = require('../api/_lib/limits.js');
const knowledge = fs.readFileSync(path.join(ROOT, 'data', 'knowledge.json'), 'utf8');
const N = String(FREE_SCAN_LIMIT);
[['ana sayfa', index], ['/pricing', pricing], ['asistan bilgi tabanı', knowledge]].forEach(function (pair) {
  const sayilar = (pair[1].match(/(\d+) (?:ücretsiz tarama|free scans|Güvenlik Taraması|Security Scans|güvenlik taraması|security scans)|ilk (\d+) tarama|first (\d+) scans|Free ₺0 \((\d+) (?:tarama|scans)/g) || [])
    .map(function (m) { return (m.match(/\d+/) || [''])[0]; })
    .filter(function (x) { return x !== '0'; });
  sina(pair[0] + ': ücretsiz hak sayısı her yerde ' + N, sayilar.length > 0 && sayilar.every(function (x) { return x === N; }), true);
});
sina('ana sayfa yapılandırması freeScanLimit = FREE_SCAN_LIMIT', index.indexOf('freeScanLimit: ' + N + ',') !== -1, true);

/* ---- 6. /api/checkout ad soyad bölme ---- */
const { customerName } = require('../api/checkout.js');
sina('ad soyad bölünüyor', customerName('Ali Atlas Kotan', 'a@b.co'), { name: 'Ali Atlas', surname: 'Kotan' });
sina('tek kelime yer tutucuya düşüyor', customerName('Ali', 'ali@b.co'), { name: 'ali', surname: '-' });
sina('harf dışı karakter reddediliyor', customerName('<script> x', 'a@b.co'), { name: 'a', surname: '-' });
sina('ad yoksa yer tutucu', customerName(undefined, 'z@b.co'), { name: 'z', surname: '-' });

console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
process.exit(hata === 0 ? 0 : 1);
