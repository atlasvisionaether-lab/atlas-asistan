'use strict';

/**
 * Dünya haritası veri katmanı sınamaları.
 *
 *   node tools/worldmap-test.js
 *
 * Ağa ÇIKMAZ. Fikstürler `tools/feeds-probe.sh` ile ölçülmüş gerçek biçimlerden
 * türetildi (çalışma 34538699395, 2026-09-10); besleme biçimi değişirse ölçümü
 * tekrar koşup fikstürleri güncelleyin.
 */

const feeds = require('../api/_lib/feeds.js');

let failed = 0;
function ok(cond, msg) {
  process.stdout.write((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + msg + '\n');
  if (!cond) failed = 1;
}
function head(t) { process.stdout.write('\n\x1b[1m== ' + t + '\x1b[0m\n'); }

/* ---------------- fikstürler ---------------- */

const FEODO = JSON.stringify([
  { ip_address: '162.243.103.246', port: 8080, status: 'offline', hostname: null,
    as_number: 14061, as_name: 'DIGITALOCEAN-ASN', country: 'US',
    first_seen: '2022-06-04 21:24:53', last_online: '2026-03-07', malware: 'Emotet' },
  { ip_address: '1.2.3.4', port: 443, status: 'online', country: 'us', malware: 'Emotet' },
  { ip_address: '5.6.7.8', port: 80, status: 'online', country: 'DE', malware: 'Dridex' },
  { ip_address: '9.9.9.9', port: 80, status: 'online', country: null, malware: 'Dridex' },
  { ip_address: '8.8.8.8', port: 80, status: 'online', country: 'XYZ' },
  null
]);

/* Zaman kovaları sınanabilsin diye damgalar koşma anına göre üretiliyor;
   sabit tarih yazsak fikstür birkaç gün sonra kendiliğinden bayatlar ve
   sınama sebepsiz kırmızıya döner. */
function damga(msOnce) {
  const d = new Date(Date.now() - msOnce);
  return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 19) + ' UTC';
}

const URLHAUS = JSON.stringify({
  '3901218': [{ dateadded: damga(10 * 60e3), url: 'http://61.54.41.118:40394/i',
                url_status: 'online', threat: 'malware_download', tags: ['elf', 'Mozi'],
                urlhaus_link: 'https://urlhaus.abuse.ch/url/3915021/', reporter: 'geenensp' }],
  '3901219': [{ dateadded: damga(5 * 3600e3), url: 'http://example.invalid/x',
                url_status: 'offline', threat: 'malware_download' }],
  '3901220': [{ dateadded: damga(3 * 86400e3), url: 'http://example.invalid/y',
                url_status: 'online' }],
  '3901221': [{ dateadded: 'bozuk tarih', url: 'http://example.invalid/z',
                url_status: 'offline', threat: 'malware_download' }]
});

const TOREXIT = '171.25.193.25\n80.67.167.81\n\n# yorum\n198.98.51.189\n';

/* ---------------- ayrıştırıcılar ---------------- */

head('feodo — ülke taşıyan tek besleme');
const f = feeds.findSource('feodo').parse(FEODO);
ok(f.total === 6, 'ham kayıt sayısı 6 (gelen: ' + f.total + ')');
ok(f.skipped === 3, 'ülkesiz/geçersiz/bozuk 3 kayıt elendi (gelen: ' + f.skipped + ')');
const us = f.countries.find(function (c) { return c.country === 'US'; });
ok(!!us && us.count === 2, 'küçük harfli "us" ile "US" birleştirildi');
ok(!!us && us.online === 1, 'US için online sayısı 1');
ok(f.countries[0].country === 'US', 'ülkeler sayıya göre azalan sıralı');
ok(us.malware[0].name === 'Emotet' && us.malware[0].count === 2, 'zararlı yazılım ailesi sayıldı');
ok(JSON.stringify(f).indexOf('162.243') === -1, 'IP adresi çıktıya SIZMIYOR');

