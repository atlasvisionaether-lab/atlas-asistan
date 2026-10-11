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

/**
 * SQS yeniden teslim sınırı. Kuyruğun redrive ilkesindeki `maxReceiveCount`
 * ile AYNI olmalı (bkz. docs/scan-queue.md); ortam değişkeniyle verilmezse
 * belgelenen değer varsayılır.
 */
const DEFAULT_MAX_RECEIVE = 3;

/** Bu mesajın kaçıncı teslimi olduğu. SQS 1'den başlar. */
function receiveCount(record) {
  const n = parseInt(
    (record && record.attributes && record.attributes.ApproximateReceiveCount) || '', 10);
  return n > 0 ? n : 1;
}

function maxReceiveCount(env) {
  const n = parseInt((env || {}).SQS_MAX_RECEIVE_COUNT, 10);
  return n > 0 ? n : DEFAULT_MAX_RECEIVE;
}

/**
 * Hatadan sonra ne yapılacağı: mesaj kuyruğa geri mi dönecek, ve iş satırına
 * hangi yama yazılacak.
 *
 * KRİTİK: yeniden denenecek bir hatada iş satırına 'failed' YAZILMAZ.
 * Yazılsaydı, istemci (`/api/scan-status` yoklaması) mesaj SQS tarafından
 * yeniden teslim edilmeden önce terminal bir başarısızlık görür ve çalışmaya
 * devam eden —büyük olasılıkla başarıyla bitecek— bir taramayı kullanıcıya
 * başarısız diye gösterirdi. Bu yüzden deneme hakkı varken satır 'queued'a
 * (terminal olmayan durum) geri alınır; hata kodu teşhis için yazılır ama
 * `completed_at` boş bırakılır. 'failed' yalnızca deneme hakkı tükendiğinde
 * ya da hata hiç yeniden denenmeyecek türdense yazılır.
 */
function retryDecision(kod, record, env) {
  if (kod === 'job_not_found') return { retry: false, patch: null };

  const denenebilir = RETRYABLE.indexOf(kod) !== -1;
  const hakVar = receiveCount(record) < maxReceiveCount(env);

  if (denenebilir && hakVar) {
    return {
      retry: true,
      patch: { status: 'queued', error_code: kod, completed_at: null }
    };
  }

  /* Deneme hakkı tükendi: mesaj bu turda da başarısız bildirilirse SQS onu
     DLQ'ya alır, yani bir daha gelmez. Satır artık terminal. */
  return {
    retry: denenebilir,
    patch: { status: 'failed', error_code: kod, completed_at: new Date().toISOString() }
  };
}

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

module.exports = {
  parseMessage, errorCode, RETRYABLE, UUID_RE,
  retryDecision, receiveCount, maxReceiveCount, DEFAULT_MAX_RECEIVE
};
