'use strict';

/**
 * Mobil uygulamanın bildirim jetonunu kaydetmesi.
 *
 *   POST   /api/device-token  { token, platform? }  → { ok }
 *   DELETE /api/device-token  { token }             → { ok, removed }
 *
 * GİRİŞ ZORUNLU. Jeton HESABA bağlanıyor ve `user_id` oturumdan geliyor,
 * gövdeden DEĞİL: aksi hâlde biri başkasının hesabına kendi cihazını
 * bağlayıp o hesabın tarama bildirimlerini okuyabilirdi.
 *
 * JETON LOGLANMIYOR ve YANITTA DÖNMÜYOR. Bir FCM jetonu o cihaza bildirim
 * gönderme yetkisidir; bu depodaki belirteç kuralının (bkz. _lib/telegram.js)
 * aynısı geçerli.
 *
 * Bu uç olmadan WORKFLOW 4'ün gönderecek bir adresi yok: depoda `users`
 * tablosu ve `fcm_token` sütunu hiç var olmadı.
 */

const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const store = require('./_lib/store.js');
const fcm = require('./_lib/fcm.js');
const tg = require('./_lib/telegram.js');
const { clientIp, ipKey } = require('./_lib/session.js');

/* Cihaz başına birkaç kayıt yeter; saatte 20 istek bir uygulamanın yeniden
   açılmasına fazlasıyla yetiyor, bir betiğin tabloyu şişirmesine yetmiyor. */
const RATE_WINDOW_SECONDS = 3600;
const RATE_MAX = 20;

const PLATFORMS = ['android', 'ios', 'web'];

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!db.isConfigured() || !auth.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') body = {};

  /* Jeton biçimi oturumdan ÖNCE denetleniyor: çöp bir gövde için oturum
     çözmenin anlamı yok. */
  const jeton = fcm.jetonGecerliMi(body.token);
  if (!jeton) return res.status(400).json({ error: { code: 'bad_token' } });

  const user = await auth.resolveUser(req);
  if (!user) return res.status(401).json({ error: { code: 'unauthorized' } });

  if (store.isConfigured()) {
    try {
      const sayac = await store.hitRateLimit(
        'devtok:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
      if (sayac && sayac.count > RATE_MAX) {
        res.setHeader('Retry-After', String(sayac.ttl || RATE_WINDOW_SECONDS));
        return res.status(429).json({ error: { code: 'rate_limited' } });
      }
    } catch (err) {
      /* Sayaç deposu düşerse uç kapanmıyor: bildirim kaydı güvenlik sınırı
         değil, kötüye kullanım sınırı. */
      if (console && console.warn) console.warn('device-token: rate store down');
    }
  }

  if (req.method === 'DELETE') {
    let silinen = 0;
    try {
      silinen = await db.deleteDeviceToken(user.id, jeton);
    } catch (err) {
      if (console && console.error) console.error('device-token: delete failed:', err.message);
      return res.status(503).json({ error: { code: 'save_failed' } });
    }
    return res.status(200).json({ ok: true, removed: silinen });
  }

  const platform = PLATFORMS.indexOf(String(body.platform)) !== -1
    ? String(body.platform) : 'android';

  try {
    await db.saveDeviceToken(user.id, jeton, platform);
  } catch (err) {
    /* Hata metni jetonu taşıyabilir (PostgREST çatışma iletisi); yalnızca
       sabit bir kod loglanıyor. */
    if (console && console.error) console.error('device-token: save failed');
    try {
      await tg.sendTelegram(tg.mesaj.hata('/api/device-token', 503, 'save_failed'), { type: 'alert' });
    } catch (e) { /* bildirim ucu kırmaz */ }
    tg.bildirimIsaretle(res);
    return res.status(503).json({ error: { code: 'save_failed' } });
  }

  /* Jeton YANITTA DÖNMÜYOR. */
  return res.status(200).json({ ok: true, platform: platform });
}

module.exports = tg.ucuSar(handler, '/api/device-token');
