'use strict';

/**
 * QStash (Upstash) istek imzası doğrulama.
 *
 * ÖNEMLİ — HANGİ ANAHTAR NEYE YARAR
 *
 * `QSTASH_TOKEN` bir YAYINLAMA anahtarıdır: QStash'e "şu adrese şu zamanlarda
 * istek at" demek için kullanılır. Gelen isteğin gerçekten QStash'ten geldiğini
 * doğrulamak için KULLANILAMAZ. Doğrulama, QStash'in `Upstash-Signature`
 * başlığındaki JWT'yi imzaladığı AYRI anahtarlarla yapılır:
 *
 *   QSTASH_CURRENT_SIGNING_KEY
 *   QSTASH_NEXT_SIGNING_KEY     (anahtar döndürme sırasında kullanılır)
 *
 * İkisi de Upstash konsolunda QStash sayfasındadır. İkisi birden denenir,
 * çünkü döndürme anında yolda olan istek eski anahtarla imzalanmış olabilir.
 *
 * Doğrulanan şeyler: imza (HMAC-SHA256), `exp`/`nbf` zaman pencereleri,
 * `iss` (Upstash) ve gövde özeti (`body` claim'i). Gövde özeti ATLANMIYOR:
 * imzayı doğrulayıp gövdeyi doğrulamamak, imzalı bir isteğin gövdesini
 * değiştirip tekrar göndermeye izin verirdi.
 *
 * Bu uç gövde BEKLEMİYOR. Haftalık taramanın girdisi yok: kimin taranacağı
 * veritabanından okunuyor, istekten değil. Boş olmayan gövde reddediliyor —
 * böylece gövde özetini ham gövde olmadan doğrulamak zorunda kalmıyoruz
 * (Vercel gövdeyi ayrıştırıp ham halini düşürüyor, yeniden kurmak kayıplı).
 */

const crypto = require('node:crypto');

/* Saat kayması toleransı. QStash'in ve bizim sunucunun saatleri birkaç saniye
   kayabilir; sıfır tolerans geçerli isteği reddederdi. */
const CLOCK_TOLERANCE_SECONDS = 15;

function b64urlToBuffer(part) {
  const normalized = String(part).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function signingKeys() {
  return [
    process.env.QSTASH_CURRENT_SIGNING_KEY,
    process.env.QSTASH_NEXT_SIGNING_KEY
  ].filter(function (k) { return typeof k === 'string' && k.length > 0; });
}

function isConfigured() { return signingKeys().length > 0; }

/** Gövdenin QStash'in `body` claim'indeki biçimde özeti (base64url sha256). */
function bodyHash(raw) {
  return crypto.createHash('sha256').update(raw || '', 'utf8').digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} signature  `Upstash-Signature` başlığı
 * @param {string} rawBody    ham gövde (bu uçta '' bekleniyor)
 * @returns {{ ok: true, claims: object } | { ok: false, reason: string }}
 */
function verify(signature, rawBody) {
  const keys = signingKeys();
  if (!keys.length) return { ok: false, reason: 'signing_keys_missing' };
  if (typeof signature !== 'string' || !signature) return { ok: false, reason: 'signature_missing' };

  const parts = signature.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'signature_malformed' };

  const signingInput = parts[0] + '.' + parts[1];
  const provided = b64urlToBuffer(parts[2]);

  /* Anahtarlar sırayla denenir ve karşılaştırma SABİT ZAMANLI:
     `===` ile karşılaştırmak imzayı bayt bayt tahmin etmeye kapı açar. */
  const matched = keys.some(function (key) {
    const expected = crypto.createHmac('sha256', key).update(signingInput).digest();
    return expected.length === provided.length
      && crypto.timingSafeEqual(expected, provided);
  });
  if (!matched) return { ok: false, reason: 'signature_invalid' };

  let claims;
  try {
    claims = JSON.parse(b64urlToBuffer(parts[1]).toString('utf8'));
  } catch (err) {
    return { ok: false, reason: 'claims_malformed' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && now > claims.exp + CLOCK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof claims.nbf === 'number' && now + CLOCK_TOLERANCE_SECONDS < claims.nbf) {
    return { ok: false, reason: 'not_yet_valid' };
  }
  if (claims.iss && claims.iss !== 'Upstash') {
    return { ok: false, reason: 'issuer_mismatch' };
  }
  if (typeof claims.body === 'string' && claims.body) {
    if (claims.body !== bodyHash(rawBody)) return { ok: false, reason: 'body_mismatch' };
  }

  return { ok: true, claims: claims };
}

module.exports = { verify, bodyHash, isConfigured, CLOCK_TOLERANCE_SECONDS };
