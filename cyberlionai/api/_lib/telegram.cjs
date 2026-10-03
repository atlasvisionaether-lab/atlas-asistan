'use strict';

/**
 * Telegram bildirimleri.
 *
 * Tek amacı var: işletmeciye (bize) ne olduğunu söylemek. Müşteriye giden
 * hiçbir yanıt buna bağlı DEĞİL — bildirim düşse de istek tamamlanır.
 *
 * ORTAM DEĞİŞKENLERİ (değerleri koda yazılmaz, Vercel'de tanımlanır)
 *   TELEGRAM_BOT_TOKEN        BotFather'ın verdiği belirteç
 *   TELEGRAM_CHAT_ID          olağan bildirimler (tarama, doğrulama)
 *   TELEGRAM_ALERT_CHAT_ID    (opsiyonel) kritik uyarılar; yoksa yukarıdakine düşer
 *
 * BELİRTEÇ HİÇBİR YERE YAZILMAZ
 *
 * Telegram'da belirteç ADRESİN İÇİNDE:
 * `https://api.telegram.org/bot<BELIRTEC>/sendMessage`. Yani sıradan bir
 * "istek başarısız: <adres>" logu belirteci doğrudan sızdırır. Bu yüzden
 * loglanacak her metin `gizle()`'den geçiyor ve adres hiç loglanmıyor; yalnız
 * durum kodu ve kısa bir kod yazılıyor. Belirteç DB'ye de yazılmıyor.
 * 20 karakterden kısa belirteç kabul edilmiyor (yapılandırma hatası sayılır).
 *
 * parse_mode YOK — BİLİNÇLİ
 *
 * Mesajın içine müşterinin seçtiği alan adı ve motorun hata kodu giriyor.
 * `parse_mode: 'Markdown'` ile gönderilse, bu girdilerdeki `_`, `*`, `[`
 * karakterleri ya mesajı bozar ya da Telegram'ın 400'üne takılır; kötü
 * niyetli bir alan adı ise bildirime bağlantı sokabilir. Düz metin bu riskin
 * tamamını kaldırıyor, kaybı yalnızca kalın yazı.
 *
 * TELEGRAM'A NE GİTMEZ
 *
 * E-posta adresi, IP, oturum/kullanıcı kimliği, belirteç, tarama raporunun
 * kendisi. Telegram DIŞ bir servis; buraya yalnız alan adı, sayı ve durum
 * kodu gidiyor. Mesaj kuranlar bu dosyada toplandı ki kural tek yerde dursun.
 */

const API_TABANI = 'https://api.telegram.org';
const TIMEOUT_MS = 2500;

/* Telegram'ın kendi sınırı grup başına ~20 mesaj/dakika. Biz daha erken
   duruyoruz: sınır aşılırsa Telegram 429 veriyor ve o yanıtı beklemek
   isteğin kendi süresine ekleniyor. Sayaç paylaşımlı depoda, çünkü her
   sunucusuz örneğin kendi belleği ayrı — bellekteki sayaç sınır değil süstür. */
const HIZ_PENCERESI_SN = 60;
const HIZ_MAX = 18;

/* 429'da Telegram `retry_after` saniye veriyor. Kısa bir bekleme bir isteğin
   süresine eklenebilir; uzun olan beklenmiyor, mesaj düşüyor. Bildirim
   gecikmesi, müşterinin taramasını yavaşlatmaktan daha az zararlı. */
const RETRY_MAX_BEKLEME_MS = 2000;

/* Telegram'ın sınırı 4096 karakter. Daha erken kesiyoruz ki kesme payı
   kalsın; mesajlarımızın hiçbiri normalde buna yaklaşmıyor. */
const MAX_UZUNLUK = 3500;

const ONEK = '[CyberLion]';

/** Uyarı sayılan türler: ayrı sohbete gider ve sessiz gönderilmez. */
const UYARI_TURLERI = ['error', 'alert'];

