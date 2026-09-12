'use strict';

/**
 * Zaman penceresi sınaması — AĞ GEREKTİRMEZ.
 *
 *   node tools/window-test.js
 *
 * NEDEN VAR
 *
 * Haritadaki 1s/24s/7g filtresi sessizce işlevsiz kalmıştı. Sebep tek bir
 * satırdı: sayaç panelini çizen döngü `s.geo` olan kaynakları atlıyordu ve
 * urlhaus'a IP→ülke çözümü eklenince o da coğrafi hale gelip panelden düştü.
 * Filtrenin TEK tüketicisi oydu; düğmeler çalışmaya devam etti ama hiçbir sayı
 * değişmedi. Hiçbir sınama bunu tutmuyordu.
 *
 * Bu dosya iki şeyi tutuyor:
 *   1. Ayrıştırıcı ülke BAŞINA pencere üretiyor mu (sunucu tarafı).
 *   2. Her kaynak zaman filtresini destekleyip desteklemediğini BEYAN ediyor
 *      mu — arayüz kapsamı dürüstçe yazabilsin diye.
 */

const assert = require('assert');
const path = require('path');

const feeds = require(path.join(__dirname, '..', 'api', '_lib', 'feeds.js'));

const YESIL = '[32m';
const KIRMIZI = '[31m';
const KALIN = '[1m';
const SIFIRLA = '[0m';

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

/** urlhaus biçiminde, yaşı verilen kayıtlardan fikstür üretir. */
function urlhausFikstur(kayitlar) {
  const kok = {};
  kayitlar.forEach(function (k, i) {
    const d = new Date(Date.now() - k.yasSaniye * 1000);
    /* ÖLÇÜLDÜ (koşu 34668079640): damga "2026-09-12 02:28:19 UTC" biçiminde —
       sondaki " UTC" eki dahil. Fikstür gerçek biçimi taşıyor ki ayrıştırıcı
       oraya karşı sınansın. */
    const damga = d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    kok[String(1000 + i)] = [{
      dateadded: damga,
      url: k.url,
      url_status: 'online',
      threat: 'malware_download',
      tags: [],
      reporter: 'test',
      urlhaus_link: 'https://urlhaus.abuse.ch/url/' + (1000 + i) + '/'
    }];
  });
  return JSON.stringify(kok);
}

/* geo çözümü gerçek tabloya bağlı; hangi IP'nin hangi ülkeye düştüğünü
   VARSAYMIYORUZ. Ayrıştırıcıyı çalıştırıp çözülen ülkeleri okuyoruz ve
   iddiaları onların üzerine kuruyoruz. */
const SOURCE = feeds.SOURCES.find(function (s) { return s.id === 'urlhaus'; });

process.stdout.write(KALIN + 'Ayrıştırıcı ülke başına pencere üretiyor' + SIFIRLA + '\n');

dene('pencereler ülke kırılımında var', function () {
  const metin = urlhausFikstur([
    { url: 'http://8.8.8.8/a.bin', yasSaniye: 60 },          // 1s içinde
    { url: 'http://8.8.8.8/b.bin', yasSaniye: 7200 },        // 24s içinde
    { url: 'http://8.8.8.8/c.bin', yasSaniye: 3 * 86400 },   // 7g içinde
    { url: 'http://8.8.8.8/d.bin', yasSaniye: 30 * 86400 }   // hiçbirinde
  ]);
  const d = SOURCE.parse(metin);
  assert.ok(Array.isArray(d.countries), 'countries dizi olmalı');
  const ulkeli = d.countries.filter(function (c) { return c.windows; });
  assert.ok(ulkeli.length > 0, 'hiçbir ülkede windows alanı yok');
  ulkeli.forEach(function (c) {
    assert.ok(typeof c.windows.h1 === 'number', c.country + ': h1 sayı değil');
    assert.ok(typeof c.windows.h24 === 'number', c.country + ': h24 sayı değil');
    assert.ok(typeof c.windows.d7 === 'number', c.country + ': d7 sayı değil');
  });
});

