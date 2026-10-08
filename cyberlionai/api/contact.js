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
const kb = require('./_lib/kb.js');
const store = require('./_lib/store.js');
const { clientIp, ipKey } = require('./_lib/session.js');

const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_MAX = 5;

const MAX_NAME = 100;
const MAX_EMAIL = 320;
const MAX_MESSAGE = 2000;
const MAX_LAST = 3;            // taslak için bakılan son kullanıcı mesajı sayısı
const MAX_LAST_LEN = 500;
const ONERI_ONIZLEME = 800;    // Telegram'daki önerilen cevap önizlemesi

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

  /* Asistandaki "uzmanla görüş" formu aynı ucu kullanıyor; yalnızca
     bildirimin başlığı değişiyor. Bilinmeyen değer olağan form sayılır. */
  const source = govde && govde.source === 'assistant' ? 'assistant' : 'form';
  const lang = govde && govde.lang === 'en' ? 'en' : 'tr';

  /* Taslak için son mesajlar: asistan diziyi ayrı gönderiyor; olağan formda
     mesajın kendisi tek eleman. Yalnızca metin, sayı ve uzunluk sınırlı. */
  let last = govde && Array.isArray(govde.lastMessages)
    ? govde.lastMessages.filter(function (m) { return typeof m === 'string'; })
        .slice(-MAX_LAST).map(function (m) { return temizle(m, MAX_LAST_LEN); })
        .filter(Boolean)
    : [];
  if (!last.length) last = [message];

  return { ok: true, name: name, email: email, message: message, source: source,
    lang: lang, last: last };
}

/**
 * Ekibe önerilen cevap taslağı. Konu, son mesajlardaki en son GERÇEK konu
 * (uzman isteme mesajı atlanır; bkz. kb.lastTopic). Konu yoksa genel
 * "talebinizi aldık" cevabı. Taslak ekibin Gmail'inde AÇILIR, kendiliğinden
 * gönderilmez: ekip okuyup düzenleyip gönderiyor.
 */
function cevapTaslagi(d) {
  const tr = d.lang !== 'en';
  const konu = kb.lastTopic(d.last);
  const oneri = konu ? kb.answerText(konu, d.lang) : null;
  const genel = tr
    ? 'Talebinizi aldık; en kısa sürede ayrıntılı dönüş yapacağız.'
    : 'We have received your request and will get back to you with details shortly.';
  const govde = (tr ? 'Merhaba ' : 'Hello ') + d.name + ',\n\n'
    + (oneri || genel) + '\n\n---\n'
    + (tr
      ? 'Bu e-posta Cyber Lion AI destek talebiniz üzerine gönderilmiştir.\n\nİyi çalışmalar,\nCyber Lion AI Destek Ekibi\ndestek@cyberlionai.com'
      : 'This email is a reply to your Cyber Lion AI support request.\n\nBest regards,\nCyber Lion AI Support Team\ndestek@cyberlionai.com');
  const baslik = konu ? kb.KB.intents[konu][d.lang].q : (tr ? 'Destek talebiniz' : 'Your support request');
  return {
    konu: konu,
    oneri: oneri || genel,
    konuBasligi: 'Re: Cyber Lion AI - ' + baslik,
    govde: govde
  };
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
  const kur = dogrulama.source === 'assistant' ? tg.mesaj.insanDestegi : tg.mesaj.iletisimFormu;
  const taslak = cevapTaslagi(dogrulama);
  let oneri = taslak.oneri;
  if (oneri.length > ONERI_ONIZLEME) oneri = oneri.slice(0, ONERI_ONIZLEME - 1) + '…';
  const metin = kur(dogrulama.name, dogrulama.email, dogrulama.message)
    + '\n\n💡 Önerilen cevap' + (taslak.konu ? ' (' + taslak.konu + ')' : '') + ':\n' + oneri;

  const sonuc = await tg.sendTelegram(metin, {
    type: 'contact', silent: false,
    replyMarkup: tg.buildSupportKeyboard(dogrulama.email, taslak.konuBasligi, taslak.govde)
  });

  if (!sonuc.ok) {
    tg.bildirimIsaretle(res);
    return res.status(502).json({ error: { code: 'notify_failed' } });
  }

  return res.status(200).json({ ok: true });
}

module.exports = tg.ucuSar(handler, '/api/contact');
module.exports.cevapTaslagi = cevapTaslagi;
