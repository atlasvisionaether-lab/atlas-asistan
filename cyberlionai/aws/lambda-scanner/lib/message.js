'use strict';

/**
 * Kuyruk mesajının ayrıştırılması ve hata kodu sadeleştirme.
 *
 * NEDEN AYRI DOSYA
 *
 * `index.js` ilk satırında tarama motorunu yüklüyor; motor paket içine
 * `build.sh` tarafından kopyalanıyor ve depoda durmuyor. Bu saf işlevler
 * `index.js` içinde kalsaydı, onları sınamak için önce paketi üretmek
 * gerekirdi — sınama o zaman kendi girdisini üreten bir adıma bağımlı olur
 * ve CI'da sıra değiştiğinde sessizce kırılırdı (bir kez kırıldı).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Yeniden denenmesi anlamlı olan hatalar.
 *
 * Kullanıcı kaynaklı hatalar (geçersiz adres, engelli hedef, bozuk mesaj)
 * BURADA YOK: her denemede aynı sonucu verirler ve mesaj kuyruk ömrü boyunca
 * dönüp durur.
 */
const RETRYABLE = [
  'timeout', 'unreachable', 'bad_redirect', 'too_many_redirects', 'dns_failed',
  'db_unreachable', 's3_unreachable'
];

/** Hata kodunu şemanın kabul ettiği kısa koda indirir (serbest metin yazılmaz). */
function errorCode(err) {
  const ham = String((err && err.message) || 'scan_failed');
  const kod = ham.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  return kod || 'scan_failed';
}

/**
 * SQS mesajını okur ve doğrular.
 *
 * İş kimliği UUID olmak ZORUNDA: kuyruğa iş bırakabilen biri serbest bir
 * dize gönderip PostgREST süzgecine girdi vermeye çalışabilir.
 */
function parseMessage(record) {
  let payload;
  try {
    payload = JSON.parse(record.body);
  } catch (e) {
    throw new Error('bad_message');
  }
  const scanId = payload && (payload.scan_id || payload.scanId);
  if (!UUID_RE.test(String(scanId || ''))) throw new Error('bad_scan_id');
  if (!payload.url) throw new Error('empty');
  return {
    scanId: String(scanId),
    url: String(payload.url),
    userId: payload.user_id || payload.userId || null,
    consent: payload.consent === true
  };
}

module.exports = { parseMessage, errorCode, RETRYABLE, UUID_RE };
