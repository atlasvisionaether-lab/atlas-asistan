'use strict';

/**
 * WORKFLOW 4'ün sınaması: FCM katmanı (`_lib/fcm.js`), cihaz jetonu kaydı
 * (`/api/device-token`) ve iki cron ucu (`/api/cron/scan-jobs/pending`,
 * `/api/cron/notify`).
 *
 * NEDEN BU DOSYA VAR — sessizce bozulabilen altı karar:
 *
 *   1. CİHAZ JETONU HİÇBİR YANITTA DÖNMEZ. Bir FCM jetonu o cihaza bildirim
 *      gönderme yetkisidir. Bu PR'ın amacı n8n'den bir kimlik bilgisini
 *      çıkarmak; bir uç jetonları gövdede dönmeye başlarsa aynı yüzey geri
 *      açılır ve hiçbir hata bunu göstermez.
 *   2. SAHİP OTURUMDAN GELİR, GÖVDEDEN DEĞİL. `/api/device-token` gövdedeki
 *      bir `userId`'ye bakarsa biri kendi cihazını başkasının hesabına
 *      bağlayıp o hesabın tarama bildirimlerini okuyabilir.
 *   3. ANONİM TARAMA = BİLDİRİM YOK. `scan_jobs.user_id` null ise hiçbir
 *      jeton dönmemeli; yoksa bir iş kimliğini tahmin eden biri başkasının
 *      cihazına bildirim yollatabilir.
 *   4. CRON UÇLARI CRON_SECRET'SİZ AÇILMAZ (fail-closed).
 *   5. BİLDİRİM METNİNDE ALAN ADI YOK. Bildirim kilit ekranında görünür.
 *   6. ÖZEL ANAHTAR VE ERİŞİM BELİRTECİ LOGLANMAZ.
 *
 * Ağ yok, veritabanı yok, Firebase yok: `_lib/*` ve `global.fetch` saplanıyor.
 */

const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

const API = path.join(__dirname, '..', 'api');
const NOTIFY = require.resolve(path.join(API, 'cron', 'notify.js'));
const PENDING = require.resolve(path.join(API, 'cron', 'scan-jobs', 'pending.js'));
const DEVTOK = require.resolve(path.join(API, 'device-token.js'));

const IS = '11111111-2222-3333-4444-555555555555';
const ANON_IS = '22222222-3333-4444-5555-666666666666';
const KULLANICI = '33333333-4444-5555-6666-777777777777';
const SIR = 'cron-sirri-yeterince-uzun-0123456789';
const JETON = 'fcm-jetonu-' + 'x'.repeat(140);
const JETON2 = 'ikinci-cihaz-' + 'y'.repeat(140);

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen)
    + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

const saplananlar = [];
function sapla(gorecelYol, govde) {
  const tam = require.resolve(path.join(API, gorecelYol));
  const m = new Module(tam, null);
  m.filename = tam; m.loaded = true; m.exports = govde;
  require.cache[tam] = m;
  saplananlar.push(tam);
}
function saplamalariSil() {
  saplananlar.forEach(function (p) { delete require.cache[p]; });
  saplananlar.length = 0;
  [NOTIFY, PENDING, DEVTOK].forEach(function (p) { delete require.cache[p]; });
}

function govde(res) { return (res && res.body) || {}; }
function kod(res) { return (res && res.body && res.body.error && res.body.error.code) || null; }

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

const RAPOR = {
  job_id: IS, domain: 'ornek-şirket.com.tr', risk_level: 'high',
  score: 41, scanner_score: 58, summary_tr: 'Üç önemli eksik var.'
};

function kur(d) {
  saplamalariSil();
  const ayar = d || {};
  const iz = {
    tokensForJob: [], drop: [], save: [], del: [], pending: [],
    fcmSend: [], tg: [], rate: []
  };

  sapla('_lib/db.js', {
    isConfigured: function () { return ayar.dbYok ? false : true; },
    deviceTokensForJob: async function (jobId) {
      iz.tokensForJob.push(jobId);
      if (ayar.dbFirlat) throw new Error('db_unreachable');
      if (ayar.isYok) return { job: null, tokens: [] };
      /* GERÇEK db.deviceTokensForJob anonim işte BOŞ dönüyor; sapla da öyle. */
      if (jobId === ANON_IS) return { job: { id: ANON_IS, user_id: null }, tokens: [] };
      if (ayar.cihazYok) return { job: { id: jobId, user_id: KULLANICI }, tokens: [] };
      return {
        job: { id: jobId, user_id: KULLANICI },
        tokens: [{ token: JETON, platform: 'android' }, { token: JETON2, platform: 'android' }]
      };
    },
    aiReportOf: async function () {
      if (ayar.raporFirlat) throw new Error('db_unreachable');
      return ayar.raporYok ? null : Object.assign({}, RAPOR);
    },
    dropDeviceToken: async function (t) { iz.drop.push(t); },
    jobsPendingNotify: async function (limit) {
      iz.pending.push(limit);
      if (ayar.pendingFirlat) throw new Error('db_unreachable');
      return [{ id: IS, created_at: '2026-10-08T00:00:00Z' },
              { id: ANON_IS, created_at: '2026-10-07T00:00:00Z' }];
    },
    saveDeviceToken: async function (u, t, p) {
      iz.save.push({ userId: u, token: t, platform: p });
      if (ayar.saveFirlat) throw new Error('db_error_400 token=' + t);
      return 'row1';
    },
    deleteDeviceToken: async function (u, t) { iz.del.push({ userId: u, token: t }); return 1; }
  });

  const gercekFcm = require(path.join(API, '_lib', 'fcm.js'));
  sapla('_lib/fcm.js', {
    isConfigured: function () { return ayar.fcmYok ? false : true; },
    jetonGecerliMi: gercekFcm.jetonGecerliMi,
    send: async function (jeton, mesaj) {
      iz.fcmSend.push({ jeton: jeton, mesaj: mesaj });
      if (ayar.fcmYetkiHatasi) return { ok: false, invalid: false, code: 'fcm_unauthorized' };
      if (ayar.fcmOluJeton) return { ok: false, invalid: true, code: 'UNREGISTERED' };
      if (ayar.fcmGecici) return { ok: false, invalid: false, code: 'fcm_unreachable' };
      return { ok: true, invalid: false, code: null };
    }
  });

  sapla('_lib/auth.js', {
    isConfigured: function () { return ayar.authYok ? false : true; },
    resolveUser: async function () { return ayar.girisYok ? null : { id: KULLANICI }; }
  });

  sapla('_lib/store.js', {
    isConfigured: function () { return ayar.storeYok ? false : true; },
    hitRateLimit: async function (k, w) {
      iz.rate.push({ key: k, window: w });
      if (ayar.rateFirlat) throw new Error('store_unreachable');
      return { count: ayar.rateAsildi ? 99 : 1, ttl: 120 };
    }
  });

  sapla('_lib/telegram.js', {
    sendTelegram: async function (m, o) { iz.tg.push({ mesaj: m, opt: o }); return { ok: true }; },
    bildirimIsaretle: function (res) { res.__clBildirildi = true; },
    mesaj: { hata: function (uc, durum, k) { return uc + ' ' + durum + ' ' + k; } },
    ucuSar: function (h) { return h; }
  });

  sapla('_lib/qstash.js', {
    isConfigured: function () { return false; },
    verify: function () { return { ok: false, reason: 'unconfigured' }; }
  });

  return { iz: iz };
}

