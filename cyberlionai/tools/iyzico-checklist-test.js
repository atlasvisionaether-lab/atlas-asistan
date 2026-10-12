'use strict';

/**
 * Ödeme kontrol listesi ↔ kod ↔ doğrulama betiği. Ağ gerektirmez.
 *
 *   node tools/iyzico-checklist-test.js
 *
 * NEDEN VAR
 *
 * `tools/iyzico-verify.js` ÜRETİMDEKİ ucun kapılarını ölçüyor ve bunu hata
 * KODLARINI bekleyerek yapıyor (`declaration_required`, `agreements_required`,
 * `checkout_unconfigured`, …). Bir kod yeniden adlandırılırsa doğrulama
 * betiği yanlış yerde "KALDI" der: uç doğru çalışıyor olmasına rağmen
 * ölçüm bozulmuş olur — ve bunu yalnızca canlı koşuda, yanlış teşhisle
 * görürdük.
 *
 * Aynı risk kontrol listesinde de var: `docs/iyzico-sandbox.md` env
 * değişkenlerinin adlarını yazıyor. Kod başka bir ad okumaya başlarsa
 * belgedeki liste sessizce yanlış olur ve "anahtarları gir" adımı eksik
 * değişkenle tamamlanmış sanılır.
 *
 * Burada kilitlenenler:
 *
 *   1. Doğrulama betiğinin beklediği her hata kodu uçların kaynağında var.
 *   2. Kodun okuduğu her `IYZICO_*` değişkeni belgede yazılı (ve tersi).
 *   3. Plan oluşturma betiği fiyatı `plans.js`'ten okuyor, sabit yazmıyor.
 *   4. Onay kapıları: betikler CONFIRM olmadan çağrı yapmıyor, canlı taban
 *      adreste duruyor.
 *   5. Belgede kart numarası YOK (ezberden numara yazmamak bilinçli karar).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const KOK = path.join(__dirname, '..');
const oku = function (p) { return fs.readFileSync(path.join(KOK, p), 'utf8'); };

let gecti = 0;
let kalan = 0;
function dene(ad, fn) {
  try {
    fn();
    gecti++;
    process.stdout.write('  ' + YESIL + 'GEÇTİ' + SIFIRLA + '  ' + ad + '\n');
  } catch (e) {
    kalan++;
    process.stdout.write('  ' + KIRMIZI + 'KALDI' + SIFIRLA + '  ' + ad + ' — ' + e.message + '\n');
  }
}

const CHECKOUT = oku('api/checkout.js');
const RETURN = oku('api/checkout-return.js');
const WEBHOOK = oku('api/webhooks/iyzico.js');
const LIB = oku('api/_lib/iyzico.js');
const VERIFY = oku('tools/iyzico-verify.js');
const SETUP = oku('tools/iyzico-plan-setup.js');
const DOC = oku('docs/iyzico-sandbox.md');
const UCLAR = CHECKOUT + RETURN + WEBHOOK;

/* ------------------------------------- 1. Beklenen hata kodları gerçek mi */
process.stdout.write(KALIN + 'Doğrulama betiğinin beklediği kodlar uçlarda var' + SIFIRLA + '\n');

/* Betiğin metninde geçen kodlar DEĞİL, karşılaştırdığı kodlar: tek tırnaklı
   dizgelerden süzülüyor ve bilinen kod adlarıyla sınırlanıyor. */
const BEKLENEN = ['missing_plan', 'invalid_plan', 'declaration_required',
  'agreements_required', 'auth_required', 'checkout_unconfigured', 'method_not_allowed'];

BEKLENEN.forEach(function (k) {
  dene('"' + k + '" hem doğrulama betiğinde hem uçlarda', function () {
    assert.ok(VERIFY.indexOf(k) !== -1, 'doğrulama betiği bu kodu ölçmüyor');
    assert.ok(UCLAR.indexOf(k) !== -1,
      'uçlarda böyle bir kod yok — kod yeniden adlandırıldıysa doğrulama betiği yanlış yerde KALDI der');
  });
});

