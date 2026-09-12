'use strict';
/**
 * Akis sayacinin GIRDI BASINA saydigini sinar. Agdan bagimsiz.
 *
 *   node tools/counter-test.js
 *
 * NEDEN
 *
 * Onceki surum govdedeki her `"country":"XX"` eslesmesini ayri sayiyordu.
 * Olcum (kosu 34663226505) bunun %37 sislik urettigini gosterdi: 75.630
 * kimlik avi adresine karsilik 104.083 detay satiri, ve tek bir girdide
 * 1.405 satir. Bu, yalnizca toplami degil ulke SIRALAMASINI da bozuyordu.
 *
 * Fikstur bos degil: 2 numarali girdi ayni ulkeyi UC kez tasiyor. Eski kod
 * NL=3 verirdi, yeni kod NL=1 veriyor — yani bu sinama duzeltmeyi gercekten
 * ayirt ediyor.
 *
 * Parca boyutlari kasten uc noktalari iceriyor: 7 bayt her eslesmeyi ikiye
 * boler, tek parca hic bolmez. Ikisi de ayni sonucu vermeli.
 */
const path = '/home/user/atlas-asistan/cyberlionai/api/_lib/feeds.js';
const src = require('fs').readFileSync(path, 'utf8');

/* Fonksiyonu modulden yalitip sahte fetch ile calistirmak icin kucuk bir
   kosum: modul fetch'i global'den aliyor, biz onu degistiriyoruz. */
function sahteGovde(metin, parcaBoyu) {
  const buf = Buffer.from(metin, 'utf8');
  let i = 0;
  return {
    ok: true, status: 200,
    body: { getReader() { return {
      read() {
        if (i >= buf.length) return Promise.resolve({ done: true });
        const p = buf.subarray(i, Math.min(i + parcaBoyu, buf.length));
        i += parcaBoyu;
        return Promise.resolve({ done: false, value: new Uint8Array(p) });
      },
      cancel() { return Promise.resolve(); }
    }; } }
  };
}

const feeds = require(path);
let gecen = 0, kalan = 0;
function sina(ad, beklenen, gercek) {
  const a = JSON.stringify(beklenen), b = JSON.stringify(gercek);
  if (a === b) { console.log('  GECTI  ' + ad); gecen++; }
  else { console.log('  KALDI  ' + ad + '\n    beklenen ' + a + '\n    cikan    ' + b); kalan++; }
}

/* Fikstur: olculen gercek yapiyi taklit eder. */
const FIX = JSON.stringify([
  { phish_id: 1, url: 'http://a', details: [ { country: 'US' } ] },
  /* Ayni girdide ayni ulke UC kez: bir kez sayilmali. */
  { phish_id: 2, url: 'http://b', details: [ { country: 'NL' }, { country: 'NL' }, { country: 'NL' } ] },
  /* Iki farkli ulke: her birinde bir kez. */
  { phish_id: 3, url: 'http://c', details: [ { country: 'US' }, { country: 'DE' } ] },
  /* Ulkesiz girdi: hic sayilmamali ama girdi olarak var. */
  { phish_id: 4, url: 'http://d', details: [] }
]);

async function kos() {
  for (const parca of [7, 64, 1024, 1000000]) {
    global.fetch = function () { return Promise.resolve(sahteGovde(FIX, parca)); };
    delete require.cache[path];
    const m = require(path);
    const kaynak = m.SOURCES.find(s => s.id === 'phishtank');
    const sonuc = await m.loadSource(kaynak);
    const d = sonuc.data;
    const ulkeler = {};
    d.countries.forEach(c => { ulkeler[c.country] = c.count; });
    sina('parca=' + parca + ' ulke sayilari', { US: 2, NL: 1, DE: 1 }, ulkeler);
    sina('parca=' + parca + ' girdi sayisi', 4, d.entries);
    sina('parca=' + parca + ' toplam (girdi,ulke) cifti', 4, d.total);
  }
  console.log('\nGecen: ' + gecen + '   Kalan: ' + kalan);
  process.exit(kalan ? 1 : 0);
}
kos();