async function cagir(yol, ayar, istek) {
  const k = kur(ayar);
  const handler = require(yol);
  const req = Object.assign({
    method: 'GET',
    headers: { authorization: 'Bearer ' + SIR },
    query: { jobId: IS }
  }, istek || {});
  const res = sahteRes();
  await handler(req, res);
  return { res: res, iz: k.iz };
}

async function kos() {
  const eskiSir = process.env.CRON_SECRET;
  const eskiSa = process.env.FIREBASE_SERVICE_ACCOUNT;
  const eskiHata = console.error;
  const eskiUyari = console.warn;
  const eskiFetch = global.fetch;
  const yakalanan = [];
  console.error = function () { yakalanan.push(Array.prototype.join.call(arguments, ' ')); };
  console.warn = function () { yakalanan.push(Array.prototype.join.call(arguments, ' ')); };
  process.env.CRON_SECRET = SIR;

  try {
    /* ================================================================ */
    /* 1. /api/cron/notify — mutlu yol                                   */
    /* ================================================================ */
    {
      const r = await cagir(NOTIFY, {});
      esit('notify 200', r.res.statusCode, 200);
      esit('iki cihaza da gitti', govde(r.res).sent, 2);
      esit('başarısız yok', govde(r.res).failed, 0);
      esit('düşürülen jeton yok', govde(r.res).dropped, 0);
      esit('yetki yolu cron', govde(r.res).via, 'cron');
      esit('FCM iki kez çağrıldı', r.iz.fcmSend.length, 2);
      esit('Cache-Control no-store', r.res.headers['cache-control'], 'no-store');
    }

    /* ---- JETON SIZINTISI: en önemli doğrulama ---- */
    {
      const r = await cagir(NOTIFY, {});
      const metin = JSON.stringify(govde(r.res));
      dogru('yanıt cihaz jetonu TAŞIMIYOR', metin.indexOf(JETON) === -1 && metin.indexOf(JETON2) === -1);
      dogru('yanıt jeton parçası bile taşımıyor', metin.indexOf('fcm-jetonu') === -1);
      dogru('yanıt kullanıcı kimliği taşımıyor', metin.indexOf(KULLANICI) === -1);
      dogru('yanıt alan adı taşımıyor', metin.indexOf('ornek-') === -1);
      dogru('yanıt özet taşımıyor', metin.indexOf('eksik var') === -1);
      dogru('loglarda jeton yok', yakalanan.join('|').indexOf(JETON) === -1);
    }

    /* ---- Bildirim metni ---- */
    {
      const r = await cagir(NOTIFY, {});
      const m = r.iz.fcmSend[0].mesaj;
      esit('başlık sabit', m.title, 'Tarama bitti');
      dogru('gövde risk seviyesi taşıyor', m.body.indexOf('Yüksek risk') !== -1);
      dogru('gövde MOTORUN puanını taşıyor (58)', m.body.indexOf('58') !== -1);
      dogru('gövde modelin puanını (41) TAŞIMIYOR', m.body.indexOf('41') === -1);
      dogru('gövde alan adı TAŞIMIYOR (kilit ekranı)', m.body.indexOf('ornek-') === -1);
      esit('data.jobId', m.data.jobId, IS);
      esit('data.pdfKey WORKFLOW 3 ile aynı yol', m.data.pdfKey, 'ai/' + IS + '.pdf');
      dogru('data alan adı taşımıyor', JSON.stringify(m.data).indexOf('ornek-') === -1);
    }
    {
      const r = await cagir(NOTIFY, { raporYok: true });
      esit('rapor yoksa bildirim yine gidiyor', govde(r.res).sent, 2);
      esit('genel metin', r.iz.fcmSend[0].mesaj.body, 'Raporunuz hazır.');
    }
    {
      const r = await cagir(NOTIFY, { raporFirlat: true });
      esit('rapor okunamazsa bildirim yine gidiyor', govde(r.res).sent, 2);
    }

    /* ---- ANONİM TARAMA ---- */
    {
      const r = await cagir(NOTIFY, {}, { query: { jobId: ANON_IS } });
      esit('anonim iş 200', r.res.statusCode, 200);
      esit('anonim işe bildirim GİTMİYOR', govde(r.res).sent, 0);
      esit('anonim işte FCM hiç çağrılmıyor', r.iz.fcmSend.length, 0);
      esit('sebep no_devices', govde(r.res).reason, 'no_devices');
    }
    {
      const r = await cagir(NOTIFY, { cihazYok: true });
      esit('cihazı olmayan kullanıcı hata değil', r.res.statusCode, 200);
      esit('gönderim yok', govde(r.res).sent, 0);
    }

    /* ---- Ölü jeton düşürülüyor ---- */
    {
      const r = await cagir(NOTIFY, { fcmOluJeton: true });
      esit('ölü jetonlar düşürüldü', govde(r.res).dropped, 2);
      esit('düşürme çağrıldı', r.iz.drop.length, 2);
      esit('gönderim sayılmadı', govde(r.res).sent, 0);
      dogru('yanıt düşürülen jetonu yazmıyor', JSON.stringify(govde(r.res)).indexOf(JETON) === -1);
    }
    {
      const r = await cagir(NOTIFY, { fcmGecici: true });
      esit('geçici hata jetonu DÜŞÜRMÜYOR', govde(r.res).dropped, 0);
      esit('başarısız sayıldı', govde(r.res).failed, 2);
      esit('her iki cihaz da denendi', r.iz.fcmSend.length, 2);
    }
    {
      const r = await cagir(NOTIFY, { fcmYetkiHatasi: true });
      esit('kimlik hatası 502', r.res.statusCode, 502);
      esit('kod fcm_unauthorized', kod(r.res), 'fcm_unauthorized');
      esit('ilk hatada durdu, ikinci cihaz denenmedi', r.iz.fcmSend.length, 1);
      esit('Telegram uyarısı üretildi', r.iz.tg.length, 1);
      dogru('çift bildirim işareti', r.res.__clBildirildi === true);
    }

    /* ---- notify yetki ve girdi ---- */
    {
      const r = await cagir(NOTIFY, {}, { headers: {} });
      esit('notify sırsız 401', r.res.statusCode, 401);
      esit('yetkisizde jeton sorgulanmıyor', r.iz.tokensForJob.length, 0);
      esit('yetkisizde FCM çağrılmıyor', r.iz.fcmSend.length, 0);
    }
    {
      const r = await cagir(NOTIFY, {}, { headers: { authorization: 'Bearer yanlis-sir-ayni-uzunlukta-01234' } });
      esit('yanlış sır 401', r.res.statusCode, 401);
      esit('yanlış sırda FCM yok', r.iz.fcmSend.length, 0);
    }
    {
      delete process.env.CRON_SECRET;
      const r = await cagir(NOTIFY, {}, { headers: {} });
      esit('sır yapılandırılmamışsa 503 (fail-closed)', r.res.statusCode, 503);
      esit('kod cron_unconfigured', kod(r.res), 'cron_unconfigured');
      process.env.CRON_SECRET = SIR;
    }
    {
      const r = await cagir(NOTIFY, {}, { query: {} });
      esit('jobId yoksa 400', r.res.statusCode, 400);
      esit('jobId yoksa jeton sorgulanmıyor', r.iz.tokensForJob.length, 0);
    }
    {
      const r = await cagir(NOTIFY, {}, { query: { jobId: 'hepsi' } });
      esit('uuid olmayan jobId 400', r.res.statusCode, 400);
    }
    {
      /* Gövdeye kullanıcı koymak kimi hedefleyeceğimizi DEĞİŞTİRMEMELİ. */
      const r = await cagir(NOTIFY, {}, {
        method: 'POST',
        body: { userId: 'baska-hesap', token: 'ele-gecirilmis-jeton' },
        query: { jobId: IS }
      });
      esit('POST da kabul', r.res.statusCode, 200);
      dogru('gövdedeki jeton FCM\'e GİTMEDİ',
        r.iz.fcmSend.every(function (c) { return c.jeton !== 'ele-gecirilmis-jeton'; }));
      esit('hedefler yalnızca veritabanından', r.iz.fcmSend.length, 2);
    }
    {
      const r = await cagir(NOTIFY, { isYok: true });
      esit('olmayan iş 404', r.res.statusCode, 404);
      esit('kod no_job', kod(r.res), 'no_job');
    }
    {
      const r = await cagir(NOTIFY, { fcmYok: true });
      esit('FCM yapılandırılmamışsa 503', r.res.statusCode, 503);
      esit('kod fcm_unconfigured', kod(r.res), 'fcm_unconfigured');
      esit('FCM yoksa jeton bile okunmuyor', r.iz.tokensForJob.length, 0);
    }
    {
      const r = await cagir(NOTIFY, { dbFirlat: true });
      esit('db düşerse 503', r.res.statusCode, 503);
      esit('kod tokens_unavailable', kod(r.res), 'tokens_unavailable');
    }
    {
      const r = await cagir(NOTIFY, {}, { method: 'DELETE' });
      esit('notify DELETE 405', r.res.statusCode, 405);
      esit('Allow başlığı', r.res.headers.allow, 'GET, POST');
    }

    /* ================================================================ */
    /* 2. /api/cron/scan-jobs/pending                                    */
    /* ================================================================ */
    {
      const r = await cagir(PENDING, {}, { query: {} });
      esit('pending 200', r.res.statusCode, 200);
      esit('iki iş döndü', govde(r.res).count, 2);
      esit('varsayılan limit 10', r.iz.pending[0], 10);
      const metin = JSON.stringify(govde(r.res));
      dogru('pending yanıtı YALNIZCA jobId taşıyor',
        metin.indexOf('created_at') === -1 && metin.indexOf('user_id') === -1
        && metin.indexOf('url') === -1);
      dogru('ilk iş kimliği var', (govde(r.res).jobs || [])[0] && govde(r.res).jobs[0].jobId === IS);
    }
    {
      const r = await cagir(PENDING, {}, { query: { limit: '999' } });
      esit('limit 50 ile sınırlı', r.iz.pending[0], 50);
    }
    {
      const r = await cagir(PENDING, {}, { query: { limit: '0' } });
      esit('limit en az 1', r.iz.pending[0], 1);
    }
    {
      const r = await cagir(PENDING, {}, { query: { limit: 'abc' } });
      esit('sayı olmayan limit varsayılana düşüyor', r.iz.pending[0], 10);
    }
    {
      const r = await cagir(PENDING, {}, { headers: {}, query: {} });
      esit('pending sırsız 401', r.res.statusCode, 401);
      esit('yetkisizde sorgu yapılmıyor', r.iz.pending.length, 0);
    }
    {
      delete process.env.CRON_SECRET;
      const r = await cagir(PENDING, {}, { headers: {}, query: {} });
      esit('pending fail-closed 503', r.res.statusCode, 503);
      process.env.CRON_SECRET = SIR;
    }
    {
      const r = await cagir(PENDING, { pendingFirlat: true }, { query: {} });
      esit('pending db hatası 503', r.res.statusCode, 503);
      esit('kod jobs_unavailable', kod(r.res), 'jobs_unavailable');
    }

    /* ================================================================ */
    /* 3. /api/device-token                                              */
    /* ================================================================ */
    {
      const r = await cagir(DEVTOK, {}, { method: 'POST', body: { token: JETON } });
      esit('kayıt 200', r.res.statusCode, 200);
      esit('ok true', govde(r.res).ok, true);
      esit('varsayılan platform android', govde(r.res).platform, 'android');
      dogru('YANIT JETONU DÖNDÜRMÜYOR', JSON.stringify(govde(r.res)).indexOf(JETON) === -1);
      esit('bir kayıt yapıldı', r.iz.save.length, 1);
      esit('SAHİP OTURUMDAN geldi', r.iz.save[0].userId, KULLANICI);
    }
    {
      /* Gövdedeki userId yok sayılmalı. */
      const r = await cagir(DEVTOK, {}, {
        method: 'POST',
        body: { token: JETON, userId: 'kurban-hesap', user_id: 'kurban-hesap' }
      });
      esit('gövdedeki userId YOK SAYILDI', r.iz.save[0].userId, KULLANICI);
    }
    {
      const r = await cagir(DEVTOK, {}, { method: 'POST', body: { token: JETON, platform: 'ios' } });
      esit('ios kabul', govde(r.res).platform, 'ios');
    }
    {
      const r = await cagir(DEVTOK, {}, { method: 'POST', body: { token: JETON, platform: 'symbian' } });
      esit('tanınmayan platform android\'e düşüyor', govde(r.res).platform, 'android');
    }
    {
      const r = await cagir(DEVTOK, { girisYok: true }, { method: 'POST', body: { token: JETON } });
      esit('giriş yoksa 401', r.res.statusCode, 401);
      esit('giriş yoksa kayıt yok', r.iz.save.length, 0);
    }
    {
      const r = await cagir(DEVTOK, {}, { method: 'POST', body: { token: 'kisa' } });
      esit('kısa jeton 400', r.res.statusCode, 400);
      esit('kod bad_token', kod(r.res), 'bad_token');
      esit('kısa jetonda oturum bile çözülmedi (kayıt yok)', r.iz.save.length, 0);
    }
    {
      const r = await cagir(DEVTOK, {}, { method: 'POST', body: { token: 'x'.repeat(5000) } });
      esit('çok uzun jeton 400', r.res.statusCode, 400);
    }
    {
      const r = await cagir(DEVTOK, {}, { method: 'POST', body: {} });
      esit('jetonsuz gövde 400', r.res.statusCode, 400);
    }
    {
      const r = await cagir(DEVTOK, { rateAsildi: true }, { method: 'POST', body: { token: JETON } });
      esit('hız sınırı 429', r.res.statusCode, 429);
      esit('sınırda kayıt yok', r.iz.save.length, 0);
      dogru('Retry-After var', !!r.res.headers['retry-after']);
    }
    {
      const r = await cagir(DEVTOK, { rateFirlat: true }, { method: 'POST', body: { token: JETON } });
      esit('sayaç deposu düşse de kayıt sürüyor', r.res.statusCode, 200);
    }
    {
      yakalanan.length = 0;
      const r = await cagir(DEVTOK, { saveFirlat: true }, { method: 'POST', body: { token: JETON } });
      esit('kayıt hatası 503', r.res.statusCode, 503);
      dogru('HATA LOGUNDA JETON YOK', yakalanan.join('|').indexOf(JETON) === -1);
      dogru('yanıtta jeton yok', JSON.stringify(govde(r.res)).indexOf(JETON) === -1);
    }
    {
      const r = await cagir(DEVTOK, {}, { method: 'DELETE', body: { token: JETON } });
      esit('silme 200', r.res.statusCode, 200);
      esit('silme sahiplikle yapıldı', r.iz.del[0].userId, KULLANICI);
      esit('silinen sayısı', govde(r.res).removed, 1);
    }
    {
      const r = await cagir(DEVTOK, {}, { method: 'GET' });
      esit('GET 405', r.res.statusCode, 405);
      esit('Allow başlığı', r.res.headers.allow, 'POST, DELETE');
    }
    {
      const r = await cagir(DEVTOK, {}, {
        method: 'POST', body: JSON.stringify({ token: JETON })
      });
      esit('dizge gövde ayrıştırılıyor', r.res.statusCode, 200);
    }

    /* ================================================================ */
    /* 4. _lib/fcm.js — gerçek modül                                     */
    /* ================================================================ */
    saplamalariSil();
    delete require.cache[require.resolve(path.join(API, '_lib', 'fcm.js'))];
    const F = require(path.join(API, '_lib', 'fcm.js'));

    {
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
      F._onbellegiSifirla();
      dogru('servis hesabı yoksa katman kapalı', F.isConfigured() === false);
      const s = await F.send(JETON, { title: 'a', body: 'b' });
      esit('kapalıyken unconfigured', s.code, 'unconfigured');
      esit('kapalıyken ok false', s.ok, false);
    }
    {
      process.env.FIREBASE_SERVICE_ACCOUNT = '{bozuk json';
      F._onbellegiSifirla();
      dogru('bozuk JSON kapalı sayılıyor', F.isConfigured() === false);
      process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'p' });
      dogru('eksik alanlı hesap kapalı sayılıyor', F.isConfigured() === false);
    }

    /* Gerçek bir RSA anahtarı üretip imzalama yolunu GERÇEKTEN koşturuyoruz:
       kaynakta dizgi aramak, imzanın atıldığını göstermez. */
    const cift = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const OZEL = cift.privateKey.export({ type: 'pkcs8', format: 'pem' });
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: 'cyberlion-test',
      client_email: 'push@cyberlion-test.iam.gserviceaccount.com',
      private_key: OZEL.replace(/\n/g, '\\n')
    });
    F._onbellegiSifirla();
    dogru('geçerli hesapla katman açık', F.isConfigured() === true);

    {
      const istekler = [];
      global.fetch = async function (url, opt) {
        istekler.push({ url: String(url), opt: opt });
        if (String(url).indexOf('oauth2.googleapis.com') !== -1) {
          return { ok: true, status: 200, json: async function () {
            return { access_token: 'ya29.sahte-erisim-belirteci', expires_in: 3600 }; } };
        }
        return { ok: true, status: 200, text: async function () { return '{}'; },
          json: async function () { return {}; } };
      };

      F._onbellegiSifirla();
      const s = await F.send(JETON, { title: 'Tarama bitti', body: 'Yüksek risk', data: { jobId: IS, n: 5 } });
      esit('gönderim başarılı', s.ok, true);
      dogru('dönüş değerinde JETON YOK', JSON.stringify(s).indexOf(JETON) === -1);
      esit('iki istek: belirteç + gönderim', istekler.length, 2);

      /* JWT gerçekten imzalanmış mı? Açık anahtarla doğruluyoruz. */
      const govdeMetni = String(istekler[0].opt.body);
      const assertion = decodeURIComponent((govdeMetni.match(/assertion=([^&]+)/) || [])[1] || '');
      const parca = assertion.split('.');
      esit('JWT üç parçalı', parca.length, 3);
      const imza = Buffer.from(parca[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      dogru('JWT imzası servis hesabının anahtarıyla DOĞRULANIYOR',
        crypto.createVerify('RSA-SHA256').update(parca[0] + '.' + parca[1]).end()
          .verify(cift.publicKey, imza));
      const basl = JSON.parse(Buffer.from(parca[0], 'base64').toString());
      esit('alg RS256', basl.alg, 'RS256');
      const jwtGovde = JSON.parse(Buffer.from(parca[1], 'base64').toString());
      esit('iss servis hesabı', jwtGovde.iss, 'push@cyberlion-test.iam.gserviceaccount.com');
      dogru('scope firebase.messaging', jwtGovde.scope.indexOf('firebase.messaging') !== -1);

      /* FCM isteği */
      const fcmIstek = istekler[1];
      dogru('FCM v1 adresi, proje kimliğiyle',
        fcmIstek.url === 'https://fcm.googleapis.com/v1/projects/cyberlion-test/messages:send');
      esit('Authorization erişim belirteciyle',
        fcmIstek.opt.headers.Authorization, 'Bearer ya29.sahte-erisim-belirteci');
      const g = JSON.parse(fcmIstek.opt.body);
      esit('jeton mesajda', g.message.token, JETON);
      esit('data değerleri DİZGEYE çevrildi', g.message.data.n, '5');
      esit('android öncelik yüksek', g.message.android.priority, 'high');
      dogru('özel anahtar istekte YOK', fcmIstek.opt.body.indexOf('BEGIN') === -1);

      /* Önbellek: ikinci gönderim yeniden belirteç ALMAMALI. */
      istekler.length = 0;
      await F.send(JETON2, { title: 'a', body: 'b' });
      esit('belirteç önbellekten, tek istek', istekler.length, 1);
      dogru('tek istek FCM\'e', istekler[0].url.indexOf('fcm.googleapis.com') !== -1);
    }

    {
      /* Ölü jeton: UNREGISTERED invalid=true vermeli. */
      global.fetch = async function (url) {
        if (String(url).indexOf('oauth2') !== -1) {
          return { ok: true, status: 200, json: async function () {
            return { access_token: 'tok', expires_in: 3600 }; } };
        }
        return { ok: false, status: 404,
          text: async function () { return JSON.stringify({ error: { status: 'UNREGISTERED' } }); } };
      };
      F._onbellegiSifirla();
      const s = await F.send(JETON, { title: 'a', body: 'b' });
      esit('UNREGISTERED ok false', s.ok, false);
      esit('UNREGISTERED invalid true', s.invalid, true);
      esit('kod geçiyor', s.code, 'UNREGISTERED');
      dogru('dönüşte jeton yok', JSON.stringify(s).indexOf(JETON) === -1);
    }
    {
      global.fetch = async function (url) {
        if (String(url).indexOf('oauth2') !== -1) {
          return { ok: true, status: 200, json: async function () {
            return { access_token: 'tok', expires_in: 3600 }; } };
        }
        return { ok: false, status: 503,
          text: async function () { return JSON.stringify({ error: { status: 'UNAVAILABLE' } }); } };
      };
      F._onbellegiSifirla();
      const s = await F.send(JETON, { title: 'a', body: 'b' });
      esit('geçici hata invalid DEĞİL', s.invalid, false);
      esit('kod UNAVAILABLE', s.code, 'UNAVAILABLE');
    }
    {
      /* Kimlik hatası: Google bazen assertion'ı yankılıyor — loglanmamalı. */
      yakalanan.length = 0;
      global.fetch = async function () {
        return { ok: false, status: 400,
          text: async function () { return 'invalid_grant assertion=EYJ...OZELANAHTARIZI'; },
          json: async function () { return { error: 'invalid_grant' }; } };
      };
      F._onbellegiSifirla();
      const s = await F.send(JETON, { title: 'a', body: 'b' });
      esit('kimlik hatası fcm_unauthorized', s.code, 'fcm_unauthorized');
      const log = yakalanan.join('|');
      dogru('kimlik hatası gövdesi LOGLANMIYOR', log.indexOf('assertion') === -1);
      dogru('logda özel anahtar yok', log.indexOf('BEGIN') === -1);
      dogru('logda jeton yok', log.indexOf(JETON) === -1);
    }
    {
      global.fetch = async function () { throw new Error('ağ yok'); };
      F._onbellegiSifirla();
      const s = await F.send(JETON, { title: 'a', body: 'b' });
      esit('ağ yoksa fırlatmıyor', s.ok, false);
      esit('kod fcm_auth_unreachable', s.code, 'fcm_auth_unreachable');
    }
    {
      esit('kısa jeton reddediliyor', F.jetonGecerliMi('kisa'), null);
      esit('null jeton reddediliyor', F.jetonGecerliMi(null), null);
      esit('sayı jeton reddediliyor', F.jetonGecerliMi(12345678901234567890), null);
      esit('uzun jeton reddediliyor', F.jetonGecerliMi('x'.repeat(5000)), null);
      esit('geçerli jeton kırpılıp dönüyor', F.jetonGecerliMi('  ' + JETON + ' '), JETON);
      esit('en az uzunluk 20', F.MIN_TOKEN_LENGTH, 20);
      const s = await F.send('kisa', { title: 'a', body: 'b' });
      esit('kısa jeton ağa çıkmıyor, invalid', s.invalid, true);
      esit('kod bad_token', s.code, 'bad_token');
    }

    /* ================================================================ */
    /* 5. GERÇEK db.js — sahte bir PostgREST'e karşı                     */
    /* ================================================================ */
    /* Yukarıdaki uç sınamaları `_lib/db.js`'i SAPLIYOR, yani "anonim
       taramada jeton dönmez" güvencesi orada DOĞRULANMIYOR: güvence
       sorgunun kendisinde yaşıyor. (Bu boşluk bir mutasyon koşusunda
       bulundu: db.js'teki `user_id` kontrolü kaldırıldığında uç sınamaları
       yeşil kaldı.) Burada gerçek modül, istekleri yakalayan sahte bir
       PostgREST'e karşı koşuyor. */
    {
      delete require.cache[require.resolve(path.join(API, '_lib', 'db.js'))];
      const eskiUrl = process.env.SUPABASE_URL;
      const eskiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.SUPABASE_URL = 'https://sahte.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'servis-rolu-anahtari-sahte';
      const D = require(path.join(API, '_lib', 'db.js'));

      const istekler = [];
      function kurFetch(yanitla) {
        global.fetch = async function (url, opt) {
          istekler.push({ url: String(url), opt: opt || {} });
          const govdeler = yanitla(String(url), opt || {});
          return { ok: true, status: 200, json: async function () { return govdeler; },
            text: async function () { return JSON.stringify(govdeler); } };
        };
      }

      /* ---- ANONİM TARAMA: jeton sorgusu HİÇ YAPILMAMALI ---- */
      istekler.length = 0;
      kurFetch(function (url) {
        if (url.indexOf('scan_jobs') !== -1) return [{ id: ANON_IS, user_id: null, url: 'https://a.com', status: 'completed' }];
        return [{ token: JETON, platform: 'android' }];
      });
      {
        const sonuc = await D.deviceTokensForJob(ANON_IS);
        esit('anonim işte jeton dönmüyor', sonuc.tokens.length, 0);
        esit('anonim işte YALNIZCA iş sorgulandı', istekler.length, 1);
        dogru('cl_device_tokens sorgusu HİÇ YAPILMADI',
          istekler.every(function (i) { return i.url.indexOf('cl_device_tokens') === -1; }));
      }

      /* ---- SAHİPLİ TARAMA: jeton sorgusu SAHİPLE sınırlı ---- */
      istekler.length = 0;
      kurFetch(function (url) {
        if (url.indexOf('scan_jobs') !== -1) return [{ id: IS, user_id: KULLANICI, url: 'https://a.com', status: 'completed' }];
        return [{ token: JETON, platform: 'android' }];
      });
      {
        const sonuc = await D.deviceTokensForJob(IS);
        esit('sahipli işte jeton döndü', sonuc.tokens.length, 1);
        const jetonIstegi = istekler.filter(function (i) { return i.url.indexOf('cl_device_tokens') !== -1; })[0];
        dogru('jeton sorgusu yapıldı', !!jetonIstegi);
        dogru('JETON SORGUSU SAHİPLE FİLTRELİ (user_id=eq.<sahip>)',
          !!jetonIstegi && jetonIstegi.url.indexOf('user_id=eq.' + KULLANICI) !== -1);
        dogru('sorgu filtresiz DEĞİL',
          !!jetonIstegi && /cl_device_tokens\?[^&]*user_id=eq\./.test(jetonIstegi.url));
      }

      /* ---- Geçersiz iş kimliği ağa hiç çıkmıyor ---- */
      istekler.length = 0;
      {
        const sonuc = await D.deviceTokensForJob('../../hepsi');
        esit('uuid olmayan jobId boş dönüyor', sonuc.tokens.length, 0);
        esit('uuid olmayan jobId ağa çıkmıyor', istekler.length, 0);
      }

      /* ---- saveDeviceToken: on_conflict ZORUNLU ---- */
      istekler.length = 0;
      kurFetch(function () { return [{ id: 'row1' }]; });
      {
        await D.saveDeviceToken(KULLANICI, JETON, 'android');
        const i = istekler[0];
        dogru('çatışma hedefi adıyla veriliyor (on_conflict=token)',
          i.url.indexOf('cl_device_tokens?on_conflict=token') !== -1);
        dogru('merge-duplicates: aynı cihaz hesap değiştirince jeton el değiştiriyor',
          String(i.opt.headers.Prefer).indexOf('resolution=merge-duplicates') !== -1);
        const g = JSON.parse(i.opt.body);
        esit('kayıt sahibi geçirilen kullanıcı', g[0].user_id, KULLANICI);
      }
      {
        let firladi = null;
        try { await D.saveDeviceToken('kullanici-degil', JETON, 'android'); }
        catch (e) { firladi = e.message; }
        esit('uuid olmayan kullanıcı reddediliyor', firladi, 'bad_user_id');
        firladi = null;
        try { await D.saveDeviceToken(KULLANICI, 'kisa', 'android'); }
        catch (e) { firladi = e.message; }
        esit('kısa jeton reddediliyor', firladi, 'bad_token');
      }

      /* ---- deleteDeviceToken: sahiplik sorgunun İÇİNDE ---- */
      istekler.length = 0;
      kurFetch(function () { return [{ id: 'row1' }]; });
      {
        await D.deleteDeviceToken(KULLANICI, JETON);
        const i = istekler[0];
        dogru('silme sahiple filtreli', i.url.indexOf('user_id=eq.' + KULLANICI) !== -1);
        dogru('silme jetonla filtreli', i.url.indexOf('token=eq.') !== -1);
        esit('yöntem DELETE', i.opt.method, 'DELETE');
      }

      /* ---- jobsPendingNotify: anonim işleri HİÇ getirmiyor ---- */
      istekler.length = 0;
      kurFetch(function (url) {
        if (url.indexOf('scan_jobs') !== -1) return [{ id: IS, created_at: 'x' }];
        return [{ job_id: IS }];
      });
      {
        const liste = await D.jobsPendingNotify(5);
        const isIstegi = istekler[0];
        dogru('sorgu anonim işleri dışlıyor (user_id=not.is.null)',
          isIstegi.url.indexOf('user_id=not.is.null') !== -1);
        dogru('sorgu yalnızca tamamlananları alıyor',
          isIstegi.url.indexOf('status=eq.completed') !== -1);
        dogru('Cloudflare düzeltme satırları dışlanıyor',
          isIstegi.url.indexOf('cloudflare-transform') !== -1);
        esit('raporu olan iş döndü', liste.length, 1);
      }
      {
        /* Raporu olmayan iş bildirilmemeli: henüz anlatım yok. */
        kurFetch(function (url) {
          if (url.indexOf('scan_jobs') !== -1) return [{ id: IS, created_at: 'x' }];
          return [];
        });
        const liste = await D.jobsPendingNotify(5);
        esit('AI raporu olmayan iş bildirilmiyor', liste.length, 0);
      }

      if (eskiUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = eskiUrl;
      if (eskiKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = eskiKey;
      delete require.cache[require.resolve(path.join(API, '_lib', 'db.js'))];
    }

    /* ================================================================ */
    /* 6. Kaynak ve göç sözleşmeleri                                     */
    /* ================================================================ */
    {
      const fs = require('node:fs');
      const oku = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
      /* SQL yorumları bir doğrulamayı ucuza geçemesin (reportsign-test dersi). */
      const sadeSql = function (s) {
        return s.split('\n').filter(function (l) { return l.trim().indexOf('--') !== 0; }).join('\n');
      };
      /* JS yorumları da bir doğrulamayı ucuza geçemesin: "firebase-admin YOK"
         diye yazan bir açıklama, bağımlılık sınamasını geçiremez. */
      const sadeJs = function (s) {
        return s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
          .filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
      };
      /* n8n notları insan için; çalışan yapılandırma ayrı denetleniyor. */
      const w4Notsuz = function (ham) {
        return JSON.stringify(JSON.parse(ham).nodes.map(function (n) {
          const k = Object.assign({}, n); delete k.notes; return k;
        }));
      };

      const goc = sadeSql(oku('db/2026-10-08-device-tokens.sql'));
      const notifySrc = oku('api/cron/notify.js');
      const pendingSrc = oku('api/cron/scan-jobs/pending.js');
      const devtokSrc = oku('api/device-token.js');
      const fcmSrc = oku('api/_lib/fcm.js');
      const w4 = oku('n8n/CYBERLION_4_Notify.json');

      dogru('göç RLS açıyor', /enable row level security/i.test(goc));
      dogru('göç yalnızca YENİ tabloya dokunuyor',
        (goc.match(/alter table/gi) || []).length === 1
        && goc.indexOf('cl_device_tokens') !== -1);
      dogru('mevcut tabloların RLS\'ine dokunulmuyor',
        goc.indexOf('scan_jobs') === -1 && goc.indexOf('cl_scans') === -1
        && goc.indexOf('ai_reports') === -1);
      dogru('anon rolü için politika YOK', goc.indexOf('to anon') === -1);
      dogru('authenticated INSERT politikası YOK (jetonu sunucu yazıyor)',
        !/for insert/i.test(goc));
      dogru('tekil indeks TAM (kısmi değil)',
        /create unique index[\s\S]*cl_device_tokens_token_key/i.test(goc)
        && !/cl_device_tokens_token_key[\s\S]{0,200}where /i.test(goc));

      dogru('notify cronauth kullanıyor', notifySrc.indexOf("require('../_lib/cronauth.js')") !== -1);
      dogru('notify oturum katmanını çağırmıyor',
        notifySrc.indexOf('_lib/auth.js') === -1 && notifySrc.indexOf('_lib/session.js') === -1);
      dogru('notify kendi sırrını okumuyor', notifySrc.indexOf('process.env.CRON_SECRET') === -1);
      dogru('pending cronauth kullanıyor', pendingSrc.indexOf("_lib/cronauth.js") !== -1);
      dogru('pending yanıtı yalnızca jobId eşliyor', /jobId: j\.id/.test(pendingSrc));

      dogru('device-token sahibi oturumdan alıyor', /saveDeviceToken\(user\.id/.test(devtokSrc));
      dogru('device-token gövdeden kullanıcı OKUMUYOR',
        devtokSrc.indexOf('body.userId') === -1 && devtokSrc.indexOf('body.user_id') === -1);
      dogru('device-token jetonu loglamıyor',
        !/console\.(log|error|warn)[^\n]*jeton/.test(devtokSrc));

      const fcmKod = sadeJs(fcmSrc);
      dogru('fcm bağımlılık getirmiyor',
        fcmKod.indexOf('firebase-admin') === -1 && fcmKod.indexOf('googleapis/') === -1);
      dogru('fcm yalnızca node:crypto kullanıyor',
        (fcmKod.match(/require\('([^']+)'\)/g) || []).join() === "require('node:crypto')");
      dogru('fcm özel anahtarı loglamıyor',
        !/console\.[a-z]+\([^\n]*privateKey/.test(fcmKod));
      /* `send()` yalnızca üç alan dönüyor: ok, invalid, code. Jetonu dönüş
         nesnesine koyan bir değişiklik bu doğrulamayı düşürür. */
      dogru('fcm dönüş değerinin alanları sabit: ok, invalid, code',
        (fcmKod.match(/return \{\s*ok:[^}]*\}/g) || []).every(function (r) {
          return r.indexOf('temizJeton') === -1 && r.indexOf('jeton:') === -1;
        }));

      const w4Calisan = w4Notsuz(w4);
      dogru('WORKFLOW 4 servis anahtarını çalışan düğümde taşımıyor',
        w4Calisan.indexOf('SERVICE_KEY') === -1 && w4Calisan.indexOf('service_role') === -1);
      dogru('WORKFLOW 4 Firebase kimliği taşımıyor',
        w4Calisan.indexOf('FCM_ACCESS_TOKEN') === -1 && w4Calisan.indexOf('FCM_PROJECT_ID') === -1);
      dogru('WORKFLOW 4 cihaz jetonu okumuyor',
        w4Calisan.indexOf('fcm_token') === -1 && w4Calisan.indexOf('cl_device_tokens') === -1);
      dogru('WORKFLOW 4 Supabase REST\'e hiç gitmiyor',
        w4Calisan.indexOf('/rest/v1/') === -1);
      dogru('WORKFLOW 4 çalışan düğümlerinde Realtime/websocket yok',
        !/wss:\/\//i.test(w4Calisan) && !/realtime/i.test(w4Calisan));
      dogru('CSP\'de wss yok (Realtime eklenmedi)',
        oku('vercel.json').indexOf('wss://') === -1
        && oku('_headers').indexOf('wss://') === -1);
    }
  } finally {
    console.error = eskiHata;
    console.warn = eskiUyari;
    global.fetch = eskiFetch;
    if (eskiSir === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = eskiSir;
    if (eskiSa === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
    else process.env.FIREBASE_SERVICE_ACCOUNT = eskiSa;
    saplamalariSil();
  }

  if (hatalar.length) {
    console.log('\nBAŞARISIZ (' + hatalar.length + '):');
    hatalar.forEach(function (h) { console.log('  - ' + h); });
    console.log('\ngeçen: ' + gecti);
    process.exit(1);
  }
  console.log('Bildirim katmanı (WORKFLOW 4): ' + gecti + ' / ' + gecti + ' doğrulama geçti');
}

kos().catch(function (e) { console.error(e); process.exit(1); });
