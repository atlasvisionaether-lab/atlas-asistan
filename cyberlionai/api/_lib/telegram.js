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
 *
 * MASKELİ E-POSTA: ödeme, otomatik düzeltme ve bekleme listesi bildirimleri
 * müşteriyi tanımak için e-posta taşıyor, ama yalnız `maskEmail()`'den
 * geçmiş hâliyle (`a***@gmail.com`). Tam adres Telegram'a gitmez.
 *
 * TEK İSTİSNA: `iletisimFormu`. Diğer mesajlardaki e-posta, müşterinin
 * SEÇMEDİĞİ bir taramanın hedefine ait (üçüncü taraf verisi) — bu yüzden
 * gitmiyor. İletişim formunda e-posta müşterinin KENDİ adresi, kendi
 * isteğiyle ve CEVAP ALABİLMEK için yazılıyor; adres gitmezse bildirim
 * amacına ulaşmaz.
 */

const API_TABANI = 'https://api.telegram.org';
const TIMEOUT_MS = 2500;

/* Telegram'ın kendi sınırı grup başına ~20 mesaj/dakika. Biz daha erken
   duruyoruz: sınır aşılırsa Telegram 429 veriyor ve o yanıtı beklemek
   isteğin kendi süresine ekleniyor. Sayaç paylaşımlı depoda, çünkü her
   sunucusuz örneğin kendi belleği ayrı — bellekteki sayaç sınır değil süstür. */
const HIZ_PENCERESI_SN = 60;
const HIZ_MAX = 18;

/* ÖNCELİKLİ HAT: ödeme ve otomatik düzeltme bildirimleri ayrı bir kovadan
   sayılıyor. Tarama dalgası olağan kovayı doldurduğunda ödemenin haberi
   düşmesin diye. Telegram'ın sınırı ~20/dk; iki kova birlikte bunu aşabilir,
   o durumda aşağıdaki 429 tekrarı devreye giriyor. Ödeme sayısı tarama
   sayısının yanında küçük olduğu için bu kova dar tutuluyor. */
const ONCELIK_MAX = 10;
/* Öncelikli mesajda 429 dışındaki geçici hatalarda (zaman aşımı, ulaşılamadı,
   5xx) bir kez, bu kadar bekleyip tekrar deneniyor. */
const ONCELIK_TEKRAR_MS = 1000;

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
 * E-postayı maskeler: ilk karakter + *** + @alan. Biçimsizse '-'.
 *   ali.kotan@gmail.com → a***@gmail.com
 * Alan kısmı küçük harfe çevrilir ve denetim karakterlerinden arındırılır;
 * yerel kısımdan ilk karakter dışında hiçbir şey dışarı çıkmaz.
 */
function maskEmail(eposta) {
  const s = String(eposta === null || eposta === undefined ? '' : eposta).trim();
  const at = s.lastIndexOf('@');
  if (at < 1 || at === s.length - 1) return '-';
  const alanAdi = s.slice(at + 1).toLowerCase().replace(/[^a-z0-9.-]/g, '');
  if (!alanAdi) return '-';
  return s.charAt(0).toLowerCase() + '***@' + alanAdi;
}

/**
 * Kullanıcının serbest yazdığı metni dışarı çıkacak hâle getirir: e-posta
 * adresleri maskelenir, 7+ haneli sayı dizileri (telefon, kart, TC kimlik)
 * gizlenir, satır sonları sadeleşir ve metin kırpılır.
 */
function serbestMetin(metin, enFazla) {
  let s = String(metin === null || metin === undefined ? '' : metin);
  s = s.replace(/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/gi, function (e) { return maskEmail(e); });
  s = s.replace(/(?:\d[\s.-]?){6,}\d/g, '***');
  s = s.replace(/\s+/g, ' ').trim();
  const sinir = enFazla || 300;
  return s.length > sinir ? s.slice(0, sinir - 1) + '…' : s;
}

/* ---------- Gmail ile cevapla düğmesi ---------- */

/* Telegram satır içi düğme adresini sınırlıyor (belgelenmiş sabit yok; uzun
   adres BUTTON_URL_INVALID ile mesajın TAMAMINI düşürüyor). Güvenli pay. */
const DUGME_URL_MAX = 2000;

/** Gmail'in "yeni ileti" penceresini alıcı, konu ve gövdeyle açan adres. */
function gmailComposeUrl(to, subject, body) {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to: to, su: subject, body: body });
  return 'https://mail.google.com/mail/?' + p.toString();
}

/**
 * "Gmail'de Cevapla" düğmesi. Adres sınırı aşarsa GÖVDE kısaltılıyor (alıcı
 * ve konu korunuyor); düğmesiz mesaj göndermektense kısa taslak daha iyi,
 * taslak zaten Gmail'de düzenleniyor.
 */
