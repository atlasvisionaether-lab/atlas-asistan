'use strict';

/**
 * iyzico ödeme logolarının yerinde olduğunu kilitler. Ağ gerektirmez.
 *
 *   node tools/iyzico-logo-test.js
 *
 * NEDEN VAR
 *
 * iyzico canlı başvurusunda "eksik belge" olarak Visa ve Mastercard
 * logolarının sitede GÖRÜNMESİNİ istedi. Bu bir pazarlama tercihi değil,
 * başvurunun kabul şartı: logo düşerse başvuru yeniden eksik duruma düşer.
 *
 * Bir arayüz düzenlemesi `<img>` satırını sessizce silebilir ya da dosya adı
 * değişince görsel 404 verebilir; ikisi de ekranda "kırık görsel" bırakır ve
 * kimse fark etmez. Bu sınama üç şeyi tutuyor:
 *
 *   1. Logo dosyaları depoda VAR ve gerçekten SVG.
 *   2. Üç ödeme yüzeyi (ana sayfa altbilgisi, /pricing, /odeme) bu dosyaları
 *      GERÇEKTEN gösteriyor ve her `<img>` boş olmayan bir `alt` taşıyor.
 *   3. Gösterilen her yol depoda bir dosyaya çıkıyor (404 yok).
 *
 * ÖLÇÜLEN GERÇEK (marka kiti, 13.10.2026): pakette AYRI bir Visa ya da
 * Mastercard dosyası YOK. iyzico bunları tek bir "logo bandı" içinde
 * veriyor (footer_iyzico_ile_ode) — bant iyzico ile Öde + Mastercard + Visa
 * + American Express + troy taşıyor. Bu yüzden Visa/Mastercard görünürlüğü
 * bandın kendisiyle sağlanıyor; ayrı dosya aramak yanlış olurdu.
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

/* Marka kitinden seçilen dosyalar. Bant, kart şemalarını taşıyan tek dosya. */
const BANT = 'images/iyzico/logo-band-white.svg';
const ODE = 'images/iyzico/iyzico-ile-ode-white.svg';

/* iyzico'nun görmek istediği üç yüzey. `odeme.html` ödemenin BAŞLADIĞI sayfa;
   `checkout.html` ön kayıt formu (ödeme yok), o yüzden listede değil. */
const YUZEYLER = ['index.html', 'pricing.html', 'odeme.html'];

/* ------------------------------------------------------- 1. Dosyalar */
process.stdout.write(KALIN + 'Logo dosyaları depoda ve geçerli SVG' + SIFIRLA + '\n');

[BANT, ODE].forEach(function (rel) {
  dene(rel + ' var ve boş değil', function () {
    const tam = path.join(KOK, rel);
    assert.ok(fs.existsSync(tam), 'dosya yok');
    assert.ok(fs.statSync(tam).size > 1000, 'dosya şüpheli küçük');
  });
  dene(rel + ' gerçekten SVG (ve betik içermiyor)', function () {
    const metin = oku(rel);
    assert.ok(/<svg[\s>]/i.test(metin), 'SVG kök etiketi yok');
    assert.ok(/viewBox=/i.test(metin), 'viewBox yok — ölçeklenmez');
    /* Satır içi betik ya da dış kaynak, CSP açısından yeni bir yüzey olurdu. */
    assert.ok(!/<script/i.test(metin), 'SVG içinde <script> var');
    assert.ok(!/href="https?:/i.test(metin), 'SVG dışarıdan kaynak çekiyor');
  });
});

dene('bant Visa ve Mastercard’ı taşıyor (kart şemaları bandın içinde)', function () {
  /* Pakette ayrı Visa/Mastercard dosyası yok; bandın içinde çiziliyorlar.
     Dosyanın yanlışlıkla "yalnızca iyzico" sürümüyle değiştirilmediğini
     ölçmek için bant boyutuna ve viewBox genişliğine bakılıyor: kart
     şemalarını taşıyan bant geniştir (456×32). */
  const metin = oku(BANT);
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(metin);
  assert.ok(m, 'viewBox okunamadı');
  assert.ok(Number(m[1]) >= 400,
    'bant daralmış (' + m[1] + 'px) — kart şemaları olmayan bir dosyayla değişmiş olabilir');
  assert.ok(oku(BANT).length > 20000, 'bant dosyası küçülmüş; şemalar düşmüş olabilir');
});

/* --------------------------------------------------- 2. Üç ödeme yüzeyi */
process.stdout.write(KALIN + 'Üç ödeme yüzeyi logoyu gerçekten gösteriyor' + SIFIRLA + '\n');

YUZEYLER.forEach(function (sayfa) {
  const html = oku(sayfa);

  dene(sayfa + ': iyzico bandı gösteriliyor', function () {
    assert.ok(html.indexOf('/' + BANT) !== -1,
      'bant <img> ile gösterilmiyor — iyzico başvurusu bunu şart koşuyor');
  });

  dene(sayfa + ': bandın alt metni boş değil', function () {
    /* Her bant img’inin alt’ı dolu olmalı: ekran okuyucu "görsel" demesin. */
    const re = new RegExp('<img[^>]*' + BANT.replace(/[/.]/g, '\\$&') + '[^>]*>', 'g');
    const etiketler = html.match(re) || [];
    assert.ok(etiketler.length > 0, 'img etiketi bulunamadı');
    etiketler.forEach(function (etiket) {
      /* `data-i18n-alt="..."` da `alt="` ile bitiyor: ilk sürüm onu gerçek alt
         sandı ve doğru işaretlemeyi KALDI gösterdi. Önce i18n öznitelikleri
         ayıklanıyor, sonra gerçek alt okunuyor. */
      const sade = etiket.replace(/data-(i18n|t)-alt(-[a-z]{2})?="[^"]*"/g, ' ');
      const alt = /\salt="([^"]*)"/.exec(sade);
      assert.ok(alt && alt[1].trim().length > 10, 'alt metni yok ya da çok kısa: ' + etiket.slice(0, 80));
      assert.ok(/visa/i.test(alt[1]) && /master/i.test(alt[1]),
        'alt metni kabul edilen kartları saymıyor: ' + alt[1]);
    });
  });

  dene(sayfa + ': logo bağlantı DEĞİL (yalnızca görsel)', function () {
    /* iyzico görünürlük istiyor; tıklanınca başka siteye giden bir logo
       istemiyoruz. Bandın <a> içine alınmadığını sınıyoruz. */
    const i = html.indexOf('/' + BANT);
    const once = html.slice(Math.max(0, i - 220), i);
    assert.ok(!/<a\s[^>]*$/i.test(once), 'bant bir bağlantının içine konmuş');
  });
});

