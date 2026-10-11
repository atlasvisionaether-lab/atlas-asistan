'use strict';

/**
 * Veri kataloğu ↔ kod ↔ gizlilik politikası. Ağ gerektirmez.
 *
 *   node tools/data-catalog-test.js
 *
 * NEDEN VAR
 *
 * Gerçek bir tutarsızlıktan doğdu: `api/device-token.js` FCM cihaz jetonunu
 * `cl_device_tokens` tablosunda SAKLIYORDU ama gizlilik politikasında bu
 * veri HİÇ geçmiyordu (ölçüm: 11.10.2026, "cihaz" araması 0 eşleşme).
 * Google Play'in Data Safety formu bu kalemi "Device or other IDs" olarak
 * beyan etmeyi şart koşuyor ve form ile politika ayrışırsa uygulama reddedilir.
 *
 * Buradaki üç kilit:
 *
 *   1. Kodda kullanılan her `cl_*` tablosunun katalogda bir karşılığı var.
 *      Tablo adları KAYNAKTAN okunuyor; elle tutulan bir liste, listeyi
 *      güncellemeyi unutmak demekti.
 *   2. Katalogda `politikada: true` olan her kalem gizlilik politikasında
 *      gerçekten geçiyor.
 *   3. Her kalem Play formunun sorduğu alanları eksiksiz taşıyor; bir kalem
 *      "silinemez" diyorsa sebebi yazılı (form bunu ayrıca soruyor).
 *
 * Katalog `legal/data-catalog.json`; hem politika hem Play formu oradan
 * doldurulur.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const KOK = path.join(__dirname, '..');
const katalog = JSON.parse(fs.readFileSync(path.join(KOK, 'legal', 'data-catalog.json'), 'utf8'));
const politika = fs.readFileSync(path.join(KOK, 'legal', 'gizlilik-politikasi.md'), 'utf8');

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

/* ----------------------------------------------- 1. Kodda ne saklanıyor */
process.stdout.write(KALIN + 'Kodda kullanılan her tablo katalogda' + SIFIRLA + '\n');

/** api/ altındaki tüm .js dosyaları (tek seviye + alt dizinler). */
function jsDosyalari(dizin) {
  return fs.readdirSync(dizin, { withFileTypes: true }).reduce(function (acc, e) {
    const tam = path.join(dizin, e.name);
    if (e.isDirectory()) return acc.concat(jsDosyalari(tam));
    return /\.js$/.test(e.name) ? acc.concat(tam) : acc;
  }, []);
}

const KAYNAK = jsDosyalari(path.join(KOK, 'api'))
  .map(function (f) { return fs.readFileSync(f, 'utf8'); })
  .join('\n');

/* `cl_sid` / `cl_at` / `cl_rt` çerez ADLARI, tablo değil; `cl:` ile başlayan
   Redis anahtarları da öyle. Tablolar kataloğun kendi listesiyle değil,
   kodda tablo gibi kullanılmalarıyla ayrılıyor. */
const CEREZLER = ['cl_sid', 'cl_at', 'cl_rt'];
const TABLOLAR = Array.from(new Set(
  (KAYNAK.match(/cl_[a-z_]+/g) || [])
)).filter(function (t) {
  return CEREZLER.indexOf(t) === -1 && !/_single_owner$/.test(t);
}).sort();

dene('kodda en az üç cl_ tablosu okundu (okuma doğru çalışıyor)', function () {
  assert.ok(TABLOLAR.length >= 3, 'yalnızca ' + TABLOLAR.length + ' tablo okundu: ' + TABLOLAR.join(', '));
});

const KATALOG_METNI = JSON.stringify(katalog);

TABLOLAR.forEach(function (tablo) {
  dene('"' + tablo + '" katalogda geçiyor', function () {
    assert.ok(KATALOG_METNI.indexOf(tablo) !== -1,
      'kodda kullanılıyor ama katalogda yok — yeni tablo eklendiyse katalog da büyümeli');
  });
});

dene('çerez adları katalogda ayrıca yazılı', function () {
  CEREZLER.forEach(function (c) {
    assert.ok(KATALOG_METNI.indexOf(c) !== -1, c + ' katalogda yok');
  });
});

/* ------------------------------------- 2. Katalog ↔ gizlilik politikası */
process.stdout.write(KALIN + 'Politikada geçmesi gereken her kalem geçiyor' + SIFIRLA + '\n');

katalog.kalemler.forEach(function (k) {
  if (!k.politikada) return;
  dene('politikada "' + k.id + '" (' + k.politikaAnahtari + ')', function () {
    assert.ok(k.politikaAnahtari, 'politikaAnahtari boş');
    assert.ok(politika.indexOf(k.politikaAnahtari) !== -1,
      'gizlilik politikasında geçmiyor — kullanıcı neyin toplandığını okuyamaz');
  });
});

dene('FCM cihaz jetonu hem katalogda hem politikada', function () {
  /* Bu sınamanın doğmasına sebep olan kusur. */
  const k = katalog.kalemler.find(function (x) { return x.id === 'cihaz_jetonu'; });
  assert.ok(k, 'katalogda cihaz_jetonu yok');
  assert.strictEqual(k.playTip, 'Device or other IDs');
  assert.ok(/cihaz jetonu/i.test(politika), 'politikada cihaz jetonu geçmiyor');
});

/* --------------------------------------- 3. Play formunun istediği alanlar */
process.stdout.write(KALIN + 'Her kalem Play formunun alanlarını taşıyor' + SIFIRLA + '\n');

const ALANLAR = ['tr', 'en', 'kaynak', 'amac', 'playKategori', 'playTip',
  'toplanir', 'paylasilir', 'zorunlu', 'aktarimdaSifreli', 'silinebilir', 'politikada'];

katalog.kalemler.forEach(function (k) {
  dene(k.id + ': alanlar eksiksiz', function () {
    ALANLAR.forEach(function (a) {
      assert.ok(Object.prototype.hasOwnProperty.call(k, a), a + ' alanı yok');
    });
    assert.ok(Array.isArray(k.ucuncuTaraf), 'ucuncuTaraf dizi değil');
  });
});

katalog.kalemler.filter(function (k) { return k.silinebilir === false; }).forEach(function (k) {
  dene(k.id + ': silinemiyorsa sebebi yazılı', function () {
    assert.ok(k.silinemezSebep, 'Play formu "kullanıcı silebiliyor mu" diye soruyor; hayırsa sebebi olmalı');
  });
});

dene('paylaşılan her kalemde üçüncü taraf adı var', function () {
  katalog.kalemler.filter(function (k) { return k.paylasilir; }).forEach(function (k) {
    assert.ok(k.ucuncuTaraf.length > 0, k.id + ': paylaşılıyor ama üçüncü taraf yazılmamış');
  });
});

dene('kart verisi "toplanmayanlar" listesinde', function () {
  /* Ödeme barındırılan formda; bu iddia kayboluyorsa bir şey değişmiş demektir. */
  const metin = JSON.stringify(katalog.toplanmayanlar);
  assert.ok(/CVV/i.test(metin) && /iyzico/i.test(metin), 'kart verisi iddiası katalogdan düşmüş');
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
