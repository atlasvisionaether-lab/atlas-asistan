'use strict';

/**
 * Supabase Storage'a yazma (servis rolü).
 *
 * Neden `db.js`'in içinde değil: `db.request()` yolu `/rest/v1/` ile sabit ve
 * gövdeyi JSON'a çeviriyor. Storage `/storage/v1/` altında ve ikili gövde
 * alıyor. İki ayrı sözleşme, iki ayrı dosya.
 *
 * KOVA GİZLİ KALIYOR. Buraya yüklenen PDF herkese açık adresten okunmuyor;
 * müşteri raporu, S3 yolunda olduğu gibi (bkz. docs/scan-queue.md) ya
 * oturumla ya da imzalı adresle iniyor. `publicUrl()` bilerek YOK: bir
 * "genel adres" yardımcısı, kovanın bir gün yanlışlıkla public yapılması
 * hâlinde sızıntıyı normalleştirirdi.
 *
 * Servis rolü anahtarı loglanmıyor; hata metni 200 karaktere kırpılıyor.
 */

const TIMEOUT_MS = 10000;
const BUCKET = 'reports';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key: key } : null;
}

function isConfigured() { return config() !== null; }

/** Yol gezinmesi (`..`), baştaki `/` ve boş parça kabul edilmiyor. */
function guvenliYol(key) {
  const s = String(key || '');
  if (!s || s.length > 300) return null;
  if (!/^[A-Za-z0-9._\/-]+$/.test(s)) return null;
  if (s.indexOf('//') !== -1 || s.charAt(0) === '/') return null;
  if (s.split('/').some(function (p) { return p === '' || p === '.' || p === '..'; })) return null;
  return s;
}

/**
 * PDF'i kovaya koyar. Aynı yola tekrar yazmak ÜZERİNE YAZAR (`x-upsert`):
 * yeniden üretim kovada ikinci bir kopya biriktirmiyor.
 *
 * @param {string} key kova içindeki yol, ör. 'ai/<jobId>.pdf'
 * @param {Buffer} buffer
 * @param {string} [contentType]
 * @returns {Promise<{ok: true, key: string, bytes: number}>}
 * @throws Error('storage_not_configured'|'storage_bad_key'|'storage_bad_body'
 *   |'storage_unreachable'|'storage_error_<kod>')
 */
async function upload(key, buffer, contentType) {
  const cfg = config();
  if (!cfg) throw new Error('storage_not_configured');

  const yol = guvenliYol(key);
  if (!yol) throw new Error('storage_bad_key');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('storage_bad_body');

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(cfg.url + '/storage/v1/object/' + BUCKET + '/' + yol, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'apikey': cfg.key,
        'Authorization': 'Bearer ' + cfg.key,
        'Content-Type': contentType || 'application/pdf',
        'Cache-Control': 'no-store',
        'x-upsert': 'true'
      },
      body: buffer
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('storage_unreachable');
  }
  clearTimeout(timer);

  if (!response.ok) {
    const text = await response.text().catch(function () { return ''; });
    if (console && console.error) console.error('storage error', response.status, String(text).slice(0, 200));
    throw new Error('storage_error_' + response.status);
  }

  return { ok: true, key: yol, bytes: buffer.length };
}

module.exports = { upload, isConfigured, guvenliYol, BUCKET, TIMEOUT_MS };
