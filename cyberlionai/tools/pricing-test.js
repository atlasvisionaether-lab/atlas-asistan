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

console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
process.exit(hata === 0 ? 0 : 1);