dene('pencereler iç içe: h1 ≤ h24 ≤ d7 ≤ toplam', function () {
  const metin = urlhausFikstur([
    { url: 'http://8.8.8.8/a.bin', yasSaniye: 60 },
    { url: 'http://8.8.8.8/b.bin', yasSaniye: 7200 },
    { url: 'http://8.8.8.8/c.bin', yasSaniye: 3 * 86400 },
    { url: 'http://8.8.8.8/d.bin', yasSaniye: 30 * 86400 }
  ]);
  const d = SOURCE.parse(metin);
  d.countries.forEach(function (c) {
    if (!c.windows) return;
    assert.ok(c.windows.h1 <= c.windows.h24, c.country + ': h1 > h24');
    assert.ok(c.windows.h24 <= c.windows.d7, c.country + ': h24 > d7');
    assert.ok(c.windows.d7 <= c.count, c.country + ': d7 > toplam');
  });
  assert.ok(d.windows.h1 <= d.windows.h24 && d.windows.h24 <= d.windows.d7,
    'genel pencereler iç içe değil');
});

dene('ülke pencerelerinin toplamı genel pencereyi AŞMAZ', function () {
  /* Çözülemeyen kayıtlar genel sayıya girer ama ülkeye yazılmaz; bu yüzden
     eşitlik değil "aşmaz" iddiası doğru olan. */
  const metin = urlhausFikstur([
    { url: 'http://8.8.8.8/a.bin', yasSaniye: 60 },
    { url: 'http://1.1.1.1/b.bin', yasSaniye: 600 },
    { url: 'http://ornek.gecersiz/c.bin', yasSaniye: 900 }   // alan adı: çözülemez
  ]);
  const d = SOURCE.parse(metin);
  const toplamH1 = d.countries.reduce(function (n, c) {
    return n + ((c.windows && c.windows.h1) || 0);
  }, 0);
  assert.ok(toplamH1 <= d.windows.h1,
    'ülke toplamı (' + toplamH1 + ') genel h1 (' + d.windows.h1 + ') değerini aşıyor');
});

dene('eski kayıt hiçbir pencereye girmez', function () {
  const metin = urlhausFikstur([{ url: 'http://8.8.8.8/eski.bin', yasSaniye: 40 * 86400 }]);
  const d = SOURCE.parse(metin);
  assert.strictEqual(d.windows.h1, 0);
  assert.strictEqual(d.windows.h24, 0);
  assert.strictEqual(d.windows.d7, 0);
  d.countries.forEach(function (c) {
    if (!c.windows) return;
    assert.strictEqual(c.windows.d7, 0, c.country + ': eski kayıt 7g penceresine girmiş');
  });
});

dene('" UTC" ekli damga ayrıştırılıyor', function () {
  /* Bu ek yüzünden ölçüm betiğimdeki jq ifadesi hiçbir damgayı okuyamamıştı.
     Üretim ayrıştırıcısının aynı tuzağa düşmediği burada tutuluyor. */
  const metin = urlhausFikstur([{ url: 'http://8.8.8.8/a.bin', yasSaniye: 30 }]);
  assert.ok(metin.indexOf(' UTC') !== -1, 'fikstür " UTC" eki taşımıyor');
  const d = SOURCE.parse(metin);
  assert.strictEqual(d.windows.h1, 1, 'damga okunamadı');
});

process.stdout.write(KALIN + 'Kaynaklar desteği BEYAN ediyor' + SIFIRLA + '\n');

dene('her kaynak supportsWindows beyan ediyor', function () {
  feeds.SOURCES.forEach(function (s) {
    assert.strictEqual(typeof s.supportsWindows, 'boolean',
      s.id + ': supportsWindows beyan edilmemiş');
  });
});

