'use strict';

/**
 * AWS Signature Version 4 — yalnızca `node:crypto` ile.
 *
 * NEDEN SDK YOK
 *
 * Bu Lambda'nın AWS'den tek ihtiyacı S3'e bir nesne koymak. `@aws-sdk/client-s3`
 * bunun için onlarca megabayt bağımlılık ve kendi yeniden deneme/kimlik
 * zinciri getiriyor; imzanın kendisi ise yüz satır. Bağımlılık yok demek
 * tedarik zinciri yüzeyi yok demek: bu depoda tarayıcı tarafında da aynı
 * karar verildi (Chart.js yerine inline SVG).
 *
 * İMZA NEYİ KAPSAR
 *
 * Yöntem, yol, sıralı sorgu dizesi, imzalanan başlıklar ve GÖVDE ÖZETİ.
 * Gövde özeti atlanmıyor (`UNSIGNED-PAYLOAD` kullanılmıyor): imzalı bir
 * isteğin gövdesini değiştirip tekrar göndermeye izin verirdi.
 *
 * GİZLİ ANAHTAR ASLA LOGLANMAZ. Bu dosyada hiçbir `console` çağrısı yok ve
 * hata nesnelerine anahtar konmuyor; `sign()` yalnızca başlık döndürür.
 */

