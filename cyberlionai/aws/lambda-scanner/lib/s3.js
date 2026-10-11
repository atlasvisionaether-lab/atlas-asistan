'use strict';

/**
 * S3'e nesne koyma — imzalı tek bir PUT.
 *
 * Nesneler GENEL OKUNUR YAPILMIYOR. Rapor bir güvenlik taramasının çıktısı:
 * hangi başlığın eksik olduğunu, TLS yapılandırmasını, bazen bulgu
 * kanıtlarını taşıyor. Tahmin edilebilir bir adreste herkese açık bırakmak
 * müşterinin zafiyet listesini internete koymak demek. Bu yüzden:
 *
 *   - ACL gönderilmiyor (bucket zaten "Block Public Access" ile açılıyor),
 *   - sunucu tarafı şifreleme isteniyor (AES256),
 *   - veritabanına yazılan `report_url` imzasız, yani doğrudan açılamaz;
 *     anahtar (`report_key`) ayrı tutulur ve indirme anında imzalanır.
 *
 * Anahtar biçimi: reports/<yyyy>/<mm>/<jobId>.pdf — iş kimliği UUID olduğu
 * için tahmin edilemez ve tarihe göre yaşam döngüsü kuralı yazılabilir.
 */

const sigv4 = require('./sigv4.js');

const TIMEOUT_MS = 10000;

function reportKey(jobId, date) {
  const d = date || new Date();
  const yil = String(d.getUTCFullYear());
  const ay = String(d.getUTCMonth() + 1).padStart(2, '0');
  return 'reports/' + yil + '/' + ay + '/' + jobId + '.pdf';
}

/**
 * @param {Buffer} body   PDF içeriği
 * @returns {Promise<{key: string, url: string}>}
 */
async function putReport(jobId, body, options) {
  const opts = options || {};
  const bucket = opts.bucket || process.env.S3_BUCKET;
  const region = opts.region || process.env.AWS_REGION || 'eu-central-1';
  if (!bucket) throw new Error('s3_bucket_missing');

  const creds = opts.credentials || sigv4.credentialsFromEnv();
  if (!creds) throw new Error('aws_credentials_missing');

  const key = reportKey(jobId, opts.date);
  const host = bucket + '.s3.' + region + '.amazonaws.com';

  const headers = sigv4.sign({
    method: 'PUT',
    host: host,
    path: '/' + key,
    query: {},
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(body.length),
      'x-amz-server-side-encryption': 'AES256'
    },
    body: body,
    service: 's3',
    region: region
  }, creds);

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  let response;
  try {
    response = await fetch('https://' + host + '/' + key, {
      method: 'PUT', headers: headers, body: body, signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('s3_unreachable');
  }
  clearTimeout(timer);

  if (!response.ok) {
    /* Yanıt gövdesi S3'in XML hatası; anahtar ya da imza İÇERMEZ, bu yüzden
       durum kodu loglanabilir. Gövde loglanmıyor: bucket adı ve nesne
       anahtarı taşıyor. */
    throw new Error('s3_put_failed_' + response.status);
  }

  return { key: key, url: 'https://' + host + '/' + key };
}

module.exports = { putReport, reportKey };