function config() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return null;
  /* 20 karakterden kısa belirteç yapılandırma hatası; sessizce denemek yerine
     kapalı sayılıyor. Gerçek biçim "<sayı>:<~35 karakter>". */
  if (String(token).length < 20) return null;
  if (!/^\d{3,}:[A-Za-z0-9_-]{20,}$/.test(String(token))) return null;
  return {
    token: String(token),
    chat: String(chat),
    uyariChat: String(process.env.TELEGRAM_ALERT_CHAT_ID || chat)
  };
}

function isConfigured() { return config() !== null; }

/**
 * Metinden belirteci siler. Loglanan HER metin buradan geçer.
 * Yapılandırma okunamıyorsa da çalışır (o hâlde gizlenecek bir şey yok).
 */
function gizle(metin) {
  const s = metin === null || metin === undefined ? '' : String(metin);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return s;
  const t = String(token);
  let temiz = s.split(t).join('[token]');
  /* Belirtecin yalnız sır kısmı (iki nokta sonrası) da sızdırır. */
  const iki = t.indexOf(':');
  if (iki > 0) {
    const sir = t.slice(iki + 1);
    if (sir.length >= 8) temiz = temiz.split(sir).join('[token]');
  }
  return temiz;
}

/** Denetim karakterleri atılır, uzunluk kırpılır. */
function temizle(metin) {
  let s = String(metin === null || metin === undefined ? '' : metin);
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  if (s.length > MAX_UZUNLUK) s = s.slice(0, MAX_UZUNLUK - 1) + '…';
  return s;
}

/**
 * Bir hedefi mesaja girecek kadar sadeleştirir (boşsa '-').
 *
 * Çağıranlar bazen ham adres veriyor (tarama başlarken henüz çözümlenmiş bir
 * ad yok). Şema, kullanıcı adı, port, yol ve sorgu dizesi ATILIYOR: bildirimde
 * işe yarayan tek şey alan adı ve sorgu dizesi müşterinin yazdığı rastgele
 * metni dış bir servise taşıyabilir.
 */
function alan(ad) {
  let s = String(ad === null || ad === undefined ? '' : ad).trim();
  if (!s) return '-';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.split('@').pop();
  s = s.split(':')[0];
  s = s.replace(/\.+$/, '').toLowerCase();
  return s ? s : '-';
}

/**
 * Mesaj kuranlar. Biçim TEK YERDE: bir bildirimin nasıl göründüğü
 * `tools/telegram-test.js` ile sabit ve uçlar kendi metnini yazmıyor.
 */
const mesaj = {
  taramaBasladi: function (domain) {
    return ONEK + ' 🔍 Tarama başladı: ' + alan(domain);
  },
  taramaKuyruga: function (domain) {
    return ONEK + ' 🕒 Tarama kuyruğa alındı: ' + alan(domain);
  },
  taramaBitti: function (domain, riskSayisi, puan) {
    let m = ONEK + ' ✅ Tarama bitti: ' + alan(domain)
      + ' — ' + Number(riskSayisi || 0) + ' risk';
    if (typeof puan === 'number') m += ' (puan ' + puan + ')';
    return m;
  },
  taramaBasarisiz: function (domain, kod) {
    return ONEK + ' ⚠️ Tarama başarısız: ' + alan(domain)
      + ' — ' + (kod || 'scan_failed');
  },
  dnsDogrulama: function (domain, spfDurum, dmarcPolitika) {
    return ONEK + ' 🛡️ DNS doğrulama: ' + alan(domain)
      + ' SPF ' + (spfDurum || 'bilinmiyor')
      + ' / DMARC ' + (dmarcPolitika ? 'p=' + dmarcPolitika : 'yok');
  },
  hata: function (uc, durum, kod) {
    let m = ONEK + ' ❌ Hata: ' + (uc || '/api') + ' ' + (durum || '');
    if (kod) m += ' (' + kod + ')';
    return m.trim();
  },
  test: function (metin) {
    return ONEK + ' 🦁 ' + (metin || 'test');
  }
};

