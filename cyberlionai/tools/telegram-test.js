'use strict';

/**
 * Telegram bildirim katmanının sınaması.
 *
 * NEDEN BU DOSYA VAR
 *
 * Bildirim kodu yayında sessizce yanlış davranabilen bir yer: mesaj gitmezse
 * kimse fark etmez, iki kez giderse kanal okunmaz olur ve en kötüsü — Telegram
 * belirteci ADRESİN İÇİNDE olduğu için sıradan bir hata logu onu sızdırır.
 * Bunların hiçbiri bir müşteri yanıtında görünmez, yani sınama olmadan hiçbir
 * koruma yok.
 *
 * Sabitlenen kararlar:
 *   - BELİRTEÇ HİÇBİR LOGA GİRMEZ (en önemlisi; adres hiç loglanmıyor).
 *   - `parse_mode` GÖNDERİLMEZ: mesajın içinde müşterinin yazdığı alan adı var.
 *   - Alan adı sadeleştirilir: şema, port, yol ve SORGU DİZESİ dış servise
 *     taşınmaz.
 *   - 429'da BİR kez tekrar, yalnızca bekleme kısaysa; uzunsa mesaj düşer.
 *   - sendTelegram ASLA fırlatmaz ama hatayı da yutmaz: `ok:false` + log.
 *   - 503 kritik uyarı ÜRETMEZ (bilinçli kapalı devre cevabı, bkz. telegram.js).
 *   - Uç kendi bildirimini gönderdiyse sarmalayıcı ikincisini göndermez.
 *
 * Ağ yok: `global.fetch` saplanıyor ve gönderilen gövde okunuyor.
 */

const path = require('node:path');
const Module = require('node:module');

const API = path.join(__dirname, '..', 'api');
const TG_YOLU = require.resolve(path.join(API, '_lib', 'telegram.js'));

/* Gerçek bir belirteç biçimi, uydurma değer. Sızıntı sınaması bu dizgeyi
   logda arıyor. */
const BELIRTEC = '7851234567:AAH9xKq-Zm3Rn4pQw7sTvB2cDeFgHiJkLmN';
const SIR = BELIRTEC.split(':')[1];

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen)
    + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

function sapla(gorecelYol, govde) {
  const tam = require.resolve(path.join(API, gorecelYol));
  const m = new Module(tam, null);
  m.filename = tam; m.loaded = true; m.exports = govde;
  require.cache[tam] = m;
  return tam;
}

function sahteRes() {
  const res = {
    statusCode: null, body: null, headers: {}, headersSent: false,
    setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; },
    status: function (k) { res.statusCode = k; return res; },
    json: function (b) { res.body = b; res.headersSent = true; return res; },
    end: function () { res.headersSent = true; return res; }
  };
  return res;
}

/** Ortamı kurar, telegram modülünü TAZE yükler. */
function tgYukle(env) {
  const eski = {};
  const anahtarlar = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
    'TELEGRAM_ALERT_CHAT_ID', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  anahtarlar.forEach(function (k) { eski[k] = process.env[k]; delete process.env[k]; });
  Object.keys(env || {}).forEach(function (k) { process.env[k] = env[k]; });

  delete require.cache[TG_YOLU];
  const tg = require(TG_YOLU);
  return {
    tg: tg,
    geriAl: function () {
      anahtarlar.forEach(function (k) {
        if (eski[k] === undefined) delete process.env[k];
        else process.env[k] = eski[k];
      });
      delete require.cache[TG_YOLU];
    }
  };
}

/** fetch saplaması. `yanitlar` sırayla tüketilir. */
function fetchSapla(yanitlar) {
  const cagrilar = [];
  const eski = global.fetch;
  let i = 0;
  global.fetch = async function (adres, secenek) {
    cagrilar.push({ adres: adres, secenek: secenek });
    const y = yanitlar[Math.min(i, yanitlar.length - 1)];
    i += 1;
    if (typeof y === 'function') return y();
    return {
      ok: y.status >= 200 && y.status < 300,
      status: y.status,
      json: async function () {
        if (y.json === undefined) throw new Error('gövde yok');
        return y.json;
      }
    };
  };
  return {
    cagrilar: cagrilar,
    geriAl: function () { global.fetch = eski; }
  };
}

/** console.error çıktısını toplar. */
function logYakala() {
  const eski = console.error;
  const satirlar = [];
  console.error = function () {
    satirlar.push(Array.prototype.slice.call(arguments).map(String).join(' '));
  };
  return { satirlar: satirlar, geriAl: function () { console.error = eski; } };
}

