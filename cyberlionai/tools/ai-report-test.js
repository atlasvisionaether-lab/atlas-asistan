'use strict';

/**
 * /api/ai-report ucunun sınaması.
 *
 * NEDEN BU DOSYA VAR
 *
 * Bu uç üç tane sessizce bozulabilen karar taşıyor:
 *
 *   1. SAHİPLİK. Rapor `db.getJob(user.id, jobId)` üzerinden okunuyor; filtre
 *      sorgunun içinde. Biri bu çağrıyı sahipsiz bir okumayla değiştirirse
 *      başka hesabın tarama anlatımı sızar ve HİÇBİR yanıt bunu göstermez.
 *   2. GÖSTERİLEN PUAN MOTORUN PUANI. Modelin uydurduğu sayı müşteriye
 *      gösterilirse satılan ölçüm bir dil modelinin tahmini olur.
 *   3. GET MODEL ÇAĞIRMAZ. Panonun yoklaması üretim tetiklerse her sayfa
 *      açılışı para harcar.
 *
 * Ağ yok, veritabanı yok: `_lib/db.js`, `_lib/auth.js`, `_lib/store.js` ve
 * `_lib/aianalyst.js` saplanıyor, çağrılar sayılıyor.
 */

const path = require('node:path');
const Module = require('node:module');

const API = path.join(__dirname, '..', 'api');
const UC_YOLU = require.resolve(path.join(API, 'ai-report.js'));
const CRON_YOLU = require.resolve(path.join(API, 'cron', 'ai-reports.js'));

const IS = '11111111-2222-3333-4444-555555555555';
const BASKA = '99999999-8888-7777-6666-555555555555';

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
  return tam;
}
function saplamalariSil() {
  saplananlar.forEach(function (p) { delete require.cache[p]; });
  saplananlar.length = 0;
  delete require.cache[UC_YOLU];
  delete require.cache[CRON_YOLU];
}

/* Mutasyon ya da gerileme durumunda sınamanın ÇÖKMEMESİ, hangi
   doğrulamanın düştüğünü YAZMASI gerekiyor: beklenen alan yoksa çökme
   değil, adı geçen bir başarısızlık istiyoruz. */
function rapor(res) { return (res && res.body && res.body.report) || {}; }
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
  risk_level: 'high',
  score: 41,
  scanner_score: 58,
  summary_tr: 'Sitede üç önemli eksik var.',
  findings: [{ title: 'CSP yok', severity: 'high' }],
  recommendations: ['CSP ekleyin'],
  model: 'nvidia/nemotron-3.5-lightning-30b-a3b'
};

/**
 * Ucu taze yükler. `d` ile her saplamanın davranışı ayarlanıyor.
 * Dönen `iz` hangi çağrının kaç kez yapıldığını taşıyor.
 */