/** Hız sayacı. Depo yoksa ya da düşerse bildirim GÖNDERİLİR (bkz. not). */
async function hizSiniriAsildi() {
  let store;
  try {
    store = require('./store.js');
  } catch (err) {
    return false;
  }
  if (!store.isConfigured()) return false;
  try {
    const sayac = await store.hitRateLimit('cl:rl:tg', HIZ_PENCERESI_SN);
    return sayac.count > HIZ_MAX;
  } catch (err) {
    /* Sayaç okunamadı. Burada istek REDDEDİLMİYOR: bu bir güvenlik sınırı
       değil, Telegram'ın 429'una girmemek için bir nezaket. Kapalı devre
       yapmak, depo düştüğünde bütün bildirimleri kör etmek olurdu. */
    return false;
  }
}

/** Tek gönderim denemesi. Adres loglanmaz: belirteç içinde. */
async function dene(cfg, chatId, metin, sessiz) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(API_TABANI + '/bot' + cfg.token + '/sendMessage', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      /* parse_mode BİLİNÇLİ OLARAK YOK — yukarıdaki nota bakın. */
      body: JSON.stringify({
        chat_id: chatId,
        text: metin,
        disable_notification: sessiz === true,
        disable_web_page_preview: true
      })
    });
  } catch (err) {
    clearTimeout(timer);
    const abort = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    return { ok: false, code: abort ? 'timeout' : 'unreachable', status: 0 };
  }
  clearTimeout(timer);

  if (response.ok) return { ok: true, status: response.status };

  /* 429: Telegram ne kadar bekleneceğini söylüyor. Gövde okunamazsa
     beklemeden vazgeçiliyor. */
  let bekle = null;
  if (response.status === 429) {
    try {
      const govde = await response.json();
      const sn = govde && govde.parameters && govde.parameters.retry_after;
      if (typeof sn === 'number' && sn >= 0) bekle = sn * 1000;
    } catch (err) { bekle = null; }
  }

  return {
    ok: false,
    code: response.status === 429 ? 'rate_limited' : 'rejected',
    status: response.status,
    retryAfterMs: bekle
  };
}

/**
 * Telegram'a bir mesaj gönderir.
 *
 * ASLA FIRLATMAZ: çağıran uç bir bildirim yüzünden 500 dönmemeli. Hata da
 * YUTULMAZ — sonuç nesnesinde `ok: false` ve bir `code` ile geri verilir ve
 * tek satır loglanır (belirteç gizlenmiş). Yani çağıran isterse bakar, ama
 * bakmadığında da olan şey loga düşer.
 *
 * @param {string} metin  gönderilecek düz metin
 * @param {{type?: string, silent?: boolean}} [secenek]
 * @returns {Promise<{ok: boolean, code?: string, status?: number}>}
 */
async function sendTelegram(metin, secenek) {
  const ayar = secenek || {};
  const cfg = config();
  if (!cfg) return { ok: false, code: 'unconfigured' };

  const uyari = UYARI_TURLERI.indexOf(String(ayar.type || '')) !== -1;
  const chatId = uyari ? cfg.uyariChat : cfg.chat;
  /* Uyarı sessize alınmaz: bildirimin amacı haber vermek. Çağıran açıkça
     `silent: true` derse ona uyulur. */
  const sessiz = typeof ayar.silent === 'boolean' ? ayar.silent : !uyari;

  const govde = temizle(metin);
  if (!govde.trim()) return { ok: false, code: 'empty' };

  if (await hizSiniriAsildi()) {
    if (console && console.error) console.error('telegram skipped: local_rate_limited');
    return { ok: false, code: 'local_rate_limited' };
  }

  let sonuc = await dene(cfg, chatId, govde, sessiz);

  /* Yalnızca 429'da tekrar: diğer hatalarda ikinci deneme çoğunlukla aynı
     cevabı alır ve isteğin süresine boşuna eklenir. */
  if (!sonuc.ok && sonuc.code === 'rate_limited') {
    const bekle = typeof sonuc.retryAfterMs === 'number'
      ? sonuc.retryAfterMs : RETRY_MAX_BEKLEME_MS;
    if (bekle <= RETRY_MAX_BEKLEME_MS) {
      if (bekle > 0) await new Promise(function (r) { setTimeout(r, bekle); });
      sonuc = await dene(cfg, chatId, govde, sessiz);
    }
  }

  if (!sonuc.ok && console && console.error) {
    /* Adres ve gövde loglanmaz; metin yine de gizle()'den geçiriliyor ki
       ileride buraya bir ayrıntı eklenirse belirteç kaçmasın. */
    console.error(gizle('telegram send failed: ' + sonuc.code
      + ' ' + (sonuc.status || 0)));
  }

  return { ok: sonuc.ok, code: sonuc.code, status: sonuc.status };
}

