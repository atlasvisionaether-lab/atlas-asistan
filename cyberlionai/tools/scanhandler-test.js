'use strict';

/**
 * `/api/scan` ucunu GERÇEKTEN ÇAĞIRAN sınama.
 *
 * NEDEN BU DOSYA VAR
 *
 * Kuyruk dalı `_lib/queuestart.js`'e taşınırken `api/scan.js` içindeki
 * `const db = require('./_lib/db.js')` satırı silindi. Bayrak kapalı olduğu
 * için EŞZAMANLI yol çalışıyordu ve o yol `db.saveScan()` çağırıyor: yayında
 * her tarama `ReferenceError: db is not defined` ile 500 döndü.
 *
 * Mevcut sınamalar bunu YAKALAMADI, çünkü kaynakta `db.saveScan(` METNİNİ
 * arıyorlardı — metin yerindeydi, eksik olan bildirimdi. `node --check` de
 * yakalamaz: sözdizimi geçerli, hata çalışma anında. Dolayısıyla tek güvenilir
 * koruma ucu ÇAĞIRMAK.
 *
 * NASIL
 *
 * Ağ, veritabanı ve depo yok: `_lib/*` modülleri `require.cache`'e önceden
 * yerleştirilen saplamalarla değiştiriliyor. Uç gerçek kodla yürüyor, yalnızca
 * dış dünya sahte. Böylece hem tanımsız değişkenler hem de yanıt sözleşmesi
 * (durum kodu, gövde) sınanıyor.
 */

const path = require('node:path');
const Module = require('node:module');

const API = path.join(__dirname, '..', 'api');

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) {
  if (kosul) { gecti += 1; return; }
  hatalar.push(ad);
}
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen)
    + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

/** Modülü `require.cache`'e saplama olarak koyar. */
function sapla(gorecelYol, govde) {
  const tam = require.resolve(path.join(API, gorecelYol));
  const m = new Module(tam, null);
  m.filename = tam;
  m.loaded = true;
  m.exports = govde;
  require.cache[tam] = m;
  return tam;
}

/** Sahte yanıt nesnesi: Vercel'in `res` arayüzünün kullanılan kısmı. */
function sahteRes() {
  const res = {
    statusCode: null, body: null, headers: {}, bitti: false,
    setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; },
    status: function (k) { res.statusCode = k; return res; },
    json: function (b) { res.body = b; res.bitti = true; return res; },
    end: function () { res.bitti = true; return res; }
  };
  return res;
}

const SONUC = {
  host: 'ornek.com', url: 'https://ornek.com/', score: 88,
  summary: { total: 10, passed: 8, failed: 2, skipped: 0 },
  checks: [{ id: 'hsts', severity: 'high', status: 'fail', note: null }],
  warnings: [], httpStatus: 200, redirects: 0, durationMs: 120,
  country: 'TR', owaspFindings: [], owaspFailedCategories: {}
};

/**
 * Saplamaları kurar ve `api/scan.js`'i TAZE yükler.
 * @param {object} ayar { kuyruk: bool, kuyrukHazir: bool, kota: bool, hiz: bool }
 */
