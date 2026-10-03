'use strict';

/**
 * POST /api/contact  { name, email, message }
 *
 * Footer/iletişim formunun arka ucu. Müşteriyle ilgili HİÇBİR ŞEY kalıcı
 * depoya yazılmaz — tek hedef Telegram'a bir bildirim düşürmek. Form kalıcı
 * bir "gelen kutusu" değil, işletmeciyi haberdar eden bir zil.
 *
 * `api/_lib/telegram.js`'teki diğer mesaj türlerinin aksine burada e-posta
 * BİLEREK gönderiliyor: o dosyadaki kural ("e-posta Telegram'a gitmez")
 * taramanın hedefi gibi müşterinin SEÇMEDİĞİ üçüncü taraf verisi için.
 * Burada müşteri kendi adını/e-postasını kendi isteğiyle, cevap alabilmek
 * için yazıyor — adres gitmezse bildirim işe yaramaz.
 */

const tg = require('./_lib/telegram.js');
const store = require('./_lib/store.js');
const { clientIp, ipKey } = require('./_lib/session.js');

const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_MAX = 5;

const MAX_NAME = 100;
const MAX_EMAIL = 320;
const MAX_MESSAGE = 2000;

const EMAIL_BICIMI = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Denetim karakterlerini boşluğa çevirir (telegram.js'teki temizle() ile
   aynı aralık). Regex kaçış dizileri kasıtlı: kaynak dosyada ham denetim
   baytı OLMAMALI. */
const KONTROL_KARAKTERLERI = new RegExp(
  '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');

function govdeAl(req) {
  const b = req && req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) {
    try { return JSON.parse(b); } catch (err) { return null; }
  }
  return null;
}

function temizle(ham, maxUzunluk) {
  let s = typeof ham === 'string' ? ham : '';
  s = s.replace(KONTROL_KARAKTERLERI, ' ').trim();
  if (s.length > maxUzunluk) s = s.slice(0, maxUzunluk);
  return s;
}

/** @returns {{ok: true, name: string, email: string, message: string} | {ok: false, kod: string}} */
function govdeDogrula(govde) {
  const name = temizle(govde && govde.name, MAX_NAME);
  const email = temizle(govde && govde.email, MAX_EMAIL);
  const message = temizle(govde && govde.message, MAX_MESSAGE);

  if (!name) return { ok: false, kod: 'name_required' };
  if (!email || !EMAIL_BICIMI.test(email) || email.length > MAX_EMAIL) {
    return { ok: false, kod: 'invalid_email' };
  }
  if (!message) return { ok: false, kod: 'message_required' };

  return { ok: true, name: name, email: email, message: message };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const dogrulama = govdeDogrula(govdeAl(req));
  if (!dogrulama.ok) {
    return res.status(400).json({ error: { code: dogrulama.kod } });
  }

  /* Sayaç yoksa form KAPANMIYOR (DNS ucunun aksine): burada sınırsız istek
     SQS/Lambda gibi dış maliyetli bir kaynağı tüketmiyor, yalnızca Telegram
     mesajı. Sayaç yoksa bildirim yine gider, yalnızca hız sınırı uygulanmaz. */
  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit(
        'cl:rl:contact:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
      if (rate.count > RATE_MAX) {
        const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
      }
    } catch (err) {
      /* Sayaç okunamadı: form yine de kabul edilir, bkz. yukarıdaki not. */
    }
  }

  if (!tg.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  /* silent: false — bu bir iş fırsatı/talebi, sessiz gelen diğer bildirimler
     gibi (tarama, DNS) gözden kaçırılmamalı. */
  const sonuc = await tg.sendTelegram(
    tg.mesaj.iletisimFormu(dogrulama.name, dogrulama.email, dogrulama.message),
    { type: 'contact', silent: false });

  if (!sonuc.ok) {
    tg.bildirimIsaretle(res);
    return res.status(502).json({ error: { code: 'notify_failed' } });
  }

  return res.status(200).json({ ok: true });
}

module.exports = tg.ucuSar(handler, '/api/contact');