function kur(d) {
  saplamalariSil();
  const iz = { getJob: [], latest: [], save: [], analyze: [], rate: [], tg: [] };
  const ayar = d || {};

  sapla('_lib/db.js', {
    isConfigured: function () { return ayar.dbYok ? false : true; },
    getJob: async function (userId, jobId) {
      iz.getJob.push({ userId: userId, jobId: jobId });
      if (ayar.getJobFirlat) throw new Error('db_unreachable');
      /* GERÇEK db.getJob sahiplik filtresini sorguya koyuyor: yanlış sahip
         için satır YOK demek. Sapla da aynı şekilde davranıyor. */
      if (userId !== 'u1') return null;
      if (jobId !== IS) return null;
      return { id: IS, user_id: 'u1', result: ayar.sonucYok ? null : { host: 'ornek.com', score: 58 } };
    },
    latestAiReport: async function (userId, jobId) {
      iz.latest.push({ userId: userId, jobId: jobId });
      if (ayar.latestFirlat) throw new Error('db_unreachable');
      if (userId !== 'u1' || jobId !== IS) return null;
      return ayar.kayitliVar
        ? Object.assign({}, RAPOR, { created_at: '2026-10-08T00:00:00Z' })
        : null;
    },
    saveAiReport: async function (jobId, rapor) {
      iz.save.push({ jobId: jobId, rapor: rapor });
      if (ayar.saveFirlat) throw new Error('db_error_400');
      return 'r1';
    }
  });

  sapla('_lib/auth.js', {
    isConfigured: function () { return ayar.authYok ? false : true; },
    resolveUser: async function () { return ayar.girisYok ? null : { id: ayar.kullanici || 'u1' }; }
  });

  sapla('_lib/store.js', {
    isConfigured: function () { return ayar.storeYok ? false : true; },
    hitRateLimit: async function (k, w) {
      iz.rate.push({ key: k, window: w });
      if (ayar.rateFirlat) throw new Error('store_unreachable');
      return { count: ayar.rateAsildi ? 99 : 1, ttl: 120 };
    }
  });

  sapla('_lib/aianalyst.js', {
    isConfigured: function () { return ayar.aiYok ? false : true; },
    analyzeScan: async function (sonuc) {
      iz.analyze.push(sonuc);
      if (ayar.aiHata) return { ok: false, code: ayar.aiHata };
      return { ok: true, report: Object.assign({}, RAPOR) };
    }
  });

  sapla('_lib/telegram.js', {
    sendTelegram: async function (m, o) { iz.tg.push({ metin: m, secenek: o }); return { ok: true }; },
    bildirimIsaretle: function (res) { res.__clBildirildi = true; },
    mesaj: { hata: function (uc, durum, kod) { return uc + ' ' + durum + ' ' + kod; } },
    ucuSar: function (h) { return h; }
  });

  sapla('_lib/session.js', {
    clientIp: function () { return '203.0.113.9'; },
    ipKey: function (ip) { return 'ip:' + ip; }
  });

  return { uc: require(UC_YOLU), iz: iz };
}

async function cagir(d, istek) {
  const k = kur(d);
  const res = sahteRes();
  await k.uc(Object.assign({ method: 'POST', headers: {}, query: {}, body: {}, socket: {} }, istek), res);
  return { res: res, iz: k.iz };
}

