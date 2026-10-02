'use strict';

/**
 * Kuyruğa iş bırakmanın TEK uygulaması.
 *
 * NEDEN AYRI DOSYA
 *
 * Kuyruklu taramanın İKİ istemcisi var ve ikisi de yayında:
 *   - `POST /api/scan`         → 202 + { jobId }  (eski sözleşme)
 *   - `POST /api/enqueue-scan` → 200 + { scanId } (ana sayfanın kullandığı)
 * İkisi de aynı adımları yürütmek zorunda: hedefi doğrula, `scan_jobs`
 * satırını aç, mesajı Edge Function üzerinden SQS'e bırak, satırı 'queued'
 * yaz. Bu adımlar iki dosyada ayrı ayrı dursaydı biri düzeltilip öteki
 * unutulurdu — kota iadesi ya da hedef doğrulaması tek yolda kalır ve fark
 * ancak yayında görünürdü. Uçlar artık yalnızca YANIT BİÇİMİNDE ayrışıyor.
 *
 * KOTA İADESİ ÇAĞIRANA AİT: hak bu modül çağrılmadan önce ayrılıyor, kimin
 * neyi ayırdığını bilen de çağıran. Her hata yolunda `refund` çağrılır.
 */

const { normalizeTarget } = require('./guard.js');
const scanqueue = require('./scanqueue.js');
const db = require('./db.js');

/** Hedef doğrulama hatalarının HTTP karşılıkları (api/scan.js ile aynı). */
const ERROR_STATUS = {
  empty: 400, invalid_url: 400, too_long: 400, bad_protocol: 400,
  credentials_not_allowed: 400, blocked_port: 400, dns_failed: 400,
  blocked_target: 403,
  timeout: 504, unreachable: 502, bad_redirect: 502, too_many_redirects: 502
};

/** Kuyruk yolu bu istek için gerçekten çalışır durumda mı. */
function isAvailable() {
  return scanqueue.isEnabled() && scanqueue.isConfigured() && db.isConfigured();
}

/**
 * İşi kuyruğa bırakır.
 *
 * @param {{url: string, consent: boolean, owner: object, ip: string,
 *          refund: function(): Promise}} input
 * @returns {Promise<{ok: true, jobId: string, host: string, url: string}
 *                 | {ok: false, status: number, code: string}>}
 */
async function startQueuedScan(input) {
  const refund = async function () {
    try { await input.refund(); } catch (e) { /* iade edilemedi */ }
  };

  if (!isAvailable()) {
    /* Bayrak açık ama kuyruk ya da veritabanı yapılandırılmamış. Eşzamanlı
       yola BURADA düşülmüyor: iki yol aynı istekte karışırsa hangisinin
       çalıştığı belirsizleşir ve yanlış yapılandırma sessizce gizlenir. */
    await refund();
    return { ok: false, status: 503, code: 'service_unavailable' };
  }

  /* Hedef kuyruğa bırakılmadan ÖNCE doğrulanıyor: geçersiz ya da engelli bir
     adres için satır açıp Lambda'yı uyandırmak gereksiz, ve hata kullanıcıya
     hemen dönebilir. */
  const target = normalizeTarget(input.url);
  if (target.error) {
    await refund();
    return { ok: false, status: ERROR_STATUS[target.error] || 400, code: target.error };
  }

  let jobId = null;
  try {
    jobId = await db.createPendingJob(
      { host: target.host, url: target.url.href },
      { userId: input.owner.userId, sessionId: input.owner.sessionId, ip: input.ip },
      input.consent);
  } catch (err) {
    if (console && console.error) console.error('job create failed:', err.message);
  }
  if (!jobId) {
    await refund();
    return { ok: false, status: 503, code: 'service_unavailable' };
  }

  try {
    await scanqueue.enqueue({
      url: target.url.href, userId: input.owner.userId, scanId: jobId,
      consent: input.consent
    });
  } catch (err) {
    /* Satır açıldı ama mesaj kuyruğa gitmedi. İş 'pending' bırakılmıyor:
       hiç işlenmeyecek bir iş, kullanıcının sonsuza kadar yokladığı bir iş
       demek. 'failed' yazılıyor ve hak geri veriliyor. */
    const kod = (err && err.message) || 'queue_rejected';
    try { await db.markJobFailed(jobId, kod); } catch (e) { /* yazılamadı */ }
    await refund();
    if (console && console.error) console.error('enqueue failed:', kod);
    return { ok: false, status: 503, code: 'service_unavailable' };
  }

  try { await db.markJobQueued(jobId); } catch (e) { /* durum yazılamadı, iş yolda */ }

  return { ok: true, jobId: jobId, host: target.host, url: target.url.href };
}

module.exports = { startQueuedScan, isAvailable, ERROR_STATUS };
