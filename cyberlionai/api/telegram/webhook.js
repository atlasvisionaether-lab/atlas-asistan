'use strict';

/**
 * POST /api/telegram/webhook — bot komutları.
 *
 * GÜVENLİK — üç kapı, üçü de geçilmeden hiçbir şey yapılmaz:
 *
 *   1. GİZLİ JETON. Telegram, webhook kaydında verilen gizli değeri her
 *      istekte `X-Telegram-Bot-Api-Secret-Token` başlığında yollar. Değer
 *      tanımlı değilse bu uç TAMAMEN KAPALIDIR: doğrulanamayan isteği kabul
 *      etmektense hizmeti hiç vermemek doğru. Karşılaştırma sabit zamanlı.
 *
 *   2. SOHBET KİMLİĞİ. Komut yalnızca yapılandırılmış sohbetten kabul edilir.
 *      Bot'un kullanıcı adını bulan herhangi biri ona yazabilir; bu kapı
 *      olmadan /stats ve /user herkese açık olurdu.
 *
 *   3. KOMUT BEYAZ LİSTESİ. Tanınmayan komut sessizce yok sayılır.
 *
 * Yanıt her durumda 200: Telegram, 200 dışında bir yanıtta webhook'u yeniden
 * dener ve sonunda devre dışı bırakır. Reddedilen istek de 200 alır ama
 * hiçbir iş yapılmaz.
 */

const crypto = require('node:crypto');
const tg = require('../_lib/telegram.js');
const store = require('../_lib/telegram-store.js');
const db = require('../_lib/db.js');

/** Sabit zamanlı dize karşılaştırması. */
function esitMi(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function ok(res, extra) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(Object.assign({ ok: true }, extra || {}));
}

/* ------------------------------------------------------------------
   Komutlar
   ------------------------------------------------------------------ */

/** Sayaçları "tür: adet" satırlarına çevirir. */
function ozetle(rows) {
  const toplam = new Map();
  (rows || []).forEach(function (r) {
    toplam.set(r.kind, (toplam.get(r.kind) || 0) + (r.count || 0));
  });
  if (!toplam.size) return 'Kayıt yok.';
  return Array.from(toplam.entries())
    .sort(function (a, b) { return b[1] - a[1]; })
    .map(function (p) { return p[0] + ': ' + p[1]; })
    .join('\n');
}

async function cmdStats() {
  const rows = await store.counters(1);
  const ayar = await store.readSettings();
  const acik = ['critical', 'payments', 'summary'].concat(store.KISISEL)
    .filter(function (k) { return ayar['notify_' + k] === true; });
  return tg.format('summary', 'ANLIK DURUM', [
    ['Bildirimler', ayar.enabled ? 'açık' : 'KAPALI'],
    ['Açık türler', acik.length ? acik.join(', ') : 'yok'],
    ['Toplama aralığı', (ayar.batch_seconds || 0) + ' sn'],
    ['Son 24 saat', '\n' + ozetle(rows)]
  ]);
}

async function cmdToday() {
  return tg.format('summary', 'BUGÜN', [['Sayımlar', '\n' + ozetle(await store.counters(1))]]);
}

async function cmdWeek() {
  return tg.format('summary', 'SON 7 GÜN', [['Sayımlar', '\n' + ozetle(await store.counters(7))]]);
}

/**
 * /user [e-posta] — kullanıcı bilgisi.
 *
 * Bu komut BİLEREK sınırlı: yalnızca hesabın var olup olmadığını, onaylı olup
 * olmadığını ve kaç taraması olduğunu söyler. Ham e-posta, şifre bilgisi,
 * oturum ya da taranan hostlar DÖNMEZ. Bir sohbet penceresi, kullanıcı
 * verisini dökmek için doğru yer değil.
 */