function buildSupportKeyboard(to, subject, body) {
  let govde = String(body || '');
  let url = gmailComposeUrl(to, subject, govde);
  while (url.length > DUGME_URL_MAX && govde.length > 0) {
    govde = govde.slice(0, Math.floor(govde.length * 0.85)).replace(/\s+\S*$/, '') + '…';
    if (govde === '…') govde = '';
    url = gmailComposeUrl(to, subject, govde);
  }
  return { inline_keyboard: [[{ text: "📧 Gmail'de Cevapla", url: url }]] };
}

/**
 * replyMarkup yalnızca satır içi URL düğmesi olabilir ve adresi https olmak
 * zorunda. Başka biçim (callback_data, sınırsız klavye) bu katmanın işi değil;
 * yanlış biçim mesajın tamamını 400'e düşürmesin diye gönderilmeden atılıyor.
 */
function gecerliDugmeler(m) {
  if (!m || !Array.isArray(m.inline_keyboard)) return null;
  const ok = m.inline_keyboard.every(function (satir) {
    return Array.isArray(satir) && satir.every(function (d) {
      return d && typeof d.text === 'string' && typeof d.url === 'string'
        && /^https:\/\//.test(d.url) && d.url.length <= DUGME_URL_MAX;
    });
  });
  return ok ? { inline_keyboard: m.inline_keyboard } : null;
}

/** Kısa bir kod/sebep metni: boşluk ve denetim karakteri sadeleşir, kırpılır. */
function kod(deger, yedek) {
  const s = String(deger === null || deger === undefined ? '' : deger)
    .replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || yedek || '-';
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
  taramaBittiKuyruk: function (domain, puan, riskSayisi) {
    return ONEK + ' ✅ Tarama bitti (kuyruktan): ' + alan(domain)
      + ', skor=' + (typeof puan === 'number' ? puan : '-')
      + ', risk=' + Number(riskSayisi || 0);
  },
  taramaBasarisizKuyruk: function (domain, hata) {
    return ONEK + ' ⚠️ Tarama başarısız (kuyruktan): ' + alan(domain)
      + ' — ' + kod(hata, 'scan_failed');
  },
  odemeBasladi: function (plan, eposta, tutar) {
    return ONEK + ' 💳 Ödeme başlatıldı: plan=' + kod(plan).toUpperCase()
      + ', email=' + maskEmail(eposta)
      + ', tutar=' + (typeof tutar === 'number' ? tutar + ' TL' : '-');
  },
  odemeBasarili: function (eposta, plan, ref, tutar) {
    return ONEK + ' ✅ Ödeme başarılı: ' + maskEmail(eposta)
      + ', plan=' + kod(plan).toUpperCase()
      + ', iyzicoId=' + kod(ref)
      + ', tutar=' + (typeof tutar === 'number' ? tutar + ' TL' : '-');
  },
  odemeBeklemede: function (eposta, plan, durum) {
    return ONEK + ' 🕒 Ödeme beklemede: ' + maskEmail(eposta)
      + ', plan=' + kod(plan).toUpperCase() + ', durum=' + kod(durum);
  },
  odemeBasarisiz: function (eposta, sebep) {
    return ONEK + ' ❌ Ödeme başarısız: ' + maskEmail(eposta)
      + ', sebep=' + kod(sebep, 'unknown');
  },
  autofixIstendi: function (domain, eposta, zone, fixType) {
    return ONEK + ' 🛠 Autofix istendi: ' + alan(domain)
      + ', user=' + maskEmail(eposta)
      + ', cfZone=' + kod(zone)
      + ', tür=' + kod(fixType);
  },
  autofixTamam: function (domain, fixType, sayi) {
    return ONEK + ' ✅ Autofix tamamlandı: ' + alan(domain)
      + ', tür=' + kod(fixType) + ', eklenen başlık=' + Number(sayi || 0);
  },
  autofixBasarisiz: function (domain, hata) {
    return ONEK + ' ⚠️ Autofix başarısız: ' + alan(domain)
      + ', hata=' + kod(hata, 'unknown');
  },
  beklemeListesi: function (eposta, plan, domain) {
    return ONEK + ' 📋 Bekleme listesi: ' + maskEmail(eposta)
      + ' - ' + kod(plan).toUpperCase()
      + ' - ' + (domain ? alan(domain) : '-');
  },
  /* Asistanın yanıtlayamadığı soru. Soru `serbestMetin`'den geçer. */
  asistanCevapsiz: function (soru, dil) {
    return ONEK + ' ❓ Asistan yanıtlayamadı (' + kod(dil, 'tr') + '): ' + serbestMetin(soru, 300);
  },
  asistanAcil: function (soru) {
    return ONEK + ' 🚨 Asistan: olası aktif olay bildirildi: ' + serbestMetin(soru, 300);
  },
  /* Asistandaki "uzmanla görüş" formu. İletişim formu gibi e-posta TAM
     gidiyor: müşteri kendi adresini cevap almak için yazdı (bkz. TEK İSTİSNA). */
  insanDestegi: function (ad, eposta, mesajMetni) {
    return ONEK + ' 📩 İnsan desteği istendi (asistan)\n'
      + 'Ad: ' + ad + '\n'
      + 'E-posta: ' + eposta + '\n'
      + 'Son mesajlar: ' + mesajMetni;
  },
  test: function (metin) {
    return ONEK + ' 🦁 ' + (metin || 'test');
  },
  /* E-posta burada BİLEREK var — yukarıdaki "TEK İSTİSNA" notuna bakın. */
  iletisimFormu: function (ad, eposta, mesajMetni) {
    return ONEK + ' 📩 İletişim formu\n'
      + 'Ad: ' + ad + '\n'
      + 'E-posta: ' + eposta + '\n'
      + 'Mesaj: ' + mesajMetni;
  }
};

