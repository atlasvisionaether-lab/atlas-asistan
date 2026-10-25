'use strict';

/**
 * Google Web Risk kara liste sınaması. Ağ yok: fetch taklit ediliyor.
 * Sabitlenen:
 *   - İstek biçimi: uris:search, üç tehdit türü, URL-kodlu adres, anahtar.
 *   - Google'a sorgu dizesi, # parçası ve kullanıcı bilgisi GİTMEZ.
 *   - Anahtar yoksa ağa çıkılmaz (not_configured); HTTP hatası/zaman aşımı
 *     sonuç değil hata (tarama düşmez, kontrol "ölçülemedi").
 *   - Eşleşme Google'ın expireTime'ına kadar önbellekte, sonra taze sorgu;
 *     expireTime yoksa önbelleğe alınmaz. Temiz sonuç 30 dk.
 *   - Uç önbelleği eşleşmede expireTime'ı aşmaz; süresi geçen gösterilmez.
 *   - PDF süresi geçmiş eşleşmeyi basmaz; e-posta özeti uyarıyı yeniden sorar.
 */
const path = require('node:path');
const API = path.join(__dirname, '..', 'api');
const webrisk = require(path.join(API, '_lib', 'webrisk.js'));
const toolcheck = require(path.join(API, '_lib', 'toolcheck.js'));
const report = require(path.join(API, '_lib', 'report.js'));
const mailer = require(path.join(API, '_lib', 'mailer.js'));

let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (b === e) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }

const T0 = Date.parse('2026-10-25T10:00:00Z');
let istekler = [];
function yanit(govde, durum) {
  return async function (url) {
    istekler.push(url);
    return { ok: (durum || 200) < 400, status: durum || 200, json: async function () { return govde; } };
  };
}
const ESLESME = { threat: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'BILINMEYEN'], expireTime: '2026-10-25T10:05:00Z' } };

