'use strict';

/**
 * IP→ülke çözücüsünün sınamaları.
 *
 *   node tools/geo-test.js
 *
 * İki katman:
 *   1. Sentetik tablo — kesin ve deterministik. Çözümün doğruluğunu kanıtlar.
 *   2. Gerçek tablo (varsa) — yapısal doğrulama: sıralı mı, çakışma var mı,
 *      kaç ülke kapsıyor.
 *
 * Bilerek YAPILMAYAN şey: "8.8.8.8 ABD'dir" gibi ezberden oracle yazmak.
 * Tablonun doğruluğu kaynağın doğruluğudur; bizim sınayacağımız şey tabloyu
 * doğru okuyup okumadığımız.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let failed = 0;
function ok(c, m) {
  process.stdout.write((c ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + m + '\n');
  if (!c) failed = 1;
}
function head(t) { process.stdout.write('\n\x1b[1m== ' + t + '\x1b[0m\n'); }

const KOK = path.join(__dirname, '..');
const TABLO = path.join(KOK, 'api', '_lib', 'geo-table.js');
const YEDEK = TABLO + '.yedek';

/* ---------- 1. Sentetik tablo ---------- */
head('Sentetik tablo — çözüm kesinliği');

const vardi = fs.existsSync(TABLO);
if (vardi) fs.renameSync(TABLO, YEDEK);

function ipToInt(s) {
  return s.split('.').reduce(function (n, p) { return n * 256 + Number(p); }, 0);
}
// Uc bitisik olmayan aralik; sinirlar ve bosluk bilerek sinaniyor.
const araliklar = [
  [ipToInt('10.0.0.0'), ipToInt('10.0.0.255'), 'TR'],
  [ipToInt('20.0.0.0'), ipToInt('20.255.255.255'), 'DE'],
  [ipToInt('200.1.0.0'), ipToInt('200.1.0.0'), 'BR']   // tek adreslik aralik
];
const ulkeler = ['BR', 'DE', 'TR'];
const buf = Buffer.alloc(araliklar.length * 9);
araliklar.forEach(function (r, i) {
  buf.writeUInt32BE(r[0], i * 9);
  buf.writeUInt32BE(r[1], i * 9 + 4);
  buf.writeUInt8(ulkeler.indexOf(r[2]), i * 9 + 8);
});
fs.writeFileSync(TABLO, 'module.exports=' + JSON.stringify({
  generatedAt: '2026-01-01', ranges: araliklar.length,
  countries: ulkeler, packed: buf.toString('base64')
}) + ';\n');

delete require.cache[require.resolve('../api/_lib/geo.js')];
delete require.cache[require.resolve('../api/_lib/geo-table.js')];
const geo = require('../api/_lib/geo.js');

ok(geo.tableInfo().ready === true, 'tablo yüklendi');
ok(geo.countryOfIp('10.0.0.0') === 'TR', 'aralığın İLK adresi (10.0.0.0 → TR)');
ok(geo.countryOfIp('10.0.0.255') === 'TR', 'aralığın SON adresi (10.0.0.255 → TR)');
ok(geo.countryOfIp('10.0.0.128') === 'TR', 'aralığın ortası');
ok(geo.countryOfIp('9.255.255.255') === null, 'aralığın hemen ÖNCESİ → null');
ok(geo.countryOfIp('10.0.1.0') === null, 'aralığın hemen SONRASI → null');
ok(geo.countryOfIp('20.128.0.1') === 'DE', 'ikinci aralık');
ok(geo.countryOfIp('200.1.0.0') === 'BR', 'tek adreslik aralık');
ok(geo.countryOfIp('200.1.0.1') === null, 'tek adreslik aralığın dışı');
ok(geo.countryOfIp('100.0.0.0') === null, 'aralıklar arası boşluk → null, UYDURULMUYOR');
ok(geo.countryOfIp('1.2.3.999') === null, 'geçersiz IP → null');
ok(geo.countryOfIp('') === null && geo.countryOfIp(null) === null, 'boş/null girdi → null');
ok(geo.countryOfIp('::1') === null, 'IPv6 → null (tablo yalnızca IPv4)');

head('URL’den IP çıkarma');
ok(geo.ipFromUrl('http://61.54.41.118:40394/i') === '61.54.41.118', 'portlu URL');
ok(geo.ipFromUrl('https://1.2.3.4/a?b=c') === '1.2.3.4', 'sorgulu URL');
ok(geo.ipFromUrl('http://ornek.com/x') === null, 'alan adı → null (DNS sorgusu YAPILMIYOR)');
ok(geo.ipFromUrl('171.25.193.25') === '171.25.193.25', 'çıplak IP');
ok(geo.ipFromUrl('http://999.1.1.1/') === null, 'geçersiz sekizli → null');
ok(geo.ipFromUrl(null) === null, 'null girdi');

/* ---------- 2. Gerçek tablo ---------- */
fs.unlinkSync(TABLO);
if (vardi) {
  fs.renameSync(YEDEK, TABLO);
  head('Gerçek tablo — yapısal doğrulama');
  delete require.cache[require.resolve('../api/_lib/geo.js')];
  delete require.cache[require.resolve('../api/_lib/geo-table.js')];
  const g2 = require('../api/_lib/geo.js');
  const bilgi = g2.tableInfo();
  ok(bilgi.ready, 'tablo geçerli (boyut 9’un katı)');
  ok(bilgi.ranges > 50000, 'aralık sayısı makul (' + bilgi.ranges + ')');
  ok(bilgi.countries >= 100, 'ülke sayısı 100+ (' + bilgi.countries + ')');

  const ham = require('../api/_lib/geo-table.js');
  const b = Buffer.from(ham.packed, 'base64');
  let sirali = true, cakisma = 0, oncekiBitis = -1;
  for (let i = 0; i < bilgi.ranges; i++) {
    const bas = b.readUInt32BE(i * 9), bit = b.readUInt32BE(i * 9 + 4);
    if (bit < bas) sirali = false;
    if (bas <= oncekiBitis) cakisma++;
    oncekiBitis = bit;
  }
  ok(sirali, 'her aralıkta bitiş ≥ başlangıç');
  ok(cakisma === 0, 'aralıklar sıralı ve çakışmıyor (' + cakisma + ' çakışma)');
} else {
  head('Gerçek tablo');
  process.stdout.write('  \x1b[33mYOK\x1b[0m  geo-table.js üretilmemiş; yapısal sınama atlandı.\n');
  process.stdout.write('        Üretmek için: .github/workflows/geo-table.yml\n');
}

process.stdout.write('\n\x1b[1m' + (failed ? 'SONUÇ: BAŞARISIZ' : 'SONUÇ: HEPSİ GEÇTİ') + '\x1b[0m\n');
process.exit(failed);
