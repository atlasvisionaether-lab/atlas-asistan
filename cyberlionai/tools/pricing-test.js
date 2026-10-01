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
 *   4. Ödeme ucu yalnızca Stripe alan adlarına yönlendiriyor ve
 *      yapılandırılmamışsa bağlantı UYDURMUYOR. Açık yönlendirme bir güvenlik
 *      ürününün kendi sitesinde hiç olmamalı.
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

/* ---- 4. Ödeme ucu ---- */
const ENV_KEYS = ['STRIPE_PAYMENT_LINK_PRO', 'STRIPE_PAYMENT_LINK_ENTERPRISE'];
ENV_KEYS.forEach(function (k) { delete process.env[k]; });

const checkout = require('../api/checkout.js');

sina('yapılandırılmamışsa bağlantı uydurulmuyor',
  checkout.checkoutUrl('pro'), { ok: false, reason: 'checkout_unconfigured' });

process.env.STRIPE_PAYMENT_LINK_PRO = 'https://buy.stripe.com/test/abc123';
sina('Stripe test bağlantısı kabul ediliyor',
  checkout.checkoutUrl('pro'), { ok: true, url: 'https://buy.stripe.com/test/abc123' });
sina('test bağlantısı test modu olarak tanınıyor',
  checkout.isTestLink('https://buy.stripe.com/test/abc123'), true);
sina('canlı bağlantı test modu sayılmıyor',
  checkout.isTestLink('https://buy.stripe.com/abc123'), false);

/* Açık yönlendirme: Stripe dışı bir host yönlendirme hedefi OLAMAZ. */
process.env.STRIPE_PAYMENT_LINK_PRO = 'https://kotu-site.example/odeme';
sina('Stripe dışı host reddediliyor',
  checkout.checkoutUrl('pro'), { ok: false, reason: 'checkout_misconfigured' });

process.env.STRIPE_PAYMENT_LINK_PRO = 'http://buy.stripe.com/test/abc123';
sina('http (şifresiz) reddediliyor',
  checkout.checkoutUrl('pro'), { ok: false, reason: 'checkout_misconfigured' });

/* Alan adı sonuna Stripe eklenmiş bir host da Stripe değil. */
process.env.STRIPE_PAYMENT_LINK_PRO = 'https://buy.stripe.com.kotu.example/odeme';
sina('benzer görünen host reddediliyor',
  checkout.checkoutUrl('pro'), { ok: false, reason: 'checkout_misconfigured' });

process.env.STRIPE_PAYMENT_LINK_PRO = 'bu bir adres degil';
sina('ayrıştırılamayan değer reddediliyor',
  checkout.checkoutUrl('pro'), { ok: false, reason: 'checkout_misconfigured' });

sina('free planın ödeme bağlantısı yok',
  checkout.checkoutUrl('free'), { ok: false, reason: 'unknown_plan' });
sina('bilinmeyen plan reddediliyor',
  checkout.checkoutUrl('kurumsal-plus'), { ok: false, reason: 'unknown_plan' });

/* Tarayıcı gezinmesi ile makine isteği ayırt ediliyor: ilkine HTML sayfası,
   ikincisine JSON dönüyor. */
sina('tarayıcı isteği HTML istiyor sayılıyor',
  checkout.wantsHtml({ headers: { accept: 'text/html,application/xhtml+xml' } }), true);
sina('JSON isteği HTML istemiyor',
  checkout.wantsHtml({ headers: { accept: 'application/json' } }), false);
sina('Accept başlığı yoksa JSON', checkout.wantsHtml({ headers: {} }), false);

console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
process.exit(hata === 0 ? 0 : 1);