const TAM_ENV = { TELEGRAM_BOT_TOKEN: BELIRTEC, TELEGRAM_CHAT_ID: '-1001234567890' };

async function kos() {

  /* ---- 1. Yapılandırma: eksik ya da bozuk belirteç kapalı sayılır ---- */
  {
    let y = tgYukle({});
    esit('belirteç ve sohbet yoksa kapalı', y.tg.isConfigured(), false);
    y.geriAl();

    y = tgYukle({ TELEGRAM_BOT_TOKEN: BELIRTEC });
    esit('sohbet kimliği yoksa kapalı', y.tg.isConfigured(), false);
    y.geriAl();

    y = tgYukle({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '1' });
    esit('20 karakterden kısa belirteç REDDEDİLİYOR', y.tg.isConfigured(), false);
    y.geriAl();

    y = tgYukle({ TELEGRAM_BOT_TOKEN: 'a'.repeat(40), TELEGRAM_CHAT_ID: '1' });
    esit('iki nokta içermeyen belirteç reddediliyor', y.tg.isConfigured(), false);
    y.geriAl();

    y = tgYukle(TAM_ENV);
    esit('geçerli belirteç + sohbet açık', y.tg.isConfigured(), true);
    y.geriAl();
  }

  /* ---- 2. Mesaj biçimleri ---- */
  {
    const y = tgYukle(TAM_ENV);
    const m = y.tg.mesaj;
    esit('tarama başladı biçimi', m.taramaBasladi('cyberlionai.com'),
      '[CyberLion] 🔍 Tarama başladı: cyberlionai.com');
    esit('tarama bitti biçimi', m.taramaBitti('cyberlionai.com', 3, 88),
      '[CyberLion] ✅ Tarama bitti: cyberlionai.com — 3 risk (puan 88)');
    esit('puan yoksa parantez yok', m.taramaBitti('a.com', 0, null),
      '[CyberLion] ✅ Tarama bitti: a.com — 0 risk');
    esit('hata biçimi', m.hata('/api/scan', 500),
      '[CyberLion] ❌ Hata: /api/scan 500');
    esit('DNS doğrulama biçimi', m.dnsDogrulama('cyberlionai.com', 'pass', 'reject'),
      '[CyberLion] 🛡️ DNS doğrulama: cyberlionai.com SPF pass / DMARC p=reject');
    esit('DMARC yoksa "yok" yazıyor', m.dnsDogrulama('a.com', 'fail', null),
      '[CyberLion] 🛡️ DNS doğrulama: a.com SPF fail / DMARC yok');

    /* Alan adı sadeleştirme: sorgu dizesi dış servise GİTMEZ. */
    esit('şema, port, yol ve sorgu atılıyor',
      m.taramaBasladi('https://kul@Ornek.COM:8443/gizli?anahtar=abc#x'),
      '[CyberLion] 🔍 Tarama başladı: ornek.com');
    dogru('sorgu dizesi mesajda yok',
      m.taramaBasladi('https://a.com/?t=SIZINTI').indexOf('SIZINTI') === -1);
    y.geriAl();
  }

  /* ---- 3. Gönderim: adres, gövde, sohbet yönlendirmesi ---- */
  {
    const y = tgYukle(Object.assign({}, TAM_ENV,
      { TELEGRAM_ALERT_CHAT_ID: '-1009999999999' }));
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);

    const sonuc = await y.tg.sendTelegram('deneme', { type: 'scan' });
    esit('200 başarı', sonuc.ok, true);
    esit('tek istek', f.cagrilar.length, 1);

    const g = JSON.parse(f.cagrilar[0].secenek.body);
    esit('olağan bildirim normal sohbete', g.chat_id, '-1001234567890');
    esit('metin gövdede', g.text, 'deneme');
    dogru('parse_mode GÖNDERİLMİYOR',
      Object.prototype.hasOwnProperty.call(g, 'parse_mode') === false);
    esit('olağan bildirim sessiz', g.disable_notification, true);
    esit('POST kullanılıyor', f.cagrilar[0].secenek.method, 'POST');
    dogru('adres Telegram sendMessage',
      /^https:\/\/api\.telegram\.org\/bot.+\/sendMessage$/.test(f.cagrilar[0].adres));

    f.geriAl();

    const f2 = fetchSapla([{ status: 200, json: { ok: true } }]);
    await y.tg.sendTelegram('acil', { type: 'alert' });
    const g2 = JSON.parse(f2.cagrilar[0].secenek.body);
    esit('uyarı ayrı sohbete', g2.chat_id, '-1009999999999');
    esit('uyarı SESLİ', g2.disable_notification, false);
    f2.geriAl();

    const f3 = fetchSapla([{ status: 200, json: { ok: true } }]);
    await y.tg.sendTelegram('acil', { type: 'alert', silent: true });
    esit('açık silent:true uyarıda da geçerli',
      JSON.parse(f3.cagrilar[0].secenek.body).disable_notification, true);
    f3.geriAl();
    y.geriAl();
  }

  /* ---- 4. Uyarı sohbeti tanımlı değilse olağan sohbete düşer ---- */
  {
    const y = tgYukle(TAM_ENV);
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    await y.tg.sendTelegram('acil', { type: 'alert' });
    esit('TELEGRAM_ALERT_CHAT_ID yoksa olağan sohbet',
      JSON.parse(f.cagrilar[0].secenek.body).chat_id, '-1001234567890');
    f.geriAl(); y.geriAl();
  }

  /* ---- 5. BELİRTEÇ SIZMIYOR ---- */
  {
    const y = tgYukle(TAM_ENV);
    const f = fetchSapla([{ status: 401, json: { description: 'Unauthorized' } }]);
    const log = logYakala();

    const sonuc = await y.tg.sendTelegram('deneme', { type: 'scan' });

    log.geriAl(); f.geriAl();

    esit('401 başarısız', sonuc.ok, false);
    dogru('başarısızlık LOGLANIYOR (yutulmuyor)', log.satirlar.length >= 1);
    const hepsi = log.satirlar.join('\n');
    dogru('logda belirtecin tamamı YOK', hepsi.indexOf(BELIRTEC) === -1);
    dogru('logda belirtecin sır kısmı da YOK', hepsi.indexOf(SIR) === -1);
    dogru('logda api.telegram.org adresi YOK', hepsi.indexOf('api.telegram.org') === -1);
    dogru('log durum kodunu söylüyor', hepsi.indexOf('401') !== -1);

    /* gizle() doğrudan: ileride buraya bir ayrıntı eklenirse koruma sürüyor. */
    const y2 = tgYukle(TAM_ENV);
    dogru('gizle() belirteci siliyor',
      y2.tg.gizle('adres https://api.telegram.org/bot' + BELIRTEC + '/x')
        .indexOf(BELIRTEC) === -1);
    dogru('gizle() yalnız sır kısmını da siliyor',
      y2.tg.gizle('sir=' + SIR).indexOf(SIR) === -1);
    y2.geriAl();
    y.geriAl();
  }

  /* ---- 6. 429: kısa beklemede BİR kez tekrar ---- */
  {
    const y = tgYukle(TAM_ENV);
    const f = fetchSapla([
      { status: 429, json: { parameters: { retry_after: 0 } } },
      { status: 200, json: { ok: true } }
    ]);
    const log = logYakala();
    const sonuc = await y.tg.sendTelegram('deneme', { type: 'scan' });
    log.geriAl(); f.geriAl();
    esit('429 sonrası tekrar başarılı', sonuc.ok, true);
    esit('tam iki istek atıldı', f.cagrilar.length, 2);
    y.geriAl();
  }

  /* ---- 7. 429: uzun beklemede tekrar YOK ---- */
  {
    const y = tgYukle(TAM_ENV);
    const f = fetchSapla([{ status: 429, json: { parameters: { retry_after: 60 } } }]);
    const log = logYakala();
    const sonuc = await y.tg.sendTelegram('deneme', { type: 'scan' });
    log.geriAl(); f.geriAl();
    esit('uzun beklemede tek istek', f.cagrilar.length, 1);
    esit('sonuç rate_limited', sonuc.code, 'rate_limited');
    esit('başarısız', sonuc.ok, false);
    y.geriAl();
  }

  /* ---- 8. 500'de tekrar YOK (yalnızca 429'da tekrar) ---- */
  {
    const y = tgYukle(TAM_ENV);
    const f = fetchSapla([{ status: 500 }]);
    const log = logYakala();
    await y.tg.sendTelegram('deneme', { type: 'scan' });
    log.geriAl(); f.geriAl();
    esit('500 tekrar denenmiyor', f.cagrilar.length, 1);
    y.geriAl();
  }

  /* ---- 9. Ağ hatası ve zaman aşımı FIRLATMIYOR ---- */
  {
    const y = tgYukle(TAM_ENV);

    let f = fetchSapla([function () { throw new Error('ECONNRESET ' + BELIRTEC); }]);
    let log = logYakala();
    let sonuc = await y.tg.sendTelegram('deneme', { type: 'scan' });
    log.geriAl(); f.geriAl();
    esit('ağ hatasında fırlatmıyor', sonuc.ok, false);
    esit('kod unreachable', sonuc.code, 'unreachable');
    dogru('ağ hatası mesajındaki belirteç de loga girmiyor',
      log.satirlar.join('\n').indexOf(SIR) === -1);

    f = fetchSapla([function () {
      const e = new Error('abort'); e.name = 'AbortError'; throw e;
    }]);
    log = logYakala();
    sonuc = await y.tg.sendTelegram('deneme', { type: 'scan' });
    log.geriAl(); f.geriAl();
    esit('zaman aşımı kodu', sonuc.code, 'timeout');

    y.geriAl();
  }

  /* ---- 10. Yapılandırma yoksa ağa HİÇ çıkılmıyor ---- */
  {
    const y = tgYukle({});
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    const sonuc = await y.tg.sendTelegram('deneme', { type: 'scan' });
    f.geriAl();
    esit('yapılandırma yok: unconfigured', sonuc.code, 'unconfigured');
    esit('yapılandırma yok: istek atılmıyor', f.cagrilar.length, 0);
    y.geriAl();
  }

  /* ---- 11. Uzunluk kırpılıyor ve boş mesaj gönderilmiyor ---- */
  {
    const y = tgYukle(TAM_ENV);
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    await y.tg.sendTelegram('x'.repeat(9000), { type: 'scan' });
    const g = JSON.parse(f.cagrilar[0].secenek.body);
    dogru('metin Telegram sınırının altına kırpılıyor', g.text.length <= y.tg.MAX_UZUNLUK);
    dogru('kırpma işareti var', g.text.slice(-1) === '…');
    f.geriAl();

    const f2 = fetchSapla([{ status: 200, json: { ok: true } }]);
    const bos = await y.tg.sendTelegram('   ', { type: 'scan' });
    esit('boş mesaj gönderilmiyor', bos.code, 'empty');
    esit('boş mesajda istek yok', f2.cagrilar.length, 0);
    f2.geriAl();
    y.geriAl();
  }

  /* ---- 12. ucuSar: 500 uyarır, 503 uyarmaz, işaretli olan uyarmaz ---- */
  {
    const y = tgYukle(TAM_ENV);

    let f = fetchSapla([{ status: 200, json: { ok: true } }]);
    let res = sahteRes();
    await y.tg.ucuSar(async function (req, r) {
      r.status(500).json({ error: { code: 'bum' } });
    }, '/api/deneme')({}, res);
    esit('500 kritik uyarı üretiyor', f.cagrilar.length, 1);
    dogru('uyarı metni ucu ve kodu söylüyor',
      JSON.parse(f.cagrilar[0].secenek.body).text
        .indexOf('/api/deneme 500') !== -1);
    esit('yanıt bozulmuyor', res.statusCode, 500);
    f.geriAl();

    f = fetchSapla([{ status: 200, json: { ok: true } }]);
    res = sahteRes();
    await y.tg.ucuSar(async function (req, r) {
      r.status(503).json({ error: { code: 'service_unavailable' } });
    }, '/api/deneme')({}, res);
    esit('503 uyarı ÜRETMİYOR', f.cagrilar.length, 0);
    f.geriAl();

    f = fetchSapla([{ status: 200, json: { ok: true } }]);
    res = sahteRes();
    await y.tg.ucuSar(async function (req, r) {
      r.status(502).json({ error: { code: 'unreachable' } });
    }, '/api/deneme')({}, res);
    esit('502 uyarı üretiyor', f.cagrilar.length, 1);
    f.geriAl();

    f = fetchSapla([{ status: 200, json: { ok: true } }]);
    res = sahteRes();
    await y.tg.ucuSar(async function (req, r) {
      y.tg.bildirimIsaretle(r);
      r.status(500).json({ error: { code: 'bum' } });
    }, '/api/deneme')({}, res);
    esit('uç kendi bildirimini gönderdiyse ikinci mesaj YOK', f.cagrilar.length, 0);
    f.geriAl();

    esit('200 uyarı üretmiyor', (function () { return 0; })(), 0);
    f = fetchSapla([{ status: 200, json: { ok: true } }]);
    res = sahteRes();
    await y.tg.ucuSar(async function (req, r) {
      r.status(200).json({ ok: true });
    }, '/api/deneme')({}, res);
    esit('200 yolunda istek yok', f.cagrilar.length, 0);
    f.geriAl();
    y.geriAl();
  }

  /* ---- 13. ucuSar: fırlatan handler 500 döndürüyor ve uyarıyor ---- */
  {
    const y = tgYukle(TAM_ENV);
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    const log = logYakala();
    const res = sahteRes();
    await y.tg.ucuSar(async function () {
      /* Yayında olan tam buydu: `db is not defined`. */
      throw new ReferenceError('db is not defined');
    }, '/api/scan')({}, res);
    log.geriAl(); f.geriAl();

    esit('fırlatan handler 500 döndürüyor', res.statusCode, 500);
    esit('gövde internal_error', res.body && res.body.error && res.body.error.code,
      'internal_error');
    esit('fırlatma uyarı üretiyor', f.cagrilar.length, 1);
    dogru('uyarı exception diyor',
      JSON.parse(f.cagrilar[0].secenek.body).text.indexOf('exception') !== -1);
    y.geriAl();
  }

  /* ---- 14. /api/scan: başladı + bitti, sırayla ---- */
  {
    const y = tgYukle(TAM_ENV);
    const yollar = [];
    yollar.push(sapla('_lib/scanner.js', {
      scanSite: async function () {
        return {
          host: 'ornek.com', url: 'https://ornek.com/', score: 88,
          summary: { total: 10, passed: 7, failed: 3, skipped: 0 },
          checks: [], warnings: [], httpStatus: 200
        };
      },
      SCANNER_VERSION: 't', REPORT_VERSION: 't'
    }));
    yollar.push(sapla('_lib/db.js', { isConfigured: function () { return false; } }));
    yollar.push(sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      hitRateLimit: async function () { return { count: 1, ttl: 60 }; },
      reserveQuota: async function () { return { ok: true, used: 1 }; },
      refundQuota: async function () { return true; },
      quotaKey: function () { return 'k'; }
    }));
    yollar.push(sapla('_lib/session.js', {
      resolveOwner: async function () { return { userId: null, isAuthenticated: false }; },
      ownerRef: function () { return {}; },
      clientIp: function () { return '1.2.3.4'; },
      ipKey: function () { return 'ip'; }
    }));
    yollar.push(sapla('_lib/scanqueue.js', {
      isEnabled: function () { return false; },
      isConfigured: function () { return false; }
    }));

    const ucYolu = require.resolve(path.join(API, 'scan.js'));
    delete require.cache[ucYolu];
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    const res = sahteRes();
    await require(ucYolu)({
      method: 'POST', headers: {}, body: { url: 'https://ornek.com' },
      socket: {}, query: {}
    }, res);
    f.geriAl();

    esit('tarama 200 dönüyor', res.statusCode, 200);
    esit('iki bildirim: başladı ve bitti', f.cagrilar.length, 2);
    const metinler = f.cagrilar.map(function (c) {
      return JSON.parse(c.secenek.body).text;
    });
    dogru('ilki "Tarama başladı"', /Tarama başladı: ornek\.com$/.test(metinler[0]));
    dogru('ikincisi "Tarama bitti" ve risk sayısını veriyor',
      /Tarama bitti: ornek\.com — 3 risk \(puan 88\)$/.test(metinler[1]));

    delete require.cache[ucYolu];
    yollar.forEach(function (p) { delete require.cache[p]; });
    y.geriAl();
  }

  /* ---- 15. /api/scan: tarama düşünce uyarı, İKİ mesaj değil ---- */
  {
    const y = tgYukle(TAM_ENV);
    const yollar = [];
    yollar.push(sapla('_lib/scanner.js', {
      scanSite: async function () { throw new Error('unreachable'); },
      SCANNER_VERSION: 't', REPORT_VERSION: 't'
    }));
    yollar.push(sapla('_lib/db.js', { isConfigured: function () { return false; } }));
    yollar.push(sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      hitRateLimit: async function () { return { count: 1, ttl: 60 }; },
      reserveQuota: async function () { return { ok: true, used: 1 }; },
      refundQuota: async function () { return true; },
      quotaKey: function () { return 'k'; }
    }));
    yollar.push(sapla('_lib/session.js', {
      resolveOwner: async function () { return { userId: null, isAuthenticated: false }; },
      ownerRef: function () { return {}; },
      clientIp: function () { return '1.2.3.4'; },
      ipKey: function () { return 'ip'; }
    }));
    yollar.push(sapla('_lib/scanqueue.js', {
      isEnabled: function () { return false; },
      isConfigured: function () { return false; }
    }));

    const ucYolu = require.resolve(path.join(API, 'scan.js'));
    delete require.cache[ucYolu];
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    const log = logYakala();
    const res = sahteRes();
    await require(ucYolu)({
      method: 'POST', headers: {}, body: { url: 'https://ornek.com' },
      socket: {}, query: {}
    }, res);
    log.geriAl(); f.geriAl();

    esit('ulaşılamayan hedef 502', res.statusCode, 502);
    esit('başladı + başarısız: tam iki mesaj', f.cagrilar.length, 2);
    const son = JSON.parse(f.cagrilar[1].secenek.body);
    dogru('başarısızlık mesajı alan adını ve kodu taşıyor',
      /Tarama başarısız: ornek\.com — unreachable$/.test(son.text));
    esit('5xx başarısızlık uyarı sohbetine (sesli)', son.disable_notification, false);

    delete require.cache[ucYolu];
    yollar.forEach(function (p) { delete require.cache[p]; });
    y.geriAl();
  }

  /* ---- 16. /api/verify-dns: her sonuç bildiriliyor ---- */
  {
    const y = tgYukle(TAM_ENV);
    const gercekMail = require(path.join(API, '_lib', 'mail.js'));
    const yollar = [];
    yollar.push(sapla('_lib/mail.js', {
      alanAdi: gercekMail.alanAdi,
      spfDegerlendir: gercekMail.spfDegerlendir,
      dmarcDegerlendir: gercekMail.dmarcDegerlendir,
      spfDmarcKayitlari: async function (alan) {
        return {
          ok: true, alan: alan,
          spf: ['v=spf1 include:_spf.google.com -all'],
          dmarc: ['v=DMARC1; p=reject; rua=mailto:a@b.c'],
          dmarcAd: '_dmarc.' + alan,
          spfSorgu: { kesin: true }, dmarcSorgu: { kesin: true }
        };
      }
    }));
    yollar.push(sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      hitRateLimit: async function () { return { count: 1, ttl: 60 }; },
      cacheGet: async function () { return null; },
      cacheSet: async function () { return true; }
    }));
    yollar.push(sapla('_lib/session.js', {
      clientIp: function () { return '1.2.3.4'; }, ipKey: function () { return 'ip'; }
    }));
    /* DNSSEC ağa çıkmasın (yalnızca Telegram çağrısı sayılıyor). */
    yollar.push(sapla('_lib/dnssec.js', {
      dnssecDurumu: async function () { return { ok: true, enabled: true, zone: 'cyberlionai.com' }; }
    }));

    const ucYolu = require.resolve(path.join(API, 'verify-dns.js'));
    delete require.cache[ucYolu];
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    const res = sahteRes();
    await require(ucYolu)({
      method: 'POST', headers: {}, body: { domain: 'cyberlionai.com' },
      socket: {}, query: {}
    }, res);
    f.geriAl();

    esit('doğrulama 200', res.statusCode, 200);
    esit('tek bildirim', f.cagrilar.length, 1);
    esit('DNSSEC yanıtta', JSON.stringify(res.body && res.body.dnssec), JSON.stringify({ measured: true, enabled: true, zone: 'cyberlionai.com' }));
    esit('DNS bildirim metni',
      JSON.parse(f.cagrilar[0].secenek.body).text,
      '[CyberLion] 🛡️ DNS doğrulama: cyberlionai.com SPF pass / DMARC p=reject');

    delete require.cache[ucYolu];
    yollar.forEach(function (p) { delete require.cache[p]; });
    y.geriAl();
  }

  /* ---- 17. Hız sayacı: Telegram'ın 429'una girmeden önce duruyor ---- */
  {
    const y = tgYukle(Object.assign({}, TAM_ENV, {
      UPSTASH_REDIS_REST_URL: 'https://ornek.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'x'
    }));
    const yol = sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      hitRateLimit: async function () { return { count: 999, ttl: 60 }; }
    });
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    const log = logYakala();
    const sonuc = await y.tg.sendTelegram('deneme', { type: 'scan' });
    log.geriAl(); f.geriAl();
    esit('sınır aşılınca gönderilmiyor', sonuc.code, 'local_rate_limited');
    esit('sınır aşılınca Telegram\'a istek yok', f.cagrilar.length, 0);
    delete require.cache[yol];

    /* Depo DÜŞERSE bildirim yine gider: bu bir güvenlik sınırı değil. */
    const yol2 = sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      hitRateLimit: async function () { throw new Error('depo düştü'); }
    });
    const f2 = fetchSapla([{ status: 200, json: { ok: true } }]);
    const sonuc2 = await y.tg.sendTelegram('deneme', { type: 'scan' });
    f2.geriAl();
    esit('depo düşerse bildirim yine gidiyor', sonuc2.ok, true);
    delete require.cache[yol2];
    y.geriAl();
  }

  /* ---------- maskEmail: tam adres Telegram'a gitmez ---------- */
  {
    const y = tgYukle(TAM_ENV);
    const m = y.tg.maskEmail;
    esit('maskEmail olağan', m('Ali.Kotan@Gmail.com'), 'a***@gmail.com');
    esit('maskEmail tek harf', m('a@b.co'), 'a***@b.co');
    esit('maskEmail @ yok', m('ali'), '-');
    esit('maskEmail boş', m(null), '-');
    esit('maskEmail yerel kısım boş', m('@x.com'), '-');
    esit('maskEmail alan boş', m('ali@'), '-');
    dogru('maskEmail alandaki denetim/işaret atılıyor',
      m('a@ev\nil.com<b>').indexOf('\n') === -1 && m('a@evil.com<b>').indexOf('<') === -1);

    const EPOSTA = 'gizli.kisi@ornek.com';
    const mesajlar = [
      y.tg.mesaj.odemeBasladi('pro', EPOSTA, 299),
      y.tg.mesaj.odemeBasarili(EPOSTA, 'pro', 'ref-1', 299),
      y.tg.mesaj.odemeBeklemede(EPOSTA, 'pro', 'PENDING'),
      y.tg.mesaj.odemeBasarisiz(EPOSTA, 'iyzico_error'),
      y.tg.mesaj.autofixIstendi('ornek.com', EPOSTA, 'zone1', 'all'),
      y.tg.mesaj.beklemeListesi(EPOSTA, 'pro', 'ornek.com')
    ];
    mesajlar.forEach(function (metin, i) {
      dogru('yeni mesaj ' + i + ' tam e-posta taşımıyor', metin.indexOf(EPOSTA) === -1
        && metin.indexOf('gizli.kisi') === -1);
      dogru('yeni mesaj ' + i + ' maskeli e-posta taşıyor', metin.indexOf('g***@ornek.com') !== -1);
    });
    esit('ödeme başlatıldı biçimi', mesajlar[0],
      '[CyberLion] 💳 Ödeme başlatıldı: plan=PRO, email=g***@ornek.com, tutar=299 TL');
    esit('kuyruktan bitti biçimi', y.tg.mesaj.taramaBittiKuyruk('https://Ornek.com/a?b=c', 82, 3),
      '[CyberLion] ✅ Tarama bitti (kuyruktan): ornek.com, skor=82, risk=3');
    esit('autofix tamam biçimi', y.tg.mesaj.autofixTamam('ornek.com', 'all', 3),
      '[CyberLion] ✅ Autofix tamamlandı: ornek.com, tür=all, eklenen başlık=3');
    y.geriAl();
  }

  /* ---------- öncelikli hat ---------- */
  {
    const y = tgYukle(Object.assign({}, TAM_ENV, {
      UPSTASH_REDIS_REST_URL: 'https://ornek.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'x'
    }));
    const anahtarlar = [];
    const yol = sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      hitRateLimit: async function (k) {
        anahtarlar.push(k);
        /* Olağan kova dolu, öncelikli kova boş. */
        return { count: k === 'cl:rl:tg' ? 999 : 1, ttl: 60 };
      }
    });
    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    const log = logYakala();
    const olagan = await y.tg.sendTelegram('tarama', { type: 'scan' });
    const oncelik = await y.tg.sendTelegram('ödeme', { type: 'payment', priority: true });
    log.geriAl(); f.geriAl();
    esit('olağan kova doluyken olağan mesaj düşüyor', olagan.code, 'local_rate_limited');
    esit('olağan kova doluyken öncelikli mesaj gidiyor', oncelik.ok, true);
    dogru('öncelikli mesaj ayrı kovadan sayılıyor', anahtarlar.indexOf('cl:rl:tg:p') !== -1);
    delete require.cache[yol];

    /* Geçici hata (5xx): öncelikli mesaj bir kez tekrar deneniyor, olağan denenmiyor. */
    const yol2 = sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      hitRateLimit: async function () { return { count: 1, ttl: 60 }; }
    });
    const f2 = fetchSapla([{ status: 502 }, { status: 200, json: { ok: true } }]);
    const log2 = logYakala();
    const tekrar = await y.tg.sendTelegram('ödeme', { type: 'payment', priority: true });
    log2.geriAl(); f2.geriAl();
    esit('öncelikli mesaj 502 sonrası tekrar deneniyor', f2.cagrilar.length, 2);
    esit('tekrar başarılı', tekrar.ok, true);

    const f3 = fetchSapla([{ status: 502 }, { status: 200, json: { ok: true } }]);
    const log3 = logYakala();
    await y.tg.sendTelegram('tarama', { type: 'scan' });
    log3.geriAl(); f3.geriAl();
    esit('olağan mesaj 502 sonrası tekrar denenmiyor', f3.cagrilar.length, 1);
    delete require.cache[yol2];
    y.geriAl();
  }

  /* ---------- Gmail ile cevapla düğmesi ---------- */
  {
    const y = tgYukle(TAM_ENV);
    const url = y.tg.gmailComposeUrl('ali@ornek.com', 'Re: Konu', 'Merhaba Ali,\n\nCevap & 100%');
    const u = new URL(url);
    esit('gmail adresi', u.origin + u.pathname, 'https://mail.google.com/mail/');
    esit('gmail alıcı', u.searchParams.get('to'), 'ali@ornek.com');
    esit('gmail konu', u.searchParams.get('su'), 'Re: Konu');
    esit('gmail gövde (satır sonu ve & korunuyor)', u.searchParams.get('body'), 'Merhaba Ali,\n\nCevap & 100%');
    esit('gmail yeni ileti görünümü', u.searchParams.get('view'), 'cm');

    const kb = y.tg.buildSupportKeyboard('ali@ornek.com', 'Re: Konu', 'kısa');
    esit('düğme metni', kb.inline_keyboard[0][0].text, "📧 Gmail'de Cevapla");
    const uzun = y.tg.buildSupportKeyboard('ali@ornek.com', 'Re: Konu', 'çok uzun gövde '.repeat(400));
    const uzunUrl = uzun.inline_keyboard[0][0].url;
    dogru('uzun gövde sınıra kısaltılıyor', uzunUrl.length <= y.tg.DUGME_URL_MAX);
    esit('kısaltmada alıcı korunuyor', new URL(uzunUrl).searchParams.get('to'), 'ali@ornek.com');

    const f = fetchSapla([{ status: 200, json: { ok: true } }]);
    await y.tg.sendTelegram('deneme', { type: 'contact', replyMarkup: kb });
    const govde = JSON.parse(f.cagrilar[0].secenek.body);
    f.geriAl();
    esit('reply_markup gönderiliyor', govde.reply_markup.inline_keyboard[0][0].text, "📧 Gmail'de Cevapla");

    const f2 = fetchSapla([{ status: 200, json: { ok: true } }]);
    await y.tg.sendTelegram('deneme', { type: 'contact',
      replyMarkup: { inline_keyboard: [[{ text: 'x', url: 'http://duz.example' }]] } });
    await y.tg.sendTelegram('deneme', { type: 'contact',
      replyMarkup: { inline_keyboard: [[{ text: 'x', callback_data: 'sil' }]] } });
    await y.tg.sendTelegram('deneme', { type: 'contact' });
    const govdeler = f2.cagrilar.map(function (c) { return JSON.parse(c.secenek.body); });
    f2.geriAl();
    esit('http düğmesi atılıyor, mesaj gidiyor', govdeler[0].reply_markup, undefined);
    esit('callback düğmesi atılıyor', govdeler[1].reply_markup, undefined);
    esit('düğmesiz mesajda reply_markup yok', govdeler[2].reply_markup, undefined);
    y.geriAl();
  }

  /* ---------- tekSefer: aynı olay için tek bildirim ---------- */
  {
    const y = tgYukle(Object.assign({}, TAM_ENV, {
      UPSTASH_REDIS_REST_URL: 'https://ornek.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'x'
    }));
    const gorulen = {};
    const yol = sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      setOnce: async function (k) { if (gorulen[k]) return false; gorulen[k] = true; return true; }
    });
    esit('tekSefer ilk çağrı', await y.tg.tekSefer('done:j1'), true);
    esit('tekSefer ikinci çağrı', await y.tg.tekSefer('done:j1'), false);
    esit('tekSefer başka olay', await y.tg.tekSefer('done:j2'), true);
    delete require.cache[yol];

    const yol2 = sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      setOnce: async function () { throw new Error('depo düştü'); }
    });
    esit('tekSefer depo düşerse gönder', await y.tg.tekSefer('done:j3'), true);
    delete require.cache[yol2];
    y.geriAl();
  }

  if (hatalar.length) {
    console.error('\nTelegram sınaması: ' + hatalar.length + ' KALDI, '
      + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('Telegram sınaması: ' + gecti + ' / ' + gecti + ' geçti');
}

kos().catch(function (err) {
  console.error('sınama çöktü:', err && err.stack || err);
  process.exit(1);
});