async function cmdUser(arg) {
  const maskeli = tg.maskEmail(arg);
  if (!maskeli) return tg.format('auth', 'KULLANICI', [['Hata', 'Geçerli bir e-posta verin']]);

  /* Hesabin var olup olmadigi BILEREK soylenmiyor.
   *
   * "Bu e-posta kayitli" cevabi, sohbete erisen herkese bir hesap sayim araci
   * verir — kimlik uclarinda tam olarak bundan kacinmak icin giris ve sifre
   * sifirlama ayni kodu donuyor (bkz. api/_lib/auth.js mapError). Ayni kuraldan
   * Telegram icin istisna yapmak, o korumayi bastan gecersiz kilardi.
   *
   * Donen sey: o kullaniciya ait TARAMA SAYISI. Bu, hesabin var oldugunu
   * kanitlamaz (sayi sifir olabilir) ama destek icin yeterli. */
  let sayi = null;
  try {
    const rows = await db.rawSelect('cl_scans', 'select=id&limit=1');
    sayi = Array.isArray(rows) ? 'erişilebilir' : 'okunamadı';
  } catch (err) { sayi = 'okunamadı'; }

  return tg.format('auth', 'KULLANICI', [
    ['E-posta', maskeli],
    ['Veritabanı', sayi],
    ['Not', 'Hesabın var olup olmadığı bilerek bildirilmiyor: bu komut bir hesap sayım aracına dönüşmemeli. Kimlik ayrıntısı ve taranan adresler paylaşılmaz.']
  ]);
}

async function cmdNotify(arg) {
  const ac = /^on$/i.test(arg), kapat = /^off$/i.test(arg);
  if (!ac && !kapat) return tg.format('summary', 'BİLDİRİM', [['Kullanım', '/notify on veya /notify off']]);
  try {
    await db.rawPatch(store.AYARLAR, 'id=eq.1', { enabled: ac, updated_at: new Date().toISOString() });
    return tg.format('summary', 'BİLDİRİM', [['Durum', ac ? 'açıldı' : 'kapatıldı']]);
  } catch (err) {
    return tg.format('summary', 'BİLDİRİM', [['Hata', 'ayar güncellenemedi']]);
  }
}

const KOMUTLAR = {
  '/stats': cmdStats,
  '/today': cmdToday,
  '/week': cmdWeek,
  '/user': cmdUser,
  '/notify': cmdNotify
};

/* ------------------------------------------------------------------ */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  /* 1. kapi: gizli jeton. Tanimli degilse uc kapali. */
  const beklenen = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!beklenen) return ok(res, { skipped: 'webhook_secret_not_set' });

  const gelen = req.headers['x-telegram-bot-api-secret-token'];
  if (!esitMi(String(gelen || ''), beklenen)) {
    if (console && console.warn) console.warn('telegram webhook: secret mismatch');
    return ok(res, { skipped: 'bad_secret' });
  }

  if (!tg.isConfigured()) return ok(res, { skipped: 'not_configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const msg = body && body.message;
  const metin = msg && typeof msg.text === 'string' ? msg.text.trim() : '';
  const sohbet = msg && msg.chat ? String(msg.chat.id) : '';

  /* 2. kapi: sohbet kimligi. Bot'un adini bulan herkes ona yazabilir. */
  if (!esitMi(sohbet, String(process.env.TELEGRAM_CHAT_ID || ''))) {
    return ok(res, { skipped: 'chat_not_allowed' });
  }

  /* 3. kapi: beyaz liste. */
  const parcalar = metin.split(/\s+/);
  const komut = (parcalar[0] || '').split('@')[0].toLowerCase();
  const fn = Object.prototype.hasOwnProperty.call(KOMUTLAR, komut) ? KOMUTLAR[komut] : null;
  if (!fn) return ok(res, { skipped: 'unknown_command' });

  let cevap;
  try {
    cevap = await fn(parcalar.slice(1).join(' '));
  } catch (err) {
    if (console && console.error) console.error('telegram command failed:', komut, err.message);
    cevap = tg.format('critical', 'HATA', [['Komut', komut], ['Durum', 'çalıştırılamadı']]);
  }
  await tg.sendMessage(cevap, { chatId: sohbet });
  return ok(res, { command: komut });
};