(async function () {

  /* ---- 1. Giriş yoksa 401, veritabanına hiç gidilmiyor ---- */
  {
    const r = await cagir({ girisYok: true }, { body: { jobId: IS } });
    esit('giriş yoksa 401', r.res.statusCode, 401);
    esit('401 kodu auth_required', kod(r.res), 'auth_required');
    esit('giriş yoksa iş okunmuyor', r.iz.getJob.length, 0);
    esit('giriş yoksa model çağrılmıyor', r.iz.analyze.length, 0);
  }

  /* ---- 2. Kimlik doğrulanmadan ÖNCE kimlik biçimi: bozuk kimlik 400 ---- */
  {
    const r = await cagir({}, { body: { jobId: 'bu-bir-uuid-degil' } });
    esit('bozuk kimlik 400', r.res.statusCode, 400);
    esit('400 kodu invalid_id', kod(r.res), 'invalid_id');
    esit('bozuk kimlikte model çağrılmıyor', r.iz.analyze.length, 0);
  }

  /* ---- 3. SAHİPLİK: başka hesabın işi 404, model çağrılmıyor ----
     En kritik sınama. `getJob` sahipsiz okumaya çevrilirse burası kırmızıya
     döner: başka kullanıcı için satır dönerdi ve 200 alırdık. */
  {
    const r = await cagir({ kullanici: 'u2' }, { body: { jobId: IS } });
    esit('başka hesabın işi 404', r.res.statusCode, 404);
    esit('404 kodu not_found', kod(r.res), 'not_found');
    esit('başka hesapta model çağrılmıyor', r.iz.analyze.length, 0);
    esit('başka hesapta kayıt yazılmıyor', r.iz.save.length, 0);
    dogru('iş okuması kullanıcı kimliğiyle yapıldı',
      r.iz.getJob.length === 1 && r.iz.getJob[0].userId === 'u2');
  }

  /* ---- 4. Var olmayan iş 404 (aynı yanıt: varlık sızdırılmıyor) ---- */
  {
    const r = await cagir({}, { body: { jobId: BASKA } });
    esit('bilinmeyen iş 404', r.res.statusCode, 404);
    esit('bilinmeyen işte aynı kod', kod(r.res), 'not_found');
  }

  /* ---- 5. Mutlu yol: 200, motor puanı gösteriliyor ---- */
  {
    const r = await cagir({}, { body: { jobId: IS } });
    esit('üretim 200', r.res.statusCode, 200);
    esit('ok alanı', r.res.body && r.res.body.ok, true);
    esit('risk seviyesi geçiyor', rapor(r.res).risk_level, 'high');
    /* GÖSTERİLEN PUAN MOTORUN: modelin 41'i değil tarayıcının 58'i. */
    esit('gösterilen puan motorun puanı', rapor(r.res).score, 58);
    esit('modelin puanı ayrı alanda', rapor(r.res).ai_score, 41);
    esit('Türkçe özet geçiyor', rapor(r.res).summary_tr, RAPOR.summary_tr);
    esit('bulgu sayısı', (rapor(r.res).findings || []).length, 1);
    esit('öneri sayısı', (rapor(r.res).recommendations || []).length, 1);
    esit('model çağrıldı', r.iz.analyze.length, 1);
    esit('rapor kaydedildi', r.iz.save.length, 1);
    esit('kayıt doğru işe bağlandı', r.iz.save[0] && r.iz.save[0].jobId, IS);
  }

  /* ---- 6. Model adı ve ham yanıt dışarı verilmiyor ---- */
  {
    const r = await cagir({}, { body: { jobId: IS } });
    const metin = JSON.stringify(r.res.body);
    dogru('model adı istemciye gitmiyor', metin.indexOf('nemotron') === -1);
    dogru('yanıtta model alanı yok', rapor(r.res).model === undefined);
  }

  /* ---- 7. Kayıtlı rapor varsa model TEKRAR çağrılmıyor ---- */
  {
    const r = await cagir({ kayitliVar: true }, { body: { jobId: IS } });
    esit('kayıtlı raporla 200', r.res.statusCode, 200);
    esit('kayıtlı raporda model çağrılmıyor', r.iz.analyze.length, 0);
    esit('kayıtlı raporda yeniden yazılmıyor', r.iz.save.length, 0);
    esit('kayıtlı raporda da motor puanı', rapor(r.res).score, 58);
  }

  /* ---- 8. GET MODEL ÇAĞIRMAZ ---- */
  {
    const r = await cagir({ kayitliVar: true }, { method: 'GET', query: { jobId: IS }, body: {} });
    esit('GET kayıtlıyı 200 döner', r.res.statusCode, 200);
    esit('GET model çağırmıyor', r.iz.analyze.length, 0);
    esit('GET hız sınırı harcamıyor', r.iz.rate.length, 0);
  }
  {
    const r = await cagir({}, { method: 'GET', query: { jobId: IS }, body: {} });
    esit('GET kayıt yoksa 404', r.res.statusCode, 404);
    esit('GET kayıt yoksa üretim YOK', r.iz.analyze.length, 0);
  }

  /* ---- 9. Tamamlanmamış tarama 409, model çağrılmıyor ---- */
  {
    const r = await cagir({ sonucYok: true }, { body: { jobId: IS } });
    esit('sonucu olmayan iş 409', r.res.statusCode, 409);
    esit('409 kodu scan_not_ready', kod(r.res), 'scan_not_ready');
    esit('sonuç yoksa model çağrılmıyor', r.iz.analyze.length, 0);
  }

  /* ---- 10. Hız sınırı ---- */
  {
    const r = await cagir({ rateAsildi: true }, { body: { jobId: IS } });
    esit('sınır aşılınca 429', r.res.statusCode, 429);
    esit('Retry-After var', r.res.headers['retry-after'], '120');
    esit('sınırda model çağrılmıyor', r.iz.analyze.length, 0);
    /* Sınır IP başına: anahtar IP taşıyor. */
    dogru('sınır anahtarı IP tabanlı',
      !!r.iz.rate[0] && r.iz.rate[0].key.indexOf('203.0.113.9') !== -1);
    esit('sınır penceresi bir saat', r.iz.rate[0] && r.iz.rate[0].window, 3600);
  }

  /* ---- 11. Model hataları 502; yetki/kota uyarı üretiyor ---- */
  {
    const r = await cagir({ aiHata: 'ai_timeout' }, { body: { jobId: IS } });
    esit('zaman aşımı 502', r.res.statusCode, 502);
    esit('kod geçiyor', kod(r.res), 'ai_timeout');
    esit('zaman aşımında kayıt yazılmıyor', r.iz.save.length, 0);
    esit('zaman aşımı uyarı üretmiyor', r.iz.tg.length, 0);
  }
  {
    const r = await cagir({ aiHata: 'ai_unauthorized' }, { body: { jobId: IS } });
    esit('yetkisiz 502', r.res.statusCode, 502);
    esit('yetkisiz uyarı üretiyor', r.iz.tg.length, 1);
    esit('uyarı türü alert', r.iz.tg[0] && r.iz.tg[0].secenek.type, 'alert');
    dogru('ikinci bildirim engellendi', r.res.__clBildirildi === true);
  }
  {
    const r = await cagir({ aiHata: 'ai_rate_limited' }, { body: { jobId: IS } });
    esit('kota aşımı 502', r.res.statusCode, 502);
    esit('kota aşımı uyarı üretiyor', r.iz.tg.length, 1);
  }

  /* ---- 12. Kayıt düşse bile rapor dönüyor ---- */
  {
    const r = await cagir({ saveFirlat: true }, { body: { jobId: IS } });
    esit('kayıt düşse de 200', r.res.statusCode, 200);
    esit('rapor yine dönüyor', rapor(r.res).risk_level, 'high');
  }

  /* ---- 13. Yapılandırma eksikleri 503, model çağrılmıyor ---- */
  {
    const r = await cagir({ dbYok: true }, { body: { jobId: IS } });
    esit('db yoksa 503', r.res.statusCode, 503);
    esit('db yoksa model çağrılmıyor', r.iz.analyze.length, 0);
  }
  {
    const r = await cagir({ aiYok: true }, { body: { jobId: IS } });
    esit('AI anahtarı yoksa 503', r.res.statusCode, 503);
    esit('503 kodu ai_unconfigured', kod(r.res), 'ai_unconfigured');
    esit('anahtar yoksa iş bile okunmuyor', r.iz.getJob.length, 0);
  }
  {
    const r = await cagir({ storeYok: true }, { body: { jobId: IS } });
    esit('sayaç yoksa 503', r.res.statusCode, 503);
    esit('sayaç yoksa model çağrılmıyor', r.iz.analyze.length, 0);
  }
  {
    const r = await cagir({ getJobFirlat: true }, { body: { jobId: IS } });
    esit('db okuması düşerse 503', r.res.statusCode, 503);
    esit('db düşerse model çağrılmıyor', r.iz.analyze.length, 0);
  }

  /* ---- 14. Yöntem denetimi ---- */
  {
    const r = await cagir({}, { method: 'DELETE', body: { jobId: IS } });
    esit('DELETE 405', r.res.statusCode, 405);
    esit('Allow başlığı', r.res.headers['allow'], 'GET, POST');
  }

  /* ---- 15. Gövde dizge olarak gelse de okunuyor (Content-Type yoksa) ---- */
  {
    const r = await cagir({}, { body: JSON.stringify({ jobId: IS }) });
    esit('dizge gövde 200', r.res.statusCode, 200);
  }
  {
    const r = await cagir({}, { body: 'bu json degil' });
    esit('bozuk gövde 400', r.res.statusCode, 400);
  }

  /* ---- 16. Önbelleğe alınmıyor ---- */
  {
    const r = await cagir({}, { body: { jobId: IS } });
    esit('no-store', r.res.headers['cache-control'], 'no-store');
  }

  /* ================= /api/cron/ai-reports =================
     Bu uç SAHİPLİK FİLTRESİ OLMADAN iş okuyor; güvenliği iki şeye dayanıyor:
     (1) cronauth fail-closed kimlik doğrulaması, (2) yanıtın müşteri verisi
     taşımaması. İkisi de burada kilitli. */

  function cronKur(d) {
    saplamalariSil();
    const iz = { yetki: [], sorgu: [], analyze: [], save: [], tg: [] };
    const ayar = d || {};

    sapla('_lib/cronauth.js', {
      authorize: function (req) {
        iz.yetki.push(req);
        return ayar.yetkisiz
          ? { ok: false, status: 401, code: 'unauthorized' }
          : (ayar.cronYok ? { ok: false, status: 503, code: 'cron_unconfigured' }
                          : { ok: true, via: 'cron' });
      },
      readRawBody: function () { return ''; },
      cronSecretOk: function () { return true; }
    });
    sapla('_lib/db.js', {
      isConfigured: function () { return true; },
      jobsMissingAiReport: async function (n) {
        iz.sorgu.push(n);
        if (ayar.sorguFirlat) throw new Error('db_unreachable');
        const kac = ayar.isSayisi === undefined ? 2 : ayar.isSayisi;
        const liste = [];
        for (let i = 0; i < kac; i += 1) {
          liste.push({ id: 'job-' + i, url: 'https://ornek' + i + '.com',
            result: { host: 'ornek' + i + '.com', score: 50 } });
        }
        return liste;
      },
      saveAiReport: async function (jobId, rapor) {
        iz.save.push({ jobId: jobId, rapor: rapor });
        if (ayar.saveFirlat) throw new Error('db_error_400');
        return 'r';
      }
    });
    sapla('_lib/aianalyst.js', {
      isConfigured: function () { return ayar.aiYok ? false : true; },
      analyzeScan: async function (sonuc) {
        iz.analyze.push(sonuc);
        if (ayar.aiHata) return { ok: false, code: ayar.aiHata };
        return { ok: true, report: Object.assign({}, RAPOR) };
      }
    });
    sapla('_lib/telegram.js', {
      sendTelegram: async function (m, o) { iz.tg.push({ metin: m, secenek: o }); return { ok: true }; },
      bildirimIsaretle: function (res) { res.__clBildirildi = true; },
      mesaj: { hata: function (uc, durum, kod) { return uc + ' ' + durum + ' ' + kod; } },
      ucuSar: function (h) { return h; }
    });

    return { uc: require(CRON_YOLU), iz: iz };
  }

  async function cronCagir(d, istek) {
    const k = cronKur(d);
    const res = sahteRes();
    await k.uc(Object.assign({ method: 'GET', headers: {}, query: {}, socket: {} }, istek), res);
    return { res: res, iz: k.iz };
  }

  /* ---- 17. Yetkisiz cron: iş bile okunmuyor ---- */
  {
    const r = await cronCagir({ yetkisiz: true }, {});
    esit('yetkisiz cron 401', r.res.statusCode, 401);
    esit('yetkisizde iş sorgulanmıyor', r.iz.sorgu.length, 0);
    esit('yetkisizde model çağrılmıyor', r.iz.analyze.length, 0);
  }
  {
    const r = await cronCagir({ cronYok: true }, {});
    esit('cron yapılandırılmamışsa 503', r.res.statusCode, 503);
    esit('503 kodu cron_unconfigured', kod(r.res), 'cron_unconfigured');
    esit('yapılandırma yokken model çağrılmıyor', r.iz.analyze.length, 0);
  }

  /* ---- 18. Mutlu yol: sayı döner, MÜŞTERİ VERİSİ DÖNMEZ ---- */
  {
    const r = await cronCagir({}, {});
    esit('cron 200', r.res.statusCode, 200);
    esit('üretilen sayısı', r.res.body.generated, 2);
    esit('aday sayısı', r.res.body.candidates, 2);
    esit('iki rapor kaydedildi', r.iz.save.length, 2);
    const metin = JSON.stringify(r.res.body);
    dogru('cron yanıtı özet metni taşımıyor', metin.indexOf('önemli eksik') === -1);
    dogru('cron yanıtı alan adı taşımıyor', metin.indexOf('ornek0.com') === -1);
    dogru('cron yanıtı risk seviyesi taşımıyor', metin.indexOf('high') === -1);
  }

  /* ---- 19. Bir koşuda en çok MAX_PER_RUN ---- */
  {
    const r = await cronCagir({}, {});
    esit('sorgu sınırı 5', r.iz.sorgu[0], 5);
  }

  /* ---- 20. Yetki/kota hatasında İLK hatada duruluyor ---- */
  {
    const r = await cronCagir({ isSayisi: 4, aiHata: 'ai_unauthorized' }, {});
    esit('yetkisiz anahtarda bir deneme', r.iz.analyze.length, 1);
    esit('yetkisiz anahtarda kayıt yok', r.iz.save.length, 0);
    esit('yetkisiz anahtar uyarı üretiyor', r.iz.tg.length, 1);
    esit('cron yine 200', r.res.statusCode, 200);
  }
  {
    const r = await cronCagir({ isSayisi: 4, aiHata: 'ai_bad_output' }, {});
    esit('şema hatasında devam ediliyor', r.iz.analyze.length, 4);
    esit('şema hatası uyarı üretmiyor', r.iz.tg.length, 0);
    esit('şema hatasında üretilen 0', r.res.body.generated, 0);
  }

  /* ---- 21. İş yoksa boş koşu ---- */
  {
    const r = await cronCagir({ isSayisi: 0 }, {});
    esit('iş yoksa 200', r.res.statusCode, 200);
    esit('iş yoksa model çağrılmıyor', r.iz.analyze.length, 0);
    esit('iş yoksa üretilen 0', r.res.body.generated, 0);
  }

  /* ---- 22. AI anahtarı yoksa 503, iş bile sorgulanmıyor ---- */
  {
    const r = await cronCagir({ aiYok: true }, {});
    esit('cron AI yoksa 503', r.res.statusCode, 503);
    esit('AI yoksa iş sorgulanmıyor', r.iz.sorgu.length, 0);
  }

  /* ---- 23. Kayıt düşerse hata sayılıyor ama koşu sürüyor ---- */
  {
    const r = await cronCagir({ saveFirlat: true }, {});
    esit('kayıt düşerse 200', r.res.statusCode, 200);
    esit('kayıt düşerse üretilen 0', r.res.body.generated, 0);
    esit('kayıt hatası sayılıyor', r.res.body.errors.save_failed, 2);
  }

  /* ---- 24. Yöntem denetimi ---- */
  {
    const r = await cronCagir({}, { method: 'DELETE' });
    esit('cron DELETE 405', r.res.statusCode, 405);
  }

  saplamalariSil();

  if (hatalar.length) {
    console.error('AI rapor ucu sınaması BAŞARISIZ:');
    hatalar.forEach(function (h) { console.error('  - ' + h); });
    process.exit(1);
  }
  console.log('AI rapor + cron ucu sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (e) {
  console.error('sınama çöktü:', e && e.stack);
  process.exit(1);
});