function ucuYukle(ayar) {
  const o = ayar || {};
  const yollar = [];

  yollar.push(sapla('_lib/scanner.js', {
    scanSite: async function () { return JSON.parse(JSON.stringify(SONUC)); },
    SCANNER_VERSION: 'test-scanner',
    REPORT_VERSION: 'test-report'
  }));

  const cagrilar = { saveScan: 0, saveOwaspJob: 0, refund: 0, enqueue: 0 };

  yollar.push(sapla('_lib/db.js', {
    isConfigured: function () { return true; },
    saveScan: async function () { cagrilar.saveScan += 1; return 'kayit-1'; },
    saveOwaspJob: async function () { cagrilar.saveOwaspJob += 1; return 'is-1'; },
    createPendingJob: async function () { return '0d517ead-cbcb-4bba-8b34-5d8e3da53847'; },
    markJobQueued: async function () { return {}; },
    markJobFailed: async function () { return {}; }
  }));

  yollar.push(sapla('_lib/store.js', {
    isConfigured: function () { return true; },
    quotaKey: function () { return 'kota:1'; },
    hitRateLimit: async function () {
      return o.hiz === false ? { count: 999, ttl: 30 } : { count: 1, ttl: 60 };
    },
    reserveQuota: async function () {
      return o.kota === false ? { ok: false, used: 3 } : { ok: true, used: 1 };
    },
    refundQuota: async function () { cagrilar.refund += 1; }
  }));

  yollar.push(sapla('_lib/session.js', {
    resolveOwner: async function () {
      return { userId: null, sessionId: 'oturum-1', isAuthenticated: false, isNewSession: false };
    },
    ownerRef: function (owner) { return owner; },
    clientIp: function () { return '203.0.113.9'; },
    ipKey: function (ip) { return ip; }
  }));

  yollar.push(sapla('_lib/scanqueue.js', {
    isEnabled: function () { return o.kuyruk === true; },
    isConfigured: function () { return o.kuyrukHazir !== false; },
    enqueue: async function () { cagrilar.enqueue += 1; }
  }));

  /* `queuestart.js` SAPLANMIYOR: gerçek kodu koşmalı. Kendi bağımlılıkları
     (db, scanqueue, guard) yukarıdaki saplamalardan geliyor. */
  const ucYolu = require.resolve(path.join(API, 'scan.js'));
  delete require.cache[ucYolu];
  delete require.cache[require.resolve(path.join(API, '_lib/queuestart.js'))];
  const handler = require(ucYolu);
  return { handler: handler, cagrilar: cagrilar, yollar: yollar.concat([ucYolu]) };
}

function temizle(yollar) {
  yollar.forEach(function (y) { delete require.cache[y]; });
}

function istek(govde) {
  return { method: 'POST', body: govde || { url: 'ornek.com' }, query: {}, headers: {} };
}