dene('yönlendirme hedefleri uçlarla aynı', function () {
  ['/panel?checkout=', '/pricing?checkout=unavailable'].forEach(function (yol) {
    assert.ok(CHECKOUT.indexOf(yol) !== -1, yol + ' uçta yok');
  });
  assert.ok(/\/panel\\\?checkout=pro/.test(VERIFY) || VERIFY.indexOf('/panel?checkout=pro') !== -1,
    'doğrulama betiği giriş yönlendirmesini ölçmüyor');
  assert.ok(RETURN.indexOf("'/panel?checkout='") !== -1, 'dönüş ucu panele yönlendirmiyor');
});

dene('webhook imzasız isteği reddediyor (ölçülen 401 gerçek)', function () {
  assert.ok(/401/.test(WEBHOOK), 'webhook 401 dönmüyor');
  assert.ok(/X-Iyz-Signature-V3/i.test(WEBHOOK + LIB), 'imza başlığı adı kodda yok');
  assert.ok(/X-Iyz-Signature-V3/i.test(VERIFY), 'doğrulama betiği imza başlığını denemiyor');
});

/* ------------------------------------------- 2. Env değişkenleri ↔ belge */
process.stdout.write(KALIN + 'Kodun okuduğu her IYZICO_* değişkeni belgede yazılı' + SIFIRLA + '\n');

const KODDAKI = Array.from(new Set(
  (CHECKOUT + LIB + RETURN + WEBHOOK).match(/IYZICO_[A-Z_]+/g) || []
)).sort();

dene('koddan en az beş IYZICO_* değişkeni okundu (okuma çalışıyor)', function () {
  assert.ok(KODDAKI.length >= 5, 'yalnızca ' + KODDAKI.length + ' değişken okundu: ' + KODDAKI.join(', '));
});

KODDAKI.forEach(function (ad) {
  dene('belgede "' + ad + '" geçiyor', function () {
    assert.ok(DOC.indexOf(ad) !== -1,
      'kod bu değişkeni okuyor ama kontrol listesinde yok — eksik girilip tamam sanılır');
  });
});

dene('belgedeki her IYZICO_* değişkeni kodda da okunuyor', function () {
  const belgedeki = Array.from(new Set(DOC.match(/IYZICO_[A-Z_]+/g) || []));
  belgedeki.forEach(function (ad) {
    assert.ok(KODDAKI.indexOf(ad) !== -1,
      ad + ' belgede var ama kod onu okumuyor — var olmayan bir değişkeni girmek istemiş oluruz');
  });
});

dene('SITE_URL ve kill switch davranışı belgede', function () {
  assert.ok(/SITE_URL/.test(DOC) && /SITE_URL/.test(CHECKOUT), 'dönüş adresi kaynağı yazılı değil');
  assert.ok(/kill switch/i.test(DOC), 'kill switch belgede yok');
  assert.ok(/MIN_KEY_LENGTH/.test(LIB) && /20 karakter/.test(DOC),
    'kısa anahtarın yapılandırılmamış sayıldığı belgede yazılı değil');
});

/* ------------------------------------------------ 3. Fiyat tek kaynaktan */
process.stdout.write(KALIN + 'Plan oluşturma fiyatı plans.js’ten okuyor' + SIFIRLA + '\n');

dene('kurulum betiğinde sabit fiyat yok', function () {
  assert.ok(/PLANS\[p\.id\]\.priceTry/.test(SETUP), 'fiyat plans.js’ten okunmuyor');
  /* Betiğin kendi metninde 299/2499 geçmemeli: sabit yazılan fiyat,
     sözleşmedeki fiyatla ayrışmanın yolu. Yorumlar da dahil. */
  assert.ok(!/\b(299|2499)\b/.test(SETUP),
    'betikte sabit fiyat geçiyor — plans.js tek kaynak olmalı');
});

dene('belgedeki fiyatlar plans.js ile aynı', function () {
  const { PLANS } = require(path.join(KOK, 'api', '_lib', 'plans.js'));
  assert.ok(DOC.indexOf(String(PLANS.pro.priceTry)) !== -1, 'Pro fiyatı belgede yok');
  assert.ok(DOC.indexOf(String(PLANS.enterprise.priceTry)) !== -1, 'Enterprise fiyatı belgede yok');
  assert.ok(/KDV hariç/.test(DOC), 'fiyatın KDV hariç olduğu yazılı değil');
});

