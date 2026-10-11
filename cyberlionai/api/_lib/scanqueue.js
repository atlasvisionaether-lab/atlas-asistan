'use strict';

/**
 * Kuyruk katmanı — Vercel tarafı.
 *
 * Vercel SQS'i TANIMAZ. AWS gizli anahtarı burada yok; istek Supabase Edge
 * Function'a (`enqueue-scan`) gidiyor, SQS'e mesajı o bırakıyor. Anahtar tek
 * platformda durduğu için döndürülecek yer de tek.
 *
 * AÇMA/KAPAMA
 *
 * `SCAN_QUEUE_ENABLED` 'true' değilse kuyruk KAPALI ve `/api/scan` eski
 * eşzamanlı davranışını aynen sürdürür. Bu bilinçli: kuyruk yolu AWS
 * kaynakları (SQS, S3, Lambda) yayına alınmadan çalışamaz ve bayrak olmasa
 * ara durumda ana sayfadaki tarayıcı çalışmaz hâle gelirdi. Bayrak açılmadan
 * önce Lambda'nın gerçekten mesaj tükettiği doğrulanmalı.
 *
 * ORTAM DEĞİŞKENLERİ (değerleri konsolda girilir, depoda DURMAZ)
 *   SCAN_QUEUE_ENABLED      'true' | yok
 *   SUPABASE_URL            zaten var
 *   SUPABASE_SERVICE_ROLE_KEY  zaten var — Edge Function çağrısının yetkisi
 *   ENQUEUE_SHARED_SECRET   Edge Function'daki aynı değer
 *
 * HİÇBİR ANAHTAR LOGLANMAZ. Hata yollarında yalnızca durum kodu yazılır.
 */

const TIMEOUT_MS = 6000;
const FUNCTION_NAME = 'enqueue-scan';

function isEnabled() {
  return String(process.env.SCAN_QUEUE_ENABLED || '').toLowerCase() === 'true';
}

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.ENQUEUE_SHARED_SECRET;
  return url && key && secret
    ? { url: url.replace(/\/+$/, ''), key: key, secret: secret }
    : null;
}

/** Bayrak açık AMA yapılandırma eksikse kuyruk kullanılamaz; çağıran bilmeli. */
function isConfigured() { return config() !== null; }

/**
 * İşi kuyruğa bırakır.
 *
 * @returns {Promise<void>} başarılıysa sessiz döner
 * @throws {Error} 'queue_unconfigured' | 'queue_unreachable' | 'queue_rejected'
 */
async function enqueue(job) {
  const cfg = config();
  if (!cfg) throw new Error('queue_unconfigured');

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(cfg.url + '/functions/v1/' + FUNCTION_NAME, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + cfg.key,
        'Content-Type': 'application/json',
        'x-cl-enqueue-secret': cfg.secret
      },
      body: JSON.stringify({
        url: job.url,
        user_id: job.userId || null,
        scan_id: job.scanId,
        consent: job.consent === true
      })
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('queue_unreachable');
  }
  clearTimeout(timer);

  if (!response.ok) {
    if (console && console.error) console.error('enqueue rejected', response.status);
    throw new Error('queue_rejected');
  }
}

module.exports = { isEnabled, isConfigured, enqueue, FUNCTION_NAME };
