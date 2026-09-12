'use strict';

/**
 * Kendi tarama etkinliği katmanı — AĞ GEREKTİRMEZ.
 *
 *   node tools/ownactivity-test.js
 *
 * NEDEN VAR
 *
 * Bu katman KENDİ müşterilerimizin verisinden besleniyor. Bir hata burada
 * üçüncü taraf beslemelerden farklı ve daha ağır sonuç doğurur:
 *
 *   1. Gizlilik — yanıta IP, host, kullanıcı ya da oturum sızarsa bu bir veri
 *      ifşasıdır. `cl_scans` 003'ten beri host saklıyor; onun haritaya
 *      ÇIKMAMASI bir tercih değil, kuralın kendisi.
 *   2. Anlam — besleme sayıları ile tarama sayıları farklı şeyler. Aynı
 *      havuza katılırlarsa toplanabilir gibi görünürler ve rakam yalan söyler.
 *   3. Biçim — ülke kodu ISO-2 olmalı; bozuk bir değer haritada sessizce
 *      yanlış bir işaret üretir.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const YESIL = '[32m';
const KIRMIZI = '[31m';
const KALIN = '[1m';
const SIFIRLA = '[0m';

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

const KOK = path.join(__dirname, '..');
const DB = fs.readFileSync(path.join(KOK, 'api', '_lib', 'db.js'), 'utf8');
const HARITA = fs.readFileSync(path.join(KOK, 'api', 'worldmap.js'), 'utf8');
const SAYFA = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
const GOC = fs.readFileSync(
  path.join(KOK, 'db', 'migrations', '006_scans_country.sql'), 'utf8');

process.stdout.write(KALIN + 'Gizlilik: yalnızca ülke dışarı çıkıyor' + SIFIRLA + '\n');

dene('sorgu SADECE country sütununu seçiyor', function () {
  /* `select=country` dışında bir sütun eklenirse host ya da oturum kimliği
     haritaya sızabilir. Bu satır o yüzden kilitli tutuluyor. */
  const i = DB.indexOf('async function countryCounts');
  assert.ok(i !== -1, 'countryCounts bulunamadı');
  const blok = DB.slice(i, i + 900);
  assert.ok(/select=country(?![_a-z])/.test(blok), 'select=country yok');
  ['host', 'anonymous_session_id', 'user_id', 'findings', 'id']
    .forEach(function (alan) {
      assert.ok(blok.indexOf('select=country,' + alan) === -1 &&
                blok.indexOf(',' + alan) === -1,
        'sorgu ' + alan + ' sütununu da çekiyor');
    });
});

dene('countryCounts yalnızca ülke ve sayı döndürüyor', function () {
  /* Pencereyi FONKSIYONUN SONUNDA kesiyoruz. Sabit bir karakter sayısı
     kullanınca komşu `ownerFilter` gövdesi de okunuyordu ve sınama kendi
     penceresi yüzünden kalıyordu — ölçülen şey yanlış olursa sonuç da yanlış. */
  const i = DB.indexOf('async function countryCounts');
  const son = DB.indexOf('function ownerFilter', i);
  assert.ok(i !== -1 && son > i, 'countryCounts gövdesi sınırlanamadı');
  const blok = DB.slice(i, son).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/country: p\[0\], count: p\[1\]/.test(blok),
    'dönen nesne { country, count } biçiminde değil');
  assert.ok(!/host|session|user_id/.test(blok),
    'kod gövdesinde host/oturum/kullanıcı geçiyor');
});

dene('worldmap yanıtı ownActivity dışında tarama verisi taşımıyor', function () {
  const i = HARITA.indexOf('ownActivity =');
  assert.ok(i !== -1, 'ownActivity ataması yok');
  const blok = HARITA.slice(i, i + 700);
  ['\\.host', 'sessionId', 'userId', 'anonymous']
    .forEach(function (kalip) {
      assert.ok(!new RegExp(kalip).test(blok), 'ownActivity bloğunda ' + kalip + ' var');
    });
});

process.stdout.write(KALIN + 'Biçim: ülke kodu iki katmanda da kısıtlı' + SIFIRLA + '\n');

dene('veritabanı ISO-2 kısıtı koyuyor', function () {
  assert.ok(/cl_scans_country_format/.test(GOC), 'kısıt adı yok');
  assert.ok(/\^\[A-Z\]\{2\}\$/.test(GOC), 'ISO-2 düzenli ifadesi yok');
});