/* ---------------------------------------------------- 4. Onay kapıları */
process.stdout.write(KALIN + 'Betikler onaysız yazmıyor' + SIFIRLA + '\n');

dene('kurulum betiği CONFIRM olmadan çağrı yapmıyor', function () {
  assert.ok(/CONFIRM !== 'evet'/.test(SETUP), 'onay kapısı yok');
  const onayIndex = SETUP.indexOf("ONAY YOK");
  const ilkCagri = SETUP.indexOf('iyzico.createProduct');
  assert.ok(onayIndex !== -1 && ilkCagri !== -1 && onayIndex < ilkCagri,
    'onay kontrolü ilk çağrıdan sonra geliyor');
});

dene('kurulum betiği canlı taban adreste duruyor', function () {
  assert.ok(/evet-canli/.test(SETUP), 'canlı için ayrı onay yok');
  assert.ok(/environmentName\(\)/.test(SETUP), 'ortam adı okunmuyor');
});

dene('doğrulama betiği hiçbir şey yazmıyor', function () {
  /* Ölçüm yalnızca kapıları okuyor: abonelik başlatan çağrı (declaration +
     agreements + oturum) yapılamaz çünkü oturum açmıyor. */
  assert.ok(!/auth\/login|signup|admin\/users/.test(VERIFY),
    'doğrulama betiği oturum açıyor ya da hesap oluşturuyor');
  assert.ok(/redirect: 'manual'/.test(VERIFY), 'yönlendirme takip ediliyor');
});

dene('anahtar sızıntısı ölçülüyor', function () {
  assert.ok(/anahtar\/adres\/referans sızdırmıyor/.test(VERIFY),
    'durum cevabının sır sızdırıp sızdırmadığı ölçülmüyor');
  /* ?mode cevabı yalnızca bu üç alanı dönüyor. */
  const mode = CHECKOUT.slice(CHECKOUT.indexOf('req.query.mode'), CHECKOUT.indexOf('const planId'));
  assert.ok(/enabled/.test(mode) && /testMode/.test(mode) && /plans/.test(mode), 'durum cevabı değişmiş');
  assert.ok(!/apiKey|secretKey|baseUrl|pricingPlanRef\(.*\)\s*\}/.test(mode),
    'durum cevabı anahtar ya da referans döndürüyor');
});

/* --------------------------------------------------------- 5. Belge */
process.stdout.write(KALIN + 'Kontrol listesi dürüst' + SIFIRLA + '\n');

dene('belgede kart numarası yok', function () {
  /* Sandbox test kartı numarası ezberden YAZILMADI: yanlış numarayı belgeye
     sabitlemek olurdu. Belge sandbox panelindeki listeye yönlendiriyor. */
  assert.ok(!/\b\d{13,19}\b/.test(DOC), 'belgede kart numarası görünüyor');
  assert.ok(/sandbox panelindeki/.test(DOC), 'test kartının nereden alınacağı yazılı değil');
});

dene('belge iki betiği ve elle adımı birlikte yazıyor', function () {
  ['tools/iyzico-plan-setup.js', 'tools/iyzico-verify.js'].forEach(function (b) {
    assert.ok(DOC.indexOf(b) !== -1, b + ' belgede yok');
    assert.ok(fs.existsSync(path.join(KOK, b)), b + ' dosyası yok');
  });
  assert.ok(/ELLE|elle/.test(DOC), 'ölçülemeyen adım belirtilmemiş');
  assert.ok(/cl_subscriptions/.test(DOC), 'son adımda neyin kontrol edileceği yazılı değil');
});

dene('bilinen eksikler belgede ve kodda aynı', function () {
  assert.ok(/TC kimlik/.test(DOC) && /TC kimlik/.test(CHECKOUT),
    'müşteri kaydı eksiği belgede yok');
  assert.ok(/50 tarama/.test(DOC), 'Pro kota sınırının zorlanmadığı yazılı değil');
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
