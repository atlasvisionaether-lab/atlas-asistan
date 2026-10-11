'use strict';

/**
 * Zamanlanmış uçların (cron) kimlik doğrulaması — TEK uygulama.
 *
 * İki çağıran, iki doğrulama (ikisi de isteğe bağlı DEĞİL):
 *   - QStash: POST + `Upstash-Signature` JWT (QSTASH_*_SIGNING_KEY).
 *   - Vercel Cron: GET + `Authorization: Bearer <CRON_SECRET>`.
 * Hiçbiri yapılandırılmamışsa uç 503 ile kapanır (fail-closed): açık bir
 * tarama tetikleyicisi, altyapımızı başka sitelere istek atmak için
 * kullandırırdı. Anahtar, imza ve sır LOGLANMAZ.
 */

const crypto = require('node:crypto');
const qstash = require('./qstash.js');

/** Ham gövde. İmza gövde özetini kapsıyor; bu uçlar gövde beklemiyor. */
function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) return null;
  return '';
}

function cronSecretOk(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = String((req.headers && req.headers.authorization) || '');
  const expected = 'Bearer ' + secret;
  if (header.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * @returns {{ok: true, via: 'qstash'|'cron'} | {ok: false, status: number, code: string}}
 */
function authorize(req) {
  const hasQstash = qstash.isConfigured();
  const hasCronSecret = typeof process.env.CRON_SECRET === 'string' && process.env.CRON_SECRET.length > 0;
  if (!hasQstash && !hasCronSecret) return { ok: false, status: 503, code: 'cron_unconfigured' };

  const signature = (req.headers && (req.headers['upstash-signature'] || req.headers['Upstash-Signature'])) || null;
  if (signature) {
    const raw = readRawBody(req);
    if (raw === null) return { ok: false, status: 400, code: 'unexpected_body' };
    const check = qstash.verify(String(signature), raw);
    if (!check.ok) {
      if (console && console.warn) console.warn('cron: signature rejected -', check.reason);
      return { ok: false, status: 401, code: 'invalid_signature' };
    }
    return { ok: true, via: 'qstash' };
  }
  if (cronSecretOk(req)) return { ok: true, via: 'cron' };
  return { ok: false, status: 401, code: 'unauthorized' };
}

module.exports = { authorize, readRawBody, cronSecretOk };