(async function () {
  /* --- İstek biçimi ve gizlilik --- */
  webrisk._resetCache(); istekler = [];
  const r1 = await webrisk.lookup('https://kullanici:sifre@ornek.com/giris?token=GIZLI#x', { key: 'K', fetch: yanit({}), now: T0 });
  const u = new URL(istekler[0]);
  esit('uç adresi', u.origin + u.pathname, 'https://webrisk.googleapis.com/v1/uris:search');
  esit('üç tehdit türü', u.searchParams.getAll('threatTypes').join(','), 'MALWARE,SOCIAL_ENGINEERING,UNWANTED_SOFTWARE');
  esit('sorgu dizesi, parça ve kullanıcı gitmez', u.searchParams.get('uri'), 'https://ornek.com/giris');
  esit('anahtar', u.searchParams.get('key'), 'K');
  esit('temiz sonuç', r1.ok && r1.threats.length, 0);

  esit('anahtar yok → not_configured', (await webrisk.lookup('https://a.com/', { key: '', fetch: yanit({}) })).reason, 'not_configured');
  esit('anahtar yokken ağa çıkılmaz', istekler.length, 1);
  esit('http şeması dışı reddedilir', (await webrisk.lookup('ftp://a.com/', { key: 'K', fetch: yanit({}) })).reason, 'bad_uri');
  esit('HTTP 403 → hata', (await webrisk.lookup('https://b.com/', { key: 'K', fetch: yanit({}, 403) })).reason, 'http_403');
  esit('fetch düşerse hata', (await webrisk.lookup('https://c.com/', { key: 'K', fetch: async function () { throw new Error('x'); } })).reason, 'error');

  /* --- Eşleşme ve önbellek --- */
  webrisk._resetCache(); istekler = [];
  const m1 = await webrisk.lookup('https://kotu.example/', { key: 'K', fetch: yanit(ESLESME), now: T0 });
  esit('eşleşme türleri (bilinmeyen atılır)', m1.threats.join(','), 'MALWARE,SOCIAL_ENGINEERING');
  esit('süre taşınır', m1.expireTime, '2026-10-25T10:05:00Z');
  await webrisk.lookup('https://kotu.example/', { key: 'K', fetch: yanit(ESLESME), now: T0 + 60000 });
  esit('süre içinde önbellekten', istekler.length, 1);
  await webrisk.lookup('https://kotu.example/', { key: 'K', fetch: yanit(ESLESME), now: T0 + 6 * 60000 });
  esit('süre geçince taze sorgu', istekler.length, 2);
  esit('kalan uyarı süresi', webrisk.warningSecondsLeft(m1, T0), 300);
  esit('süre geçtiyse uyarı süresi 0', webrisk.warningSecondsLeft(m1, T0 + 6 * 60000), 0);

  webrisk._resetCache(); istekler = [];
  const SURESIZ = { threat: { threatTypes: ['MALWARE'] } };
  await webrisk.lookup('https://s.example/', { key: 'K', fetch: yanit(SURESIZ), now: T0 });
  await webrisk.lookup('https://s.example/', { key: 'K', fetch: yanit(SURESIZ), now: T0 + 1000 });
  esit('süresiz eşleşme önbelleğe alınmaz', istekler.length, 2);

  webrisk._resetCache(); istekler = [];
  await webrisk.lookup('https://temiz.example/', { key: 'K', fetch: yanit({}), now: T0 });
  await webrisk.lookup('https://temiz.example/', { key: 'K', fetch: yanit({}), now: T0 + 29 * 60000 });
  esit('temiz sonuç 30 dk önbellekte', istekler.length, 1);
  await webrisk.lookup('https://temiz.example/', { key: 'K', fetch: yanit({}), now: T0 + 31 * 60000 });
  esit('30 dk sonra taze sorgu', istekler.length, 2);

  /* --- Araç --- */
  const sahte = function (sonuc) { return async function () { return sonuc; }; };
  const ESL_SONUC = { ok: true, uri: 'https://kotu.example/', threats: ['MALWARE'], expireTime: new Date(Date.now() + 120000).toISOString(), checkedAt: 'x' };
  const a1 = await toolcheck.run('blacklist', 'kotu.example', { webrisk: sahte(ESL_SONUC) });
  esit('araç: listede', a1.listed, true);
  esit('araç: Türkçe tür adı', a1.threats[0].label, 'zararlı yazılım');
  esit('araç: bilgi bağlantısı', a1.threats[0].learnMore, webrisk.LEARN_MORE.MALWARE);
  esit('araç: atıf adresi', a1.advisoryUrl, webrisk.ADVISORY_URL);
  esit('araç: düzeltme fiyatı ₺5.000', a1.fixPrice, 5000);
  const a2 = await toolcheck.run('blacklist', 'temiz.example', { webrisk: sahte({ ok: true, uri: 'https://temiz.example/', threats: [] }) });
  esit('araç: temiz', a2.listed, false);
  esit('araç: temizde atıf yok', a2.advisoryUrl, null);
  esit('araç: temizde fiyat yok', a2.fixPrice, null);
  esit('araç: anahtar yok → unavailable', (await toolcheck.run('blacklist', 'a.com', { webrisk: sahte({ ok: false, reason: 'not_configured' }) })).code, 'unavailable');
  esit('araç: geçersiz adres', (await toolcheck.run('blacklist', '', { webrisk: sahte(ESL_SONUC) })).code, 'empty');
  esit('önbellek: eşleşme süreyi aşmaz', toolcheck.cacheSecondsFor(a1, 3600) <= 120 && toolcheck.cacheSecondsFor(a1, 3600) > 100, true);
  esit('önbellek: temiz varsayılan', toolcheck.cacheSecondsFor(a2, 3600), 3600);
  esit('önbellek: süresi geçmiş eşleşme 0', toolcheck.cacheSecondsFor(Object.assign({}, a1, { expireTime: '2000-01-01T00:00:00Z' }), 3600), 0);
  esit('önbellek: diğer türler etkilenmez', toolcheck.cacheSecondsFor({ type: 'ssl' }, 3600), 3600);

  /* --- PDF: süresi geçmiş eşleşme basılmaz --- */
  const simdi = Date.now();
  esit('PDF: süre içinde atıflı uyarı', /Advisory provided by Google/.test(report.findingMeta({ id: 'blacklist', expireTime: new Date(simdi + 60000).toISOString() }, 'tr', simdi)[1]), true);
  esit('PDF: süre geçmiş → yeniden tarayın', report.findingMeta({ id: 'blacklist', expireTime: '2000-01-01T00:00:00Z' }, 'tr', simdi)[2], 'Güncel durum için sitenizi yeniden tarayın.');
  esit('PDF: süre bilinmiyor → yeniden tarayın', report.findingMeta({ id: 'blacklist' }, 'en', simdi)[0], 'Blacklist check');
  esit('PDF: kesin dil yok', /Olası/.test(report.CHECKS.tr.blacklist[0]), true);

  /* --- E-posta özeti --- */
  const e = mailer.digestEmail([{ domain: 'kotu.example', kind: 'blacklist', severity: 'critical', data: { threats: ['SOCIAL_ENGINEERING'] } }]);
  esit('özet: olası dil', /olası oltalama/.test(e.text), true);
  esit('özet: atıf', /Advisory provided by Google/.test(e.text) && e.html.indexOf(webrisk.ADVISORY_URL) !== -1, true);
  esit('özet: bilgi bağlantısı', e.text.indexOf(webrisk.LEARN_MORE.SOCIAL_ENGINEERING) !== -1, true);
  esit('özet: hatalı pozitif/negatif notu', /hatayla işaretlenebilir/.test(e.text), true);
  const e2 = mailer.digestEmail([{ domain: 'a.com', kind: 'score_drop', severity: 'warning', data: { from: 90, to: 80 } }]);
  esit('özet: Google verisi yoksa atıf yok', /Advisory provided by Google/.test(e2.text), false);

  /* --- Sabah özeti: kara liste uyarısı göndermeden önce yeniden sorulur --- */
  const digest = require(path.join(API, 'cron', 'morning-digest.js'));
  const sorulan = [];
  const taze = await digest.tazeKaraListe([
    { domain: 'hala.example', kind: 'blacklist', data: { threats: ['MALWARE'], expireTime: '2000-01-01T00:00:00Z' } },
    { domain: 'temizlendi.example', kind: 'blacklist', data: { threats: ['MALWARE'] } },
    { domain: 'hala.example', kind: 'blacklist', data: {} },
    { domain: 'a.com', kind: 'score_drop', data: { from: 90, to: 80 } },
    { domain: 'dusen.example', kind: 'blacklist', data: { threats: ['MALWARE'] } }
  ], async function (adres) {
    sorulan.push(adres);
    if (/hala/.test(adres)) return { ok: true, threats: ['SOCIAL_ENGINEERING'], expireTime: '2030-01-01T00:00:00Z' };
    if (/dusen/.test(adres)) throw new Error('timeout');
    return { ok: true, threats: [] };
  });
  esit('özet: hâlâ eşleşen kalır, temizlenen ve sorulamayan çıkar', taze.map(function (a) { return a.domain + ':' + a.kind; }).join(' '),
    'hala.example:blacklist hala.example:blacklist a.com:score_drop');
  esit('özet: taze tür ve süre kullanılır', taze[0].data.threats.join() + ' ' + taze[0].data.expireTime, 'SOCIAL_ENGINEERING 2030-01-01T00:00:00Z');
  esit('özet: alan adı başına tek sorgu', sorulan.length, 3);

  if (hatalar.length) { console.error('Web Risk sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
  console.log('Web Risk sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (err) { console.error('sınama çöktü:', err && err.stack || err); process.exit(1); });