head('urlhaus — ülke yok, konum uydurulmuyor');
const u = feeds.findSource('urlhaus').parse(URLHAUS);
ok(u.total === 4, 'sayısal anahtarlı nesne kökü çözüldü (gelen: ' + u.total + ')');
ok(u.online === 2, 'online sayısı 2');
ok(u.threats[0].name === 'malware_download' && u.threats[0].count === 3, 'tehdit türü sayıldı');
ok(u.threats.some(function (t) { return t.name === 'bilinmiyor'; }), 'threat alanı yoksa "bilinmiyor"');
ok(JSON.stringify(u).indexOf('61.54.41.118') === -1, 'zararlı URL çıktıya SIZMIYOR');
ok(u.countries === undefined, 'ülke alanı üretilmiyor');

head('urlhaus zaman kovaları — 1s/24s/7g filtresinin gerçek dayanağı');
ok(u.windows.h1 === 1, '1 saat kovası: yalnızca 10 dk önceki (gelen: ' + u.windows.h1 + ')');
ok(u.windows.h24 === 2, '24 saat kovası: 10 dk + 5 saat (gelen: ' + u.windows.h24 + ')');
ok(u.windows.d7 === 3, '7 gün kovası: üçü de (gelen: ' + u.windows.d7 + ')');
ok(u.windows.d7 < u.total, 'ayrıştırılamayan tarih hiçbir kovaya konmadı — uydurulmuş zamana yerleştirilmedi');

head('torexit — düz metin');
const t = feeds.findSource('torexit').parse(TOREXIT);
ok(t.total === 3, 'boş satır ve yorum elendi (gelen: ' + t.total + ')');

head('bozuk girdi — hata yutulmuyor, fırlatılıyor');
function throwsWith(fn, code) {
  try { fn(); return false; } catch (e) { return code ? e.message === code : true; }
}
ok(throwsWith(function () { feeds.findSource('feodo').parse('{"bu":'); }), 'feodo bozuk JSON');
ok(throwsWith(function () { feeds.findSource('urlhaus').parse('{"bu":'); }), 'urlhaus bozuk JSON');
ok(throwsWith(function () { feeds.findSource('feodo').parse('{"dizi":"degil"}'); }, 'feed_shape'), 'feodo yanlış kök → feed_shape');
ok(throwsWith(function () { feeds.findSource('urlhaus').parse('[1,2,3]'); }, 'feed_shape'), 'urlhaus dizi kökü → feed_shape');

head('kaynak tanımları ölçümle tutarlı');
ok(feeds.findSource('feodo').geo === true, 'feodo geo=true (ölçümde .country var)');
ok(feeds.findSource('urlhaus').geo === false, 'urlhaus geo=false (ölçümde ülke yok)');
ok(feeds.findSource('torexit').geo === false, 'torexit geo=false (düz IP listesi)');
ok(feeds.findSource('urlhaus').ttl > feeds.findSource('feodo').ttl,
   'urlhaus TTL daha uzun — 6.6 MB indirme seyreltiliyor');
ok(feeds.SOURCES.every(function (s) { return /^https:\/\//.test(s.url); }), 'tüm kaynaklar HTTPS');
ok(feeds.SOURCES.every(function (s) { return typeof s.attribution === 'string' && s.attribution; }),
   'her kaynağın atıf metni var');

head('loadSource — bir besleme düşerse diğerleri ayakta kalır');
(async function () {
  const gercekFetch = global.fetch;
  global.fetch = function () { return Promise.reject(new Error('ağ yok')); };
  const sonuc = await feeds.loadSource(feeds.findSource('feodo'));
  global.fetch = gercekFetch;

  ok(sonuc.ok === false, 'ulaşılamayan besleme ok=false döner, hata FIRLATMAZ');
  ok(sonuc.error === 'feed_unreachable', 'hata kodu feed_unreachable (gelen: ' + sonuc.error + ')');
  ok(sonuc.id === 'feodo' && sonuc.label && sonuc.attribution,
     'başarısız sonuçta bile kimlik ve atıf korunuyor');

  head(failed ? 'SONUÇ: BAŞARISIZ' : 'SONUÇ: HEPSİ GEÇTİ');
  process.exit(failed);
})();