dene('index.html: dil değişince alt metni de çevriliyor', function () {
  /* Bant `data-i18n-alt` taşıyorsa, sözlükteki karşılığı İKİ dilde de kart
     şemalarını saymalı: dil değişiminde alt metni "ile Öde"ye düşerse ekran
     okuyucu kabul edilen kartları söylemez. */
  const html = oku('index.html');
  const m = /data-i18n-alt="([^"]+)"/.exec(html);
  assert.ok(m, 'bant data-i18n-alt taşımıyor');
  const anahtar = m[1].split('.').pop();
  const degerler = html.match(new RegExp(anahtar + ": '([^']+)'", 'g')) || [];
  assert.strictEqual(degerler.length, 2, anahtar + ' iki dilde değil (' + degerler.length + ')');
  degerler.forEach(function (d) {
    assert.ok(/visa/i.test(d) && /master/i.test(d), 'alt sözlüğü kartları saymıyor: ' + d);
  });
  assert.ok(/\[data-i18n-alt\]/.test(html), 'data-i18n-alt döngüsü yok — öznitelik hiç uygulanmıyor');
});

dene('odeme.html ödeme düğmesinin yanında "iyzico ile Öde" logosu var', function () {
  const html = oku('odeme.html');
  assert.ok(html.indexOf('/' + ODE) !== -1, 'resmî "iyzico ile Öde" logosu yok');
  assert.ok(!/iyz__mark/.test(html), 'eski metin rozeti geri gelmiş (logo yerine yazı)');
});

dene('metin rozeti hiçbir sayfada kalmadı', function () {
  /* Önceki geçici çözüm, logo gelene kadar "iyzico" yazısını kutuya koyuyordu.
     Resmî logo geldiğine göre o rozetin geri gelmemesi gerekiyor —
     render-legal-md.js şablonu dahil. */
  const dosyalar = fs.readdirSync(KOK).filter(function (f) { return /\.html$/.test(f); })
    .concat(['tools/render-legal-md.js']);
  dosyalar.forEach(function (f) {
    assert.ok(oku(f).indexOf('iyz__mark') === -1, f + ' içinde eski metin rozeti var');
  });
});

/* ------------------------------------------------ 3. Yol → dosya (404 yok) */
process.stdout.write(KALIN + 'Gösterilen her yol bir dosyaya çıkıyor' + SIFIRLA + '\n');

dene('sayfalardaki /images/iyzico/ yolları depoda var', function () {
  const yollar = [];
  fs.readdirSync(KOK).filter(function (f) { return /\.html$/.test(f); }).forEach(function (f) {
    (oku(f).match(/\/images\/iyzico\/[A-Za-z0-9._-]+/g) || []).forEach(function (y) {
      if (yollar.indexOf(y) === -1) yollar.push(y);
    });
  });
  assert.ok(yollar.length >= 2, 'yalnızca ' + yollar.length + ' yol okundu');
  yollar.forEach(function (y) {
    assert.ok(fs.existsSync(path.join(KOK, y.replace(/^\//, ''))), '404 verecek yol: ' + y);
  });
});

dene('CSP yeni bir görsel kaynağı gerektirmiyor', function () {
  /* Logolar kendi alan adımızdan servis ediliyor; img-src 'self' yetiyor.
     Bir gün CDN’den çekilirse bu sınama o değişikliği görünür kılar. */
  const vercel = JSON.parse(oku('vercel.json'));
  const csp = vercel.headers
    .map(function (h) { return (h.headers || []).filter(function (x) { return x.key === 'Content-Security-Policy'; })[0]; })
    .filter(Boolean)[0];
  assert.ok(csp, 'CSP başlığı yok');
  const img = csp.value.split(';').map(function (s) { return s.trim(); })
    .filter(function (s) { return s.indexOf('img-src') === 0; })[0];
  assert.ok(img, 'img-src yok');
  assert.ok(img.indexOf("'self'") !== -1, "img-src 'self' içermiyor");
  assert.ok(!/https?:/.test(img), 'img-src dışarıya açılmış: ' + img);
});

dene('zip paketi depoya girmemiş', function () {
  const zipler = fs.readdirSync(path.join(KOK, 'images', 'iyzico'));
  zipler.forEach(function (f) {
    assert.ok(!/\.zip$/i.test(f), 'logo paketi zip’i depoda: ' + f);
  });
  assert.ok(zipler.length <= 4, 'images/iyzico şişmiş: ' + zipler.join(', '));
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