dene('yazmadan önce kodda da doğrulanıyor', function () {
  /* Veritabanı kısıtı son savunma; oraya bozuk değer GÖNDERMEK bile
     taramanın kaydını düşürür (INSERT hatası). Bu yüzden kod tarafında da
     süzülüyor: bozuk ülke NULL'a çevriliyor, tarama kaydı kaybolmuyor. */
  const i = DB.indexOf('country: typeof result.country');
  assert.ok(i !== -1, 'saveScan içinde ülke süzgeci yok');
  assert.ok(/\/\^\[A-Z\]\{2\}\$\//.test(DB.slice(i, i + 220)),
    'saveScan ISO-2 doğrulaması yapmıyor');
});

dene('göç nullable ve kısmi indeks kullanıyor', function () {
  assert.ok(/ADD COLUMN IF NOT EXISTS country TEXT/.test(GOC), 'sütun eklenmiyor');
  assert.ok(!/country TEXT NOT NULL/.test(GOC), 'sütun NOT NULL — eski kayıtlar göçü kırar');
  assert.ok(/WHERE country IS NOT NULL/.test(GOC), 'kısmi indeks yok');
});

process.stdout.write(KALIN + 'Anlam: iki sayı birbirine karışmıyor' + SIFIRLA + '\n');

dene('kendi etkinliğimiz AYRI bir SVG katmanında', function () {
  assert.ok(/id="wmOwn"/.test(SAYFA), 'wmOwn katmanı yok');
  assert.ok(/wmap__ownDot/.test(SAYFA), 'ayrı biçim sınıfı yok');
});

dene('işaret biçimi de farklı (renk körlüğünde ayırt edilebilsin)', function () {
  const i = SAYFA.indexOf('function drawOwn');
  assert.ok(i !== -1, 'drawOwn yok');
  const blok = SAYFA.slice(i, i + 1800);
  assert.ok(/createElementNS\(SVG_NS, 'rect'\)/.test(blok),
    'kendi katmanı da daire çiziyor; besleme işaretlerinden ayırt edilemez');
});

dene('markers havuzuna KATILMIYOR', function () {
  /* Beslemelerin `markers` dizisine eklenseydi ilk on listesi ve yoğunluk
     ölçeği iki farklı şeyi toplardı. */
  const i = HARITA.indexOf('for (const c of r.data.countries)');
  assert.ok(i !== -1, 'marker birleştirme bloğu yok');
  const blok = HARITA.slice(i, i + 900);
  assert.ok(!/ownActivity|countryCounts/.test(blok),
    'kendi etkinliğimiz besleme işaretleriyle aynı havuza giriyor');
});

dene('zaman filtresi seçiliyken katman gizleniyor', function () {
  /* `cl_scans` için pencere kırılımı üretmiyoruz. Filtrelenmiş bir görünüme
     filtrelenmemiş bir katman karıştırmak yanıltıcı olurdu. */
  const i = SAYFA.indexOf('function drawOwn');
  const blok = SAYFA.slice(i, i + 900);
  assert.ok(/state\.range !== 'all'/.test(blok),
    'drawOwn zaman aralığına bakmıyor');
});

dene('arayüz ikisinin toplanamayacağını yazıyor', function () {
  assert.ok(/ownNote/.test(SAYFA), 'ownNote sözlükte yok');
  assert.ok(/toplanmaz|not additive/.test(SAYFA),
    'iki sayının toplanamayacağı hiçbir yerde söylenmiyor');
});

process.stdout.write(KALIN + 'Dayanıklılık' + SIFIRLA + '\n');

dene('sorgu düşerse harita çizilmeye devam eder', function () {
  const i = HARITA.indexOf("let ownActivity");
  const blok = HARITA.slice(i, i + 800);
  assert.ok(/try\s*\{/.test(blok) && /catch/.test(blok), 'try/catch yok');
  assert.ok(/query_failed/.test(blok), 'hata sebebi dışarı yazılmıyor');
});

dene('sebep sessizce yutulmuyor', function () {
  const i = HARITA.indexOf("let ownActivity");
  const blok = HARITA.slice(i, i + 800);
  ['db_not_configured', 'no_located_scans', 'query_failed'].forEach(function (r) {
    assert.ok(blok.indexOf(r) !== -1, r + ' sebebi yok');
  });
});

dene('üst sınıra dayanıldığı saklanmıyor', function () {
  const i = DB.indexOf('async function countryCounts');
  const blok = DB.slice(i, i + 1400);
  assert.ok(/truncated/.test(blok), 'truncated bayrağı yok');
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
