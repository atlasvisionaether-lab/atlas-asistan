'use strict';

/**
 * Telegram bildirim katmanı.
 *
 * TASARIM İLKESİ: bildirim hiçbir zaman asıl işi bozmaz. Telegram'a
 * ulaşılamaması bir taramayı, kaydı ya da ödemeyi başarısız kılmaz. Bu yüzden
 * her çağrı kendi hatasını yutar ve olay kuyruğa yazılır; gönderim ayrı akar.
 *
 * GİZLİLİK: bu modülden çıkan hiçbir metin ham IP veya ham e-posta içermez.
 * Maskeleme burada, kaynağında yapılır — çağıranın unutması ihtimali
 * bırakılmaz. Ham değer belleğe alınır, maskelenir, atılır.
 *
 * Gerekli ortam değişkenleri (değerleri koda yazılmaz, Vercel'de tanımlanır):
 *   TELEGRAM_BOT_TOKEN        BotFather'dan alınan jeton
 *   TELEGRAM_CHAT_ID          bildirimlerin gideceği sohbet
 *   TELEGRAM_WEBHOOK_SECRET   bot komutlarını doğrulamak için (yoksa komut
 *                             ucu tamamen kapalıdır — doğrulanamayan isteği
 *                             kabul etmektense hizmeti vermemek doğru)
 */

const API_TIMEOUT_MS = 4000;

function config() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  return token && chat ? { token: token, chat: chat } : null;
}

function isConfigured() { return config() !== null; }

/* ------------------------------------------------------------------
   Maskeleme — kaynağında, çağıranın insafına bırakmadan
   ------------------------------------------------------------------ */

/**
 * IPv4 -> "88.120.x.x", IPv6 -> ilk iki öbek + "::x".
 *
 * Neden /16: /24 (88.120.35.x) tek bir eve ya da küçük bir işletmeye kadar
 * daraltabiliyor. İki öbek "hangi operatör, kabaca nerede" sorusuna yetiyor
 * ve tekil aboneyi işaret etmiyor.
 *
 * Ham adres ASLA döndürülmez; geçersiz girdide de ham değer sızdırılmaz.
 */
function maskIp(ip) {
  if (typeof ip !== 'string' || !ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip.trim());
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if (a > 255 || b > 255) return null;
    return a + '.' + b + '.x.x';
  }
  if (ip.indexOf(':') > -1) {
    const parts = ip.split(':').filter(Boolean);
    if (parts.length >= 2) return parts[0] + ':' + parts[1] + '::x';
    return null;
  }
  return null;
}

/**
 * E-posta -> "ab***@ornek.com". Yerel kısmın yalnızca ilk iki karakteri kalır;
 * kısa yerel kısımda o da gizlenir.
 */
function maskEmail(email) {
  if (typeof email !== 'string') return null;
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(email.trim());
  if (!m) return null;
  const yerel = m[1];
  const gorunen = yerel.length >= 3 ? yerel.slice(0, 2) : '';
  return gorunen + '***@' + m[2];
}

/** Serbest metni bildirime uygun hale getirir: kontrol karakterlerini atar, kırpar. */
function clip(text, max) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max || 200);
}

/**
 * Telegram HTML kipi için kaçış.
 *
 * Kullanıcıdan gelen metin (taranan host, asistan sorusu) doğrudan mesaja
 * girdiğinde içindeki < > & karakterleri Telegram'ın ayrıştırıcısını bozar ve
 * mesaj HİÇ GİTMEZ. Daha kötüsü, biçimlendirme enjeksiyonuna açık olur.
 */
function esc(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------
   Gönderim
   ------------------------------------------------------------------ */

/**
 * Telegram'a tek mesaj gönderir.
 *
 * Hata FIRLATMAZ: sonucu nesne olarak döner. Bildirim çağıran akışı asla
 * bozmamalı — bu kural modülün var oluş sebebi.
 */
async function sendMessage(text, opts) {
  const cfg = config();
  if (!cfg) return { ok: false, error: 'not_configured' };

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.telegram.org/bot' + cfg.token + '/sendMessage', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: (opts && opts.chatId) || cfg.chat,
        text: String(text).slice(0, 4096),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: !!(opts && opts.silent)
      })
    });
    clearTimeout(timer);
    if (!res.ok) {
      const govde = await res.text().catch(function () { return ''; });
      /* Jeton yanitta yankilanmaz; yalnizca durum ve Telegram'in aciklamasi. */
      return { ok: false, error: 'http_' + res.status, detail: clip(govde, 200) };
    }
    return { ok: true };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
}

/* ------------------------------------------------------------------
   Bildirim biçimi
   ------------------------------------------------------------------ */

const ICON = {
  scan: '\u{1F50D}', visitor: '\u{1F464}', auth: '\u{1F511}', assistant: '\u{1F4AC}',
  payment: '\u{1F4B3}', download: '\u{1F4C4}', critical: '\u{1F6A8}', summary: '\u{1F4CA}'
};

/**
 * Bildirim gövdesini kurar.
 *
 * `fields` sıralı [etiket, değer] çiftleri. Değeri boş olan alan hiç yazılmaz
 * — "Ülke: undefined" gibi satırlar kullanıcıya gitmesin. Bu tam olarak
 * haritada bir kez yaşandı.
 */
function format(kind, title, fields) {
  const satirlar = [(ICON[kind] || '•') + ' <b>' + esc(title) + '</b>'];
  (fields || []).forEach(function (f) {
    const deger = f[1];
    if (deger === null || deger === undefined || deger === '') return;
    satirlar.push(esc(f[0]) + ': ' + esc(deger));
  });
  return satirlar.join('\n');
}

module.exports = {
  isConfigured, sendMessage, format,
  maskIp, maskEmail, clip, esc, ICON
};