async function kos() {
  /* ---- 1. Eşzamanlı yol (bayrak KAPALI) — yayındaki varsayılan ---- */
  {
    const k = ucuYukle({ kuyruk: false });
    const res = sahteRes();
    let firlatti = null;
    try {
      await k.handler(istek(), res);
    } catch (err) {
      firlatti = err;
    }
    /* Asıl sınama bu: tanımsız bir değişken varsa burada ReferenceError
       fırlar ve yayında 500 demek olurdu. */
    esit('eşzamanlı yol hata FIRLATMIYOR', firlatti ? String(firlatti.message) : 'yok', 'yok');
    esit('eşzamanlı yol 200 dönüyor', res.statusCode, 200);
    dogru('eşzamanlı yol sonucu gövdede',
      res.body && res.body.score === 88 && res.body.host === 'ornek.com');
    dogru('eşzamanlı yol kotayı bildiriyor', !!(res.body && res.body.quota));
    esit('eşzamanlı yol cl_scans kaydı açıyor', k.cagrilar.saveScan, 1);
    esit('eşzamanlı yol OWASP işi açıyor', k.cagrilar.saveOwaspJob, 1);
    esit('eşzamanlı yolda kuyruğa mesaj GİTMİYOR', k.cagrilar.enqueue, 0);
    temizle(k.yollar);
  }

  /* ---- 2. Kuyruk yolu (bayrak AÇIK) ---- */
  {
    const k = ucuYukle({ kuyruk: true });
    const res = sahteRes();
    let firlatti = null;
    try {
      await k.handler(istek(), res);
    } catch (err) { firlatti = err; }
    esit('kuyruk yolu hata FIRLATMIYOR', firlatti ? String(firlatti.message) : 'yok', 'yok');
    esit('kuyruk yolu 202 dönüyor', res.statusCode, 202);
    dogru('kuyruk yolu iş kimliği dönüyor', !!(res.body && res.body.jobId));
    dogru('kuyruk yolu durum adresi dönüyor',
      !!(res.body && res.body.statusUrl && res.body.statusUrl.indexOf('/api/scan-status?id=') === 0));
    esit('kuyruk yolu mesajı kuyruğa bırakıyor', k.cagrilar.enqueue, 1);
    esit('kuyruk yolunda eşzamanlı kayıt AÇILMIYOR', k.cagrilar.saveScan, 0);
    temizle(k.yollar);
  }

  /* ---- 3. Bayrak açık ama kuyruk hazır değil: kota İADE edilmeli ---- */
  {
    const k = ucuYukle({ kuyruk: true, kuyrukHazir: false });
    const res = sahteRes();
    await k.handler(istek(), res);
    esit('kuyruk hazır değilse 503', res.statusCode, 503);
    esit('kuyruk hazır değilse kota iade edildi', k.cagrilar.refund, 1);
    esit('kuyruk hazır değilse eşzamanlı yola DÜŞÜLMÜYOR', k.cagrilar.saveScan, 0);
    temizle(k.yollar);
  }

  /* ---- 4. Kota dolu ---- */
  {
    const k = ucuYukle({ kuyruk: false, kota: false });
    const res = sahteRes();
    await k.handler(istek(), res);
    esit('kota dolunca 402', res.statusCode, 402);
    esit('kota dolunca tarama YAPILMIYOR', k.cagrilar.saveScan, 0);
    temizle(k.yollar);
  }

  /* ---- 5. Hız sınırı ---- */
  {
    const k = ucuYukle({ kuyruk: false, hiz: false });
    const res = sahteRes();
    await k.handler(istek(), res);
    esit('hız sınırında 429', res.statusCode, 429);
    dogru('hız sınırında Retry-After var', !!res.headers['retry-after']);
    esit('hız sınırında kota HARCANMIYOR', k.cagrilar.saveScan, 0);
    temizle(k.yollar);
  }

  /* ---- 6. Eksik gövde ve yanlış yöntem ---- */
  {
    const k = ucuYukle({ kuyruk: false });
    const res = sahteRes();
    await k.handler({ method: 'POST', body: {}, query: {}, headers: {} }, res);
    esit('adres yoksa 400', res.statusCode, 400);

    const res2 = sahteRes();
    await k.handler({ method: 'GET', query: {}, headers: {} }, res2);
    esit('GET için 405', res2.statusCode, 405);
    esit('405 Allow başlığı veriyor', res2.headers['allow'], 'POST');
    temizle(k.yollar);
  }

  /* ---- 7. /api/enqueue-scan da gerçekten çağrılıyor ---- */
  {
    const k = ucuYukle({ kuyruk: true });
    const ucYolu = require.resolve(path.join(API, 'enqueue-scan.js'));
    delete require.cache[ucYolu];
    const handler = require(ucYolu);
    const res = sahteRes();
    let firlatti = null;
    try {
      await handler(istek(), res);
    } catch (err) { firlatti = err; }
    esit('enqueue-scan hata FIRLATMIYOR', firlatti ? String(firlatti.message) : 'yok', 'yok');
    esit('enqueue-scan 200 dönüyor', res.statusCode, 200);
    dogru('enqueue-scan scanId dönüyor', !!(res.body && res.body.scanId));
    delete require.cache[ucYolu];
    temizle(k.yollar);
  }

  /* ---- 8. Kuyruk kapalıyken enqueue-scan 404 ve kota harcamıyor ---- */
  {
    const k = ucuYukle({ kuyruk: false });
    const ucYolu = require.resolve(path.join(API, 'enqueue-scan.js'));
    delete require.cache[ucYolu];
    const handler = require(ucYolu);
    const res = sahteRes();
    await handler(istek(), res);
    esit('kuyruk kapalıyken enqueue-scan 404', res.statusCode, 404);
    esit('404 kota HARCAMIYOR', k.cagrilar.refund, 0);
    delete require.cache[ucYolu];
    temizle(k.yollar);
  }

  if (hatalar.length) {
    console.error('\nUç sınaması: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('Uç sınaması: ' + gecti + ' / ' + gecti + ' geçti');
}

kos().catch(function (err) {
  console.error('sınama çöktü:', err && err.stack || err);
  process.exit(1);
});
