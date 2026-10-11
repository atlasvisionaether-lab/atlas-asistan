'use strict';

/**
 * iyzico webhook'u — abonelik durumu değiştiğinde.
 *
 *   POST /api/webhooks/iyzico
 *
 * NE YAPIYOR, NE YAPMIYOR
 *
 * Var olan abonelik satırının durumunu güncelliyor. YENİ SATIR AÇMIYOR:
 * aboneliğin hangi hesaba ait olduğunu söyleyen eşleme ödeme dönüşünde
 * (`/api/checkout-return`, oturumlu istek) kuruluyor. Eşlemesi olmayan bir
 * referans için satır açmak, aboneliği rastgele bir hesaba yazmak olurdu.
 * Bu yüzden eşleşmeyen webhook 200 ile onaylanıp yok sayılıyor — iyzico'nun
 * yeniden denemesini durdurmak için 200, ama hiçbir şey yazılmıyor.
 *
 * İKİ KATMAN
 *
 * 1. İmza (`X-Iyz-Signature-V3`) doğrulanıyor. Geçmezse 401 ve hiçbir şey
 *    yazılmıyor.
 * 2. İmza geçse bile GÖVDEYE GÜVENİLMİYOR: abonelik durumu iyzico'ya sorulup
 *    oradan okunuyor. Abonelik olaylarının imza alan listesi hiçbir resmi
 *    istemcide belgelenmemiş (doküman sitesi bu ortamın ağ ilkesinde kapalı);
 *    doğrulamayı tek dayanak yapmak, alan sırası farklıysa sessizce yanlış
 *    karar vermek olurdu. Yazma kararı her hâlükârda iyzico'nun cevabına
 *    dayanıyor.
 *
 * SERVİS ROLÜ
 *
 * Yazma servis rolüyle yapılıyor; `cl_subscriptions` tablosunda anon ya da
 * authenticated INSERT/UPDATE policy'si bilerek YOK.
 *
 * NE LOGLANMIYOR
 *
 * İmza, jeton, anahtarlar ve ödeme kimlikleri LOGLANMIYOR; yalnızca olay türü
 * ve sebep kodu.
 */

const db = require('../_lib/db.js');
const iyzico = require('../_lib/iyzico.js');

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return null; }
  }
  if (Buffer.isBuffer(body)) {
    try { body = JSON.parse(body.toString('utf8')); } catch (e) { return null; }
  }
  return body && typeof body === 'object' ? body : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  /* Anahtar yoksa uç KAPALI. Doğrulayamadığı bir isteği kabul eden bir
     webhook, abonelik durumunu dışarıdan yazdırmak demektir. */
  if (!iyzico.isConfigured()) {
    return res.status(503).json({ error: { code: 'webhook_unconfigured' } });
  }
  if (!db.isConfigured()) {
    return res.status(503).json({ error: { code: 'webhook_unavailable' } });
  }

  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: { code: 'invalid_body' } });

  const signature = req.headers && (req.headers['x-iyz-signature-v3']
    || req.headers['X-Iyz-Signature-V3']);

  const verified = iyzico.verifyWebhookSignature(signature, body);
  if (!verified.ok) {
    if (console && console.warn) {
      console.warn('iyzico webhook rejected: ' + verified.reason
        + ' (event=' + String(body.iyziEventType || '').slice(0, 40) + ')');
    }
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  const subscriptionRef = iyzico.subscriptionRefOf(body);
  if (!subscriptionRef) {
    if (console && console.warn) console.warn('iyzico webhook: subscription_ref_missing');
    return res.status(200).json({ ok: true, applied: false, reason: 'subscription_ref_missing' });
  }

  /* Eşleme yoksa yazma yok. */
  let row;
  try {
    row = await db.findSubscriptionByRef(subscriptionRef);
  } catch (err) {
    if (console && console.error) console.error('iyzico webhook: db read failed');
    return res.status(503).json({ error: { code: 'webhook_unavailable' } });
  }
  if (!row) {
    if (console && console.warn) console.warn('iyzico webhook: no_local_subscription');
    return res.status(200).json({ ok: true, applied: false, reason: 'no_local_subscription' });
  }

  /* Tek doğru kaynak: iyzico. */
  const fresh = await iyzico.getSubscription(subscriptionRef);
  if (!fresh.ok) {
    if (console && console.warn) console.warn('iyzico webhook: ' + fresh.reason);
    return res.status(503).json({ error: { code: 'webhook_upstream' } });
  }

  const data = fresh.data || {};
  const status = String(data.subscriptionStatus || data.status || '').toUpperCase();
  const active = iyzico.isActiveStatus(status);

  try {
    await db.updateSubscriptionStatusByRef(subscriptionRef, { active: active, status: status || null });
  } catch (err) {
    if (console && console.error) console.error('iyzico webhook: db write failed');
    return res.status(503).json({ error: { code: 'webhook_unavailable' } });
  }

  return res.status(200).json({ ok: true, applied: true, active: active });
};

module.exports.parseBody = parseBody;