/** Hız sayacı. Depo yoksa ya da düşerse bildirim GÖNDERİLİR (bkz. not). */
async function hizSiniriAsildi(oncelikli) {
  let store;
  try {
    store = require('./store.js');
  } catch (err) {
    return false;
  }
  if (!store.isConfigured()) return false;
  try {
    const sayac = await store.hitRateLimit(
      oncelikli ? 'cl:rl:tg:p' : 'cl:rl:tg', HIZ_PENCERESI_SN);
    return sayac.count > (oncelikli ? ONCELIK_MAX : HIZ_MAX);
  } catch (err) {
    /* Sayaç okunamadı. Burada istek REDDEDİLMİYOR: bu bir güvenlik sınırı
       değil, Telegram'ın 429'una girmemek için bir nezaket. Kapalı devre
       yapmak, depo düştüğünde bütün bildirimleri kör etmek olurdu. */
    return false;
  }
}

/** Tek gönderim denemesi. Adres loglanmaz: belirteç içinde. */
async function dene(cfg, chatId, metin, sessiz, dugmeler) {
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
        disable_web_page_preview: true,
        reply_markup: dugmeler || undefined
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
 * @param {{type?: string, silent?: boolean, priority?: boolean}} [secenek]
 *   priority: ödeme/düzeltme gibi kaçmaması gereken bildirimler; ayrı hız
 *   kovası ve geçici hatada 1 sn sonra bir tekrar.
 *   replyMarkup: { inline_keyboard } — yalnızca https URL düğmeleri
 *   (bkz. buildSupportKeyboard). Geçersizse düğmesiz gönderilir.
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

  const oncelikli = ayar.priority === true;
  const dugmeler = gecerliDugmeler(ayar.replyMarkup);
  if (await hizSiniriAsildi(oncelikli)) {
    if (console && console.error) console.error('telegram skipped: local_rate_limited');
    return { ok: false, code: 'local_rate_limited' };
  }

  let sonuc = await dene(cfg, chatId, govde, sessiz, dugmeler);

  /* Yalnızca 429'da tekrar: diğer hatalarda ikinci deneme çoğunlukla aynı
     cevabı alır ve isteğin süresine boşuna eklenir. */
  if (!sonuc.ok && sonuc.code === 'rate_limited') {
    const bekle = typeof sonuc.retryAfterMs === 'number'
      ? sonuc.retryAfterMs : RETRY_MAX_BEKLEME_MS;
    if (bekle <= RETRY_MAX_BEKLEME_MS) {
      if (bekle > 0) await new Promise(function (r) { setTimeout(r, bekle); });
      sonuc = await dene(cfg, chatId, govde, sessiz, dugmeler);
    }
  } else if (!sonuc.ok && oncelikli
      && (sonuc.code === 'timeout' || sonuc.code === 'unreachable' || sonuc.status >= 500)) {
    await new Promise(function (r) { setTimeout(r, ONCELIK_TEKRAR_MS); });
    sonuc = await dene(cfg, chatId, govde, sessiz, dugmeler);
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
 * Aynı olay için tek bildirim: anahtar ilk kez görülüyorsa true.
 *
 * Depo yoksa ya da düşerse true (gönder): çift mesaj, hiç mesaj olmamasından
 * daha az zararlı. Anahtar olayın kimliğinden kuruluyor (iş kimliği,
 * abonelik referansı); kişisel veri taşımıyor.
 */
async function tekSefer(anahtar, ttlSn) {
  let store;
  try { store = require('./store.js'); } catch (err) { return true; }
  if (!store.isConfigured() || typeof store.setOnce !== 'function') return true;
  try {
    return await store.setOnce('cl:tg:once:' + anahtar, ttlSn || 86400);
  } catch (err) {
    return true;
  }
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
  maskEmail, serbestMetin, tekSefer, gmailComposeUrl, buildSupportKeyboard, DUGME_URL_MAX, HIZ_MAX, ONCELIK_MAX, MAX_UZUNLUK
};