const crypto = require('node:crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986. AWS, `encodeURIComponent`'in bıraktığı ! * ' ( ) karakterlerini de ister. */
function uriEncode(value, encodeSlash) {
  const encoded = encodeURIComponent(String(value))
    .replace(/[!'()*]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  return encodeSlash ? encoded : encoded.replace(/%2F/g, '/');
}

/**
 * Zaman damgası: AWS `20260102T030405Z` biçimini ister, ISO'nun ayraçlarını
 * değil. `Date` nesnesi dışarıdan alınıyor, böylece sınama sabit bir anı
 * verebiliyor ve imza yeniden üretilebilir oluyor.
 */
function amzDate(date) {
  return date.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
}

/**
 * İstek için `Authorization` ve `x-amz-*` başlıklarını üretir.
 *
 * @param {object} req  { method, host, path, query, headers, body, service, region,
 *                        contentSha256Header? }
 * @param {object} creds { accessKeyId, secretAccessKey, sessionToken? }
 * @returns {object} gönderilecek başlıklar (girdideki başlıklar korunur)
 */
function sign(req, creds, now) {
  if (!creds || !creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error('aws_credentials_missing');
  }

  const date = now || new Date();
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const body = req.body === undefined || req.body === null ? '' : req.body;
  const payloadHash = sha256Hex(body);

  const headers = Object.assign({}, req.headers || {});
  headers['host'] = req.host;
  headers['x-amz-date'] = stamp;
  /* S3 bu başlığı ZORUNLU tutuyor, SQS tutmuyor ve imzaya giren başlık
     kümesini değiştirdiği için her isteğe körlemesine eklenmiyor: eklenirse
     AWS'in yayınladığı `get-vanilla` sınama vektörü ile imza karşılaştırması
     yapılamaz hâle gelir (bkz. tools/sigv4-test.js). */
  if (req.contentSha256Header !== false) headers['x-amz-content-sha256'] = payloadHash;
  if (creds.sessionToken) headers['x-amz-security-token'] = creds.sessionToken;

  /* Kanonik başlıklar: adlar küçük harf, değerlerin baş/son boşluğu atılır,
     iç boşluklar teke indirilir, ada göre sıralanır. */
  const names = Object.keys(headers).map(function (n) { return n.toLowerCase(); }).sort();
  const canonicalHeaders = names.map(function (n) {
    const key = Object.keys(headers).find(function (k) { return k.toLowerCase() === n; });
    return n + ':' + String(headers[key]).trim().replace(/\s+/g, ' ') + '\n';
  }).join('');
  const signedHeaders = names.join(';');

  /* Sorgu dizesi anahtara göre sıralı ve ikisi de kodlanmış olmalı. */
  const query = req.query || {};
  const canonicalQuery = Object.keys(query).sort().map(function (k) {
    return uriEncode(k, true) + '=' + uriEncode(query[k], true);
  }).join('&');

  const canonicalPath = String(req.path || '/').split('/').map(function (seg) {
    return uriEncode(seg, true);
  }).join('/');

  const canonicalRequest = [
    req.method, canonicalPath, canonicalQuery,
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const scope = day + '/' + req.region + '/' + req.service + '/aws4_request';
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(
    'AWS4' + creds.secretAccessKey, day), req.region), req.service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] = ALGORITHM
    + ' Credential=' + creds.accessKeyId + '/' + scope
    + ', SignedHeaders=' + signedHeaders
    + ', Signature=' + signature;

  return headers;
}

/**
 * S3 GET için SÜRELİ, sorgu dizgesinde imzalı adres (presigned URL) üretir.
 *
 * NEDEN BURADA
 *
 * İmzayı yayında Supabase Edge Function atıyor (`supabase/functions/
 * sign-report`), çünkü AWS gizli anahtarı yalnızca orada. Ama Deno kaynağı bu
 * ortamda ÇALIŞTIRILAMIYOR. Bu işlev aynı algoritmanın çalıştırılabilir
 * kopyası: imzalama anahtarı türetimini ve `stringToSign` biçimini, resmî AWS
 * vektörleriyle doğrulanmış `sign()` ile AYNI ilkellerden kuruyor, dolayısıyla
 * sınama onu gerçekten koşturup karşılaştırabiliyor. İki kopya ayrışırsa
 * `tools/reportsign-test.js` düşer.
 *
 * Başlık imzalı istekten iki fark: imza sorgu dizgesine giriyor (tarayıcı 302
 * sonrası Authorization başlığı ekleyemez) ve gövde özeti `UNSIGNED-PAYLOAD`.
 *
 * @param {object} req  { bucket, key, region, expiresIn, host? }
 * @param {object} creds { accessKeyId, secretAccessKey, sessionToken? }
 * @param {Date} now
 * @returns {string} imzalı tam adres
 */
function presignS3Get(req, creds, now) {
  const stamp = amzDate(now || new Date());
  const day = stamp.slice(0, 8);
  const host = req.host || (req.bucket + '.s3.' + req.region + '.amazonaws.com');
  const scope = day + '/' + req.region + '/s3/aws4_request';

  /* Kanonik sorgu parametreleri ADA GÖRE SIRALI olmak zorunda; sıra bozulursa
     imza S3'ün hesapladığıyla eşleşmez. */
  const params = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', creds.accessKeyId + '/' + scope],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(req.expiresIn)],
    ['X-Amz-SignedHeaders', 'host']
  ];
  if (creds.sessionToken) params.push(['X-Amz-Security-Token', creds.sessionToken]);
  params.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });

  const canonicalQuery = params.map(function (p) {
    return uriEncode(p[0], true) + '=' + uriEncode(p[1], true);
  }).join('&');

  /* Yol parçaları ayrı ayrı kodlanır, '/' ayırıcı olarak korunur. */
  const canonicalPath = '/' + String(req.key).split('/').map(function (p) {
    return uriEncode(p, true);
  }).join('/');

  const canonicalRequest = [
    'GET', canonicalPath, canonicalQuery,
    'host:' + host + '\n', 'host', 'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(
    'AWS4' + creds.secretAccessKey, day), req.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8').digest('hex');

  return 'https://' + host + canonicalPath + '?' + canonicalQuery
    + '&X-Amz-Signature=' + signature;
}

/**
 * Ortamdan kimlik okur. Lambda'da bu üçlüyü yürütme ortamı KENDİSİ koyar
 * (görev rolünden); elle ortam değişkeni girmek gerekmez ve girilmemeli.
 * `AWS_ACCESS_KEY_ID` yerel sınama için okunur.
 */
function credentialsFromEnv(env) {
  const e = env || process.env;
  const id = e.AWS_ACCESS_KEY_ID || e.AWS_ACCESS_KEY || '';
  const secret = e.AWS_SECRET_ACCESS_KEY || '';
  if (!id || !secret) return null;
  return {
    accessKeyId: id,
    secretAccessKey: secret,
    sessionToken: e.AWS_SESSION_TOKEN || null
  };
}

module.exports = {
  sign, presignS3Get, credentialsFromEnv, amzDate, uriEncode, sha256Hex, ALGORITHM
};