dene('yalnızca urlhaus destekliyor (ölçüme dayalı)', function () {
  const destekleyen = feeds.SOURCES.filter(function (s) { return s.supportsWindows; })
    .map(function (s) { return s.id; });
  assert.deepStrictEqual(destekleyen, ['urlhaus'],
    'beklenen [urlhaus], gelen [' + destekleyen.join(', ') + ']');
});

dene('destekleyen kaynağın ayrıştırıcısı gerçekten pencere üretiyor', function () {
  /* Beyan ile davranış ayrışmasın: supportsWindows: true diyen bir kaynağın
     ayrıştırıcısı pencere üretmiyorsa arayüz boş bir filtre gösterirdi. */
  feeds.SOURCES.forEach(function (s) {
    if (!s.supportsWindows || s.stream) return;
    const metin = urlhausFikstur([{ url: 'http://8.8.8.8/a.bin', yasSaniye: 30 }]);
    const d = s.parse(metin);
    assert.ok(d.windows, s.id + ': genel pencere yok');
    const pencereli = d.countries.filter(function (c) { return c.windows; });
    assert.ok(pencereli.length > 0, s.id + ': ülke kırılımında pencere yok');
  });
});

process.stdout.write(KALIN + 'Ön yüz filtreyi gerçekten tüketiyor' + SIFIRLA + '\n');

/* Bu bölüm index.html'in KAYNAĞINA bakıyor. Kırılgan olduğunu biliyorum ve
   normalde davranış sınanır, metin değil. Ama regresyonun kendisi tam olarak
   buradaydı: filtre çalışıyordu, tüketicisi yoktu. Uygulama tek dosyalık,
   derleme adımı yok ve DOM'u ayağa kaldıran bir sınama altyapısı da yok;
   bu kontroller o boşluğu kapatıyor. Her biri, geri gelmesini istemediğimiz
   SOMUT satırı hedefliyor. */
const fs = require('fs');
const SAYFA = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

dene('varsayılan aralık "all" (filtre veriyi gizleyerek açılmıyor)', function () {
  assert.ok(/range:\s*'all'/.test(SAYFA), "state.range varsayılanı 'all' değil");
});

dene('"Tümü" düğmesi var', function () {
  assert.ok(/data-window="all"/.test(SAYFA), 'data-window="all" düğmesi yok');
});

dene('sayaç döngüsü artık coğrafi kaynakları ATLAMIYOR', function () {
  /* Regresyonun kaynağı buydu: `if (s.geo || !s.ok || !s.summary) return;` */
  assert.ok(!/if \(s\.geo \|\|/.test(SAYFA),
    'sayaç döngüsü hâlâ s.geo olan kaynakları atlıyor — filtre yine tüketicisiz kalır');
});

dene('aralık düğmesi tam çizim tetikliyor', function () {
  /* İşleyicinin sonunu düzenli ifadeyle bulmaya çalışmak yanlış yerde kesiyor
     (içerideki forEach'in kendi `});` kapanışına takılıyor). Bunun yerine
     atamadan sonraki sabit bir pencereye bakılıyor — aradığımız çağrı orada. */
  const i = SAYFA.indexOf("state.range = b.getAttribute('data-window')");
  assert.ok(i !== -1, 'aralık düğmesi işleyicisi bulunamadı');
  const blok = SAYFA.slice(i, i + 600);
  assert.ok(/\brender\(\);/.test(blok),
    'işleyici render() çağırmıyor; harita ve ilk on listesi aralığa tepki vermez');
});

dene('harita ve liste seçili pencereyi okuyor', function () {
  const n = (SAYFA.match(/pencereSayisi\(/g) || []).length;
  assert.ok(n >= 6, 'pencereSayisi yalnızca ' + n + ' yerde kullanılıyor; çizim yolları eksik');
});

dene('kapsam notu çiziliyor', function () {
  assert.ok(/drawRangeNote\(\)/.test(SAYFA), 'drawRangeNote çağrılmıyor');
  assert.ok(/rangeScope/.test(SAYFA) && /rangeExcluded/.test(SAYFA),
    'kapsam metinleri sözlükte yok');
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
