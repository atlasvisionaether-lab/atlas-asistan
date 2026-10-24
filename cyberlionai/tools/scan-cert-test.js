'use strict';

/**
 * Geçersiz sertifikalı sitede tam tarama (api/_lib/scanner.js). Ağ yok:
 * fetch ve https.request taklit ediliyor.
 * Sabitlenen: sertifika doğrulama hatası `unreachable` DEĞİL `cert_invalid`
 * (sebep kodu taşınır); diğer bağlantı hataları eskisi gibi `unreachable`;
 * doğrulamasız okuma yalnızca istendiğinde ve yalnızca https'te yapılır,
 * rejectUnauthorized:false ile, guard'ın onayladığı adrese sabitlenerek;
 * yanıt başlıkları ve gövde fetch Response'u gibi okunur.
 */
const path = require('node:path');
const https = require('node:https');
const { Readable } = require('node:stream');
const scanner = require(path.join(__dirname, '..', 'api', '_lib', 'scanner.js'));
const toolcheck = require(path.join(__dirname, '..', 'api', '_lib', 'toolcheck.js'));

let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (b === e) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }

/* Genel IP yazılınca guard DNS'e sormaz; adres doğrudan onaylanır. */
const HEDEF = new URL('https://93.184.216.34/');

function fetchHatasi(kod) {
  return async function () { const e = new TypeError('fetch failed'); e.cause = { code: kod }; throw e; };
}

let istekSecenek = null; let istekSayisi = 0;
https.request = function (u, secenek, cb) {
  istekSayisi += 1; istekSecenek = secenek;
  const res = Readable.from([Buffer.from('<html><body>merhaba</body></html>')]);
  res.statusCode = 200;
  res.rawHeaders = ['Strict-Transport-Security', 'max-age=63072000', 'Content-Type', 'text/html'];
  process.nextTick(function () { cb(res); });
  return { on: function () { return this; }, end: function () {} };
};

(async function () {
  global.fetch = fetchHatasi('CERT_HAS_EXPIRED');
  let hata = null;
  try { await scanner.guardedFetch(HEDEF, {}); } catch (e) { hata = e; }
  esit('süresi dolmuş → cert_invalid', hata && hata.message, 'cert_invalid');
  esit('sebep kodu taşınır', hata && hata.certCode, 'CERT_HAS_EXPIRED');

  for (const kod of ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
    global.fetch = fetchHatasi(kod); hata = null;
    try { await scanner.guardedFetch(HEDEF, {}); } catch (e) { hata = e; }
    esit(kod + ' → cert_invalid', hata && hata.message, 'cert_invalid');
  }

  global.fetch = fetchHatasi('ECONNREFUSED'); hata = null;
  try { await scanner.guardedFetch(HEDEF, {}); } catch (e) { hata = e; }
  esit('bağlantı reddi eskisi gibi unreachable', hata && hata.message, 'unreachable');
  esit('doğrulamasız istek kendiliğinden yapılmaz', istekSayisi, 0);

  /* Doğrulamasız okuma */
  let fetchCagrildi = false;
  global.fetch = async function () { fetchCagrildi = true; throw new Error('çağrılmamalı'); };
  const r = await scanner.guardedFetch(HEDEF, { insecure: true });
  esit('insecure: fetch kullanılmaz', fetchCagrildi, false);
  esit('insecure: sertifika doğrulanmaz', istekSecenek.rejectUnauthorized, false);
  esit('insecure: SNI alan adı', istekSecenek.servername, '93.184.216.34');
  let sabit = null;
  istekSecenek.lookup('ornek.com', { all: true }, function (e, a) { sabit = a; });
  esit('insecure: onaylanan adrese sabit (all)', sabit && sabit[0].address, '93.184.216.34');
  istekSecenek.lookup('ornek.com', {}, function (e, a, aile) { sabit = a + '/' + aile; });
  esit('insecure: onaylanan adrese sabit (tek)', sabit, '93.184.216.34/4');
  esit('insecure: durum kodu', r.response.status, 200);
  esit('insecure: başlıklar', r.response.headers.get('strict-transport-security'), 'max-age=63072000');
  const reader = r.response.body.getReader();
  const parca = await reader.read();
  esit('insecure: gövde okunur', Buffer.from(parca.value).toString().indexOf('merhaba') !== -1, true);

  /* http adresinde insecure bayrağı anlamsız: normal fetch */
  fetchCagrildi = false; const once = istekSayisi;
  global.fetch = async function () { fetchCagrildi = true; return { status: 200, headers: new Headers(), body: null }; };
  await scanner.guardedFetch(new URL('http://93.184.216.34/'), { insecure: true });
  esit('http: normal fetch', fetchCagrildi, true);
  esit('http: doğrulamasız istek yok', istekSayisi, once);

  /* Başlık aracı: sertifika hatası "ulaşılamadı" değil */
  const t = await toolcheck.run('headers', 'ornek.com', { fetch: async function () { throw new Error('cert_invalid'); } });
  esit('başlık aracı cert_invalid', t.code, 'cert_invalid');

  if (hatalar.length) { console.error('Sertifika sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
  console.log('Sertifika sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (e) { console.error('sınama çöktü:', e && e.stack || e); process.exit(1); });
