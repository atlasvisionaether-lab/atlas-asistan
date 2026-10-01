'use strict';
/**
 * QStash imza doğrulamasını sınar. Ağdan bağımsız.
 *
 *   node tools/qstash-test.js
 *
 * NEDEN
 *
 * Haftalık tarama ucu açıkta duruyor ve bir tarama tetikliyor. Doğrulama
 * yanlışsa üçüncü biri bizim altyapımızı başka sitelere istek atmak için
 * kullanabilir. Sınanan şeyler sırayla:
 *
 *   1. Geçerli imza KABUL ediliyor (yoksa gerçek cron hiç çalışmaz).
 *   2. Yanlış anahtarla imzalanan istek reddediliyor.
 *   3. Döndürme anahtarı (NEXT) da kabul ediliyor — yoksa anahtar
 *      döndürmenin ortasında cron sessizce durur.
 *   4. Süresi geçmiş imza (`exp`) reddediliyor.
 *   5. Gövde özeti (`body`) uyuşmazsa reddediliyor: imzayı doğrulayıp
 *      gövdeyi doğrulamamak, imzalı bir isteğin gövdesini değiştirmeye
 *      izin verirdi.
 *   6. İmzacı (`iss`) Upstash değilse reddediliyor.
 *   7. Hiç anahtar yapılandırılmamışsa doğrulama BAŞARISIZ oluyor —
 *      "anahtar yok, o zaman geçsin" bir kapıyı tamamen açardı.
 */

const crypto = require('node:crypto');

const CURRENT = 'sig_current_anahtari_test';
const NEXT = 'sig_next_anahtari_test';

process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT;
process.env.QSTASH_NEXT_SIGNING_KEY = NEXT;

const qstash = require('../api/_lib/qstash.js');

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Test için QStash'in ürettiği biçimde bir JWT üretir. */
function jwt(claims, key) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = crypto.createHmac('sha256', key).update(header + '.' + payload).digest();
  return header + '.' + payload + '.' + b64url(sig);
}

function claims(extra) {
  const now = Math.floor(Date.now() / 1000);
  return Object.assign({
    iss: 'Upstash',
    sub: 'https://cyberlionai.com/api/cron/weekly-scan',
    iat: now,
    nbf: now - 5,
    exp: now + 300,
    jti: 'test-' + now,
    body: qstash.bodyHash('')
  }, extra || {});
}

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen)
              + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

console.log('QStash imza doğrulaması');

/* 1 */
sina('geçerli imza kabul ediliyor',
  qstash.verify(jwt(claims(), CURRENT), '').ok, true);

/* 2 */
sina('yanlış anahtarla imzalanan reddediliyor',
  qstash.verify(jwt(claims(), 'baska-bir-anahtar'), '').reason, 'signature_invalid');

/* 3 */
sina('döndürme anahtarı (NEXT) kabul ediliyor',
  qstash.verify(jwt(claims(), NEXT), '').ok, true);

/* 4 */
const now = Math.floor(Date.now() / 1000);
sina('süresi geçmiş imza reddediliyor',
  qstash.verify(jwt(claims({ exp: now - 600, nbf: now - 900, iat: now - 900 }), CURRENT), '').reason, 'expired');

/* 5 */
sina('gövde özeti uyuşmazsa reddediliyor',
  qstash.verify(jwt(claims(), CURRENT), '{"zararli":true}').reason, 'body_mismatch');

sina('doğru gövdeyle aynı imza geçiyor',
  qstash.verify(jwt(claims({ body: qstash.bodyHash('{"a":1}') }), CURRENT), '{"a":1}').ok, true);

/* 6 */
sina('başka imzacı reddediliyor',
  qstash.verify(jwt(claims({ iss: 'Kotu' }), CURRENT), '').reason, 'issuer_mismatch');

/* Biçim bozuklukları */
sina('imza başlığı yoksa reddediliyor', qstash.verify(null, '').reason, 'signature_missing');
sina('üç parçalı olmayan imza reddediliyor', qstash.verify('a.b', '').reason, 'signature_malformed');

/* 7 — anahtarsız durum. Modül anahtarları her çağrıda env'den okuyor. */
delete process.env.QSTASH_CURRENT_SIGNING_KEY;
delete process.env.QSTASH_NEXT_SIGNING_KEY;
sina('anahtar yoksa yapılandırılmamış sayılıyor', qstash.isConfigured(), false);
sina('anahtar yoksa doğrulama GEÇMİYOR',
  qstash.verify(jwt(claims(), CURRENT), '').reason, 'signing_keys_missing');

console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
process.exit(hata === 0 ? 0 : 1);