/** Kritik uyarı kısayolu: uyarı sohbetine, sesli. */
function kritik(uc, durum, kod) {
  return sendTelegram(mesaj.hata(uc, durum, kod), { type: 'alert' });
}

/**
 * Bir uç handler'ını sarar: yanıt 500+ ise ya da handler fırlatırsa kritik
 * uyarı gider.
 *
 * NEDEN YANITTAN SONRA: Vercel fonksiyonu handler'ın sözü çözülünce
 * donduruyor. Bildirim `res.json()`'dan ÖNCE beklenirse müşteri bildirim
 * kadar bekler; SONRA ve beklenmeden gönderilirse fonksiyon donar ve mesaj
 * hiç gitmez. Bu yüzden yanıt yazılıyor, sonra handler'ın sözü çözülmeden
 * bildirim bekleniyor: müşteri beklemez, mesaj kaybolmaz.
 *
 * 503 UYARI ÜRETMEZ. Bu depoda 503, çöken bir uç değil BİLİNÇLİ kapalı devre
 * cevabı: sayaç deposu yok, göç uygulanmamış, yapılandırma eksik. Bu durumlar
 * dakikalarca sürüyor ve her yoklamada tekrar ediyor — `/api/scan-status` göç
 * uygulanana kadar her istekte 503 dönüyor. Onu uyarıya bağlamak, uyarı
 * kanalını ilk gerçek 500'ü göremeyeceğimiz kadar doldurmak olurdu. 500, 502
 * ve 504 uyarı üretir.
 */
function ucuSar(handler, ucAdi) {
  return async function (req, res) {
    let firlatan = null;
    try {
      await handler(req, res);
    } catch (err) {
      firlatan = err;
    }

    const durum = firlatan ? 500 : (res && res.statusCode) || 0;
    /* Handler kendi bildirimini gönderdiyse (alan adını da taşıyan daha iyi
       mesaj) ikincisi gönderilmiyor: aynı olay için iki mesaj, kanalı
       okunmaz yapar. Bayrağı `bildirimIsaretle()` koyuyor. */
    const zatenBildirildi = res && res.__clBildirildi === true;

    if (durum >= 500 && durum !== 503 && !zatenBildirildi) {
      const kod = firlatan ? 'exception' : null;
      try { await kritik(ucAdi, durum, kod); } catch (e) { /* bildirim yine de engel değil */ }
    }

    if (firlatan) {
      if (console && console.error) {
        console.error(gizle('unhandled error in ' + ucAdi + ': '
          + (firlatan && firlatan.message)));
      }
      if (res && !res.headersSent && res.status) {
        return res.status(500).json({ error: { code: 'internal_error' } });
      }
    }
    return res;
  };
}

/**
 * "Bu olay için bildirim gitti" işareti. `ucuSar` bunu görünce kendi genel
 * uyarısını göndermez.
 */
function bildirimIsaretle(res) {
  if (res) res.__clBildirildi = true;
}

module.exports = {
  sendTelegram, isConfigured, kritik, ucuSar, bildirimIsaretle, mesaj, gizle,
  HIZ_MAX, MAX_UZUNLUK
};
