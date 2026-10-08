'use strict';

/**
 * WORKFLOW 3'ün sınaması: AI raporu PDF'i (`_lib/report-ai.js`) ve onu gizli
 * kovaya koyan cron'lu uç (`api/cron/ai-report-pdf.js`).
 *
 * NEDEN BU DOSYA VAR — sessizce bozulabilen beş karar:
 *
 *   1. YETKİ. Uç `_lib/cronauth.js` ile kapanıyor. Biri yetkiyi gevşetirse
 *      internetteki herkes bizim adımıza rapor üretip kovaya yazabilir.
 *   2. GÖSTERİLEN PUAN MOTORUN PUANI (`scanner_score`). Modelin kendi puanı
 *      (`score`) PDF'e girmemeli: müşterinin elindeki kâğıtta iki sayı
 *      olması hangisinin ölçüm olduğunu belirsizleştirir.
 *   3. YANIT MÜŞTERİ VERİSİ TAŞIMIYOR. Gövdede alan adı, özet ya da bulgu
 *      yok; yalnızca kova yolu ve bayt sayısı var.
 *   4. KOVA YOLU İSTEMCİDEN GELMİYOR. Yol `jobId`'den türetiliyor; bir yol
 *      gezinmesi (`../`) kovanın başka yerine yazabilirdi.
 *   5. TÜRKÇE HARFLER. PDF gömülü TrueType yazı tipiyle yazılıyor; temel 14
 *      yazı tipinde ı/İ/ş/ğ yok ve sessizce boş kutuya düşerler.
 *
 * Ağ yok, veritabanı yok, kova yok: `_lib/*` saplanıyor.
 */

const path = require('node:path');
const Module = require('node:module');

const API = path.join(__dirname, '..', 'api');
const UC_YOLU = require.resolve(path.join(API, 'cron', 'ai-report-pdf.js'));

const IS = '11111111-2222-3333-4444-555555555555';
const SIR = 'cron-sirri-yeterince-uzun-0123456789';

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

/* Türkçe harfler, uzunluk sınırı aşan metin, nesne biçiminde öneri ve bir IP:
   hepsi bilerek. Her biri bir doğrulamanın dayanağı. */
const RAPOR = {
  id: 'r1',
  job_id: IS,
  domain: 'ornek-şirket.com.tr',
  risk_level: 'high',
  score: 41,
  scanner_score: 58,
  summary_tr: 'Sitede üç önemli eksik var: güvenlik başlıkları yok, '
    + 'şifreleme ayarı eski ve çerezler işaretsiz. Sunucu 203.0.113.7 adresinde.',
  findings: [
    { title: 'CSP yok', severity: 'high', description: 'İçerik güvenlik ilkesi tanımsız.' },
    'HSTS başlığı eksik'
  ],
  recommendations: [
    'CSP ekleyin',
    { title: 'HSTS açın', description: 'Strict-Transport-Security başlığını ekleyin.' },
    'Çerezlere Secure ve HttpOnly verin',
    'DÖRDÜNCÜ ÖNERİ — basılmamalı',
    'BEŞİNCİ ÖNERİ — basılmamalı'
  ],
  model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  created_at: '2026-10-08T09:30:00Z'
};

function kur(d) {
  saplamalariSil();
  const iz = { aiReportOf: [], latestAiReport: [], upload: [], tg: [] };
  const ayar = d || {};

  sapla('_lib/db.js', {
    isConfigured: function () { return ayar.dbYok ? false : true; },
    aiReportOf: async function (jobId) {
      iz.aiReportOf.push(jobId);
      if (ayar.dbFirlat) throw new Error('db_unreachable');
      if (ayar.raporYok) return null;
      return Object.assign({}, RAPOR);
    },
    /* Sahiplikli okuma SAPLANIYOR ama çağrılmamalı: bu uç kullanıcı
       yolundan gelmiyor, bir oturum kimliği de yok. */
    latestAiReport: async function (u, j) { iz.latestAiReport.push({ u: u, j: j }); return null; }
  });

  sapla('_lib/storage.js', {
    isConfigured: function () { return ayar.storageYok ? false : true; },
    BUCKET: 'reports',
    upload: async function (key, buf, ct) {
      iz.upload.push({ key: key, buf: buf, contentType: ct });
      if (ayar.uploadHata) throw new Error(ayar.uploadHata);
      return { ok: true, key: key, bytes: buf.length };
    },
    guvenliYol: require(path.join(API, '_lib', 'storage.js')).guvenliYol
  });

  sapla('_lib/telegram.js', {
    sendTelegram: async function (m, o) { iz.tg.push({ mesaj: m, opt: o }); return { ok: true }; },
    bildirimIsaretle: function (res) { res.__clBildirildi = true; },
    mesaj: { hata: function (uc, durum, k) { return uc + ' ' + durum + ' ' + k; } },
    ucuSar: function (h) { return h; }
  });

  /* qstash saplanıyor: cronauth gerçek, imza yolu yapılandırılmamış. */
  sapla('_lib/qstash.js', {
    isConfigured: function () { return false; },
    verify: function () { return { ok: false, reason: 'unconfigured' }; }
  });

  const handler = require(UC_YOLU);
  return { handler: handler, iz: iz };
}

async function cagir(ayar, istek) {
  const k = kur(ayar);
  const req = Object.assign({
    method: 'GET',
    headers: { authorization: 'Bearer ' + SIR },
    query: { jobId: IS }
  }, istek || {});
  const res = sahteRes();
  await k.handler(req, res);
  return { res: res, iz: k.iz };
}

async function kos() {
  const eskiSir = process.env.CRON_SECRET;
  const eskiHata = console.error;
  const yakalanan = [];
  console.error = function () { yakalanan.push(Array.prototype.join.call(arguments, ' ')); };
  process.env.CRON_SECRET = SIR;

  try {
    /* ---------------------------------------------------------------- */
    /* 1. Mutlu yol                                                      */
    /* ---------------------------------------------------------------- */
    {
      const r = await cagir({});
      esit('yetkili istek 200', r.res.statusCode, 200);
      esit('ok true', govde(r.res).ok, true);
      esit('yetki yolu cron', govde(r.res).via, 'cron');
      esit('kova adı dönüyor', govde(r.res).bucket, 'reports');
      esit('kova yolu jobId\'den türetiliyor', govde(r.res).key, 'ai/' + IS + '.pdf');
      dogru('bayt sayısı dönüyor', typeof govde(r.res).bytes === 'number' && govde(r.res).bytes > 800);
      esit('tek yükleme yapıldı', r.iz.upload.length, 1);
      esit('içerik türü PDF', r.iz.upload[0] && r.iz.upload[0].contentType, 'application/pdf');
      dogru('yüklenen gövde Buffer', !!(r.iz.upload[0] && Buffer.isBuffer(r.iz.upload[0].buf)));
      esit('rapor sahipsiz okumayla alındı (cron yolu)', r.iz.aiReportOf.length, 1);
      esit('sahiplikli okuma çağrılmadı', r.iz.latestAiReport.length, 0);
      esit('Cache-Control no-store', r.res.headers['cache-control'], 'no-store');
    }

    /* ---------------------------------------------------------------- */
    /* 2. Yanıt müşteri verisi taşımıyor                                 */
    /* ---------------------------------------------------------------- */
    {
      const r = await cagir({});
      const metin = JSON.stringify(govde(r.res));
      dogru('yanıt alan adı taşımıyor', metin.indexOf('ornek-') === -1);
      dogru('yanıt özet taşımıyor', metin.indexOf('güvenlik başlıkları') === -1);
      dogru('yanıt risk seviyesi taşımıyor', metin.indexOf('high') === -1);
      dogru('yanıt puan taşımıyor', metin.indexOf('58') === -1 && metin.indexOf('41') === -1);
      dogru('yanıt bulgu taşımıyor', metin.indexOf('CSP') === -1);
      dogru('yanıt IP taşımıyor', metin.indexOf('203.0.113.7') === -1);
      dogru('yanıt model adı taşımıyor', metin.indexOf('nemotron') === -1);
    }

    /* ---------------------------------------------------------------- */
    /* 3. Yetki                                                          */
    /* ---------------------------------------------------------------- */
    {
      const r = await cagir({}, { headers: {} });
      esit('başlıksız istek 401', r.res.statusCode, 401);
      esit('401 kodu unauthorized', kod(r.res), 'unauthorized');
      esit('yetkisiz istek rapor okumuyor', r.iz.aiReportOf.length, 0);
      esit('yetkisiz istek kovaya yazmıyor', r.iz.upload.length, 0);
    }
    {
      const r = await cagir({}, { headers: { authorization: 'Bearer yanlis-sir-ama-ayni-uzunlukta-012' } });
      esit('yanlış sır 401', r.res.statusCode, 401);
      esit('yanlış sır kovaya yazmıyor', r.iz.upload.length, 0);
    }
    {
      delete process.env.CRON_SECRET;
      const r = await cagir({}, { headers: {} });
      esit('sır yapılandırılmamışsa 503 (fail-closed)', r.res.statusCode, 503);
      esit('503 kodu cron_unconfigured', kod(r.res), 'cron_unconfigured');
      esit('yapılandırılmamış uç kovaya yazmıyor', r.iz.upload.length, 0);
      process.env.CRON_SECRET = SIR;
    }
    {
      const r = await cagir({}, { method: 'DELETE' });
      esit('DELETE 405', r.res.statusCode, 405);
      esit('Allow başlığı', r.res.headers.allow, 'GET, POST');
      esit('405 yetkiden ÖNCE: kovaya yazılmadı', r.iz.upload.length, 0);
    }
    {
      const r = await cagir({}, { method: 'POST' });
      esit('POST da kabul', r.res.statusCode, 200);
    }

    /* ---------------------------------------------------------------- */
    /* 4. jobId doğrulaması — kova yolu istemciden gelmiyor              */
    /* ---------------------------------------------------------------- */
    {
      const r = await cagir({}, { query: {} });
      esit('jobId yoksa 400', r.res.statusCode, 400);
      esit('400 kodu bad_job_id', kod(r.res), 'bad_job_id');
      esit('jobId yoksa rapor okunmuyor', r.iz.aiReportOf.length, 0);
    }
    {
      const r = await cagir({}, { query: { jobId: '../../gizli/anahtar' } });
      esit('yol gezinmesi 400', r.res.statusCode, 400);
      esit('yol gezinmesi kovaya yazmıyor', r.iz.upload.length, 0);
    }
    {
      const r = await cagir({}, { query: { jobId: 'ai/başka.pdf' } });
      esit('uuid olmayan jobId 400', r.res.statusCode, 400);
      esit('uuid olmayan jobId kovaya yazmıyor', r.iz.upload.length, 0);
    }
    {
      /* Kovaya yazılan yol HER ZAMAN sunucunun türettiği yol. */
      const r = await cagir({}, { query: { jobId: IS, key: 'ai/elle.pdf', path: '../x' } });
      esit('istemcinin verdiği key yok sayılıyor', govde(r.res).key, 'ai/' + IS + '.pdf');
    }

    /* ---------------------------------------------------------------- */
    /* 5. Sıra ve hata yolları                                           */
    /* ---------------------------------------------------------------- */
    {
      const r = await cagir({ raporYok: true });
      esit('rapor henüz yoksa 404', r.res.statusCode, 404);
      esit('404 kodu no_ai_report', kod(r.res), 'no_ai_report');
      esit('rapor yoksa kovaya yazılmıyor', r.iz.upload.length, 0);
    }
    {
      const r = await cagir({ dbFirlat: true });
      esit('veritabanı erişilemezse 503', r.res.statusCode, 503);
      esit('503 kodu report_unavailable', kod(r.res), 'report_unavailable');
      esit('db hatasında kovaya yazılmıyor', r.iz.upload.length, 0);
    }
    {
      const r = await cagir({ dbYok: true });
      esit('db yapılandırılmamışsa 503', r.res.statusCode, 503);
      esit('db_unavailable kodu', kod(r.res), 'db_unavailable');
    }
    {
      const r = await cagir({ storageYok: true });
      esit('kova yapılandırılmamışsa 503', r.res.statusCode, 503);
      esit('storage_unavailable kodu', kod(r.res), 'storage_unavailable');
      esit('kova yoksa rapor bile okunmuyor', r.iz.aiReportOf.length, 0);
    }
    {
      const r = await cagir({ uploadHata: 'storage_error_404' });
      esit('kova hatası 502', r.res.statusCode, 502);
      esit('kova hata kodu geçiyor', kod(r.res), 'storage_error_404');
      esit('kova hatası Telegram uyarısı üretiyor', r.iz.tg.length, 1);
      dogru('çift bildirim işareti konuldu', r.res.__clBildirildi === true);
    }
    {
      const r = await cagir({ uploadHata: 'beklenmeyen_patlama' });
      esit('tanınmayan hata storage_failed\'e indiriliyor', kod(r.res), 'storage_failed');
    }

    /* ---------------------------------------------------------------- */
    /* 6. PDF'in kendisi                                                 */
    /* ---------------------------------------------------------------- */
    const { buildAiReport, aiReportFilename, aiReportStorageKey, temiz, maddeMetni, MAX_ACTIONS }
      = require(path.join(API, '_lib', 'report-ai.js'));

    {
      const pdf = buildAiReport(RAPOR, 'tr');
      dogru('PDF Buffer dönüyor', Buffer.isBuffer(pdf));
      esit('PDF başlığı %PDF-', pdf.slice(0, 5).toString('latin1'), '%PDF-');
      dogru('PDF sonu %%EOF', pdf.slice(-20).toString('latin1').indexOf('%%EOF') !== -1);
      dogru('PDF boş değil', pdf.length > 2000);
      /* Metin gömülü yazı tipiyle (Identity-H) yazıldığı için ham baytlarda
         düz Türkçe aranamaz; onun yerine yazı tipinin gömüldüğünü
         doğruluyoruz — temel 14 yazı tipinde ı/İ/ş/ğ yok. */
      const ham = pdf.toString('latin1');
      dogru('gömülü TrueType yazı tipi var', ham.indexOf('FontFile2') !== -1);
      dogru('Identity-H kodlaması kullanılıyor', ham.indexOf('Identity-H') !== -1);
      dogru('temel 14 yazı tipine düşülmemiş', ham.indexOf('/BaseFont /Helvetica') === -1);
    }
    {
      /* Modelin puanı kâğıda GİRMEMELİ. İki PDF üretip boylarını
         karşılaştırmak yetmez; o yüzden `score`u değiştirip çıktının
         değişmediğini gösteriyoruz. */
      const a = buildAiReport(Object.assign({}, RAPOR, { score: 41 }), 'tr');
      const b = buildAiReport(Object.assign({}, RAPOR, { score: 99 }), 'tr');
      dogru('modelin puanı (score) PDF\'i değiştirmiyor', a.equals(b));

      const c = buildAiReport(Object.assign({}, RAPOR, { scanner_score: 12 }), 'tr');
      dogru('motorun puanı (scanner_score) PDF\'i değiştiriyor', !a.equals(c));
    }
    {
      /* Risk seviyesi rengi: dördü de ayrı çıktı vermeli. Hepsi aynıysa
         ya renkler ya etiketler düşmüş. */
      const ciktilar = ['low', 'medium', 'high', 'critical'].map(function (s) {
        return buildAiReport(Object.assign({}, RAPOR, { risk_level: s }), 'tr').toString('latin1');
      });
      const tekil = new Set(ciktilar);
      esit('dört risk seviyesi dört ayrı çıktı', tekil.size, 4);
      const bilinmeyen = buildAiReport(Object.assign({}, RAPOR, { risk_level: 'uydurma' }), 'tr');
      dogru('bilinmeyen risk seviyesi çökertmiyor', Buffer.isBuffer(bilinmeyen) && bilinmeyen.length > 1000);
    }
    {
      esit('en çok üç aksiyon basılıyor', MAX_ACTIONS, 3);
      /* Dördüncü ve beşinci öneri çıktıyı DEĞİŞTİRMEMELİ. */
      const az = buildAiReport(Object.assign({}, RAPOR, {
        recommendations: RAPOR.recommendations.slice(0, 3)
      }), 'tr');
      const cok = buildAiReport(RAPOR, 'tr');
      dogru('dördüncü öneri PDF\'e girmiyor', az.equals(cok));
    }
    {
      const bos = buildAiReport({ risk_level: 'low', scanner_score: 90, summary_tr: '' }, 'tr');
      dogru('boş rapor bile PDF üretiyor', Buffer.isBuffer(bos) && bos.length > 1000);
      const hicbiri = buildAiReport(null, 'tr');
      dogru('null rapor çökertmiyor', Buffer.isBuffer(hicbiri) && hicbiri.length > 1000);
      const en = buildAiReport(RAPOR, 'en');
      dogru('EN raporu da üretiliyor', Buffer.isBuffer(en) && !en.equals(buildAiReport(RAPOR, 'tr')));
    }
    {
      /* `temiz()`: kontrol karakteri, uzunluk, IP maskesi. */
      esit('kontrol karakteri boşluğa dönüyor', temiz('a\u0000b\nc', 100), 'a b c');
      esit('uzunluk kırpılıyor', temiz('abcdefghij', 5).length, 5);
      dogru('kırpma elips ile bitiyor', temiz('abcdefghij', 5).slice(-1) === '…');
      dogru('IP maskeleniyor', temiz('sunucu 203.0.113.7 adresinde', 200).indexOf('203.0.113.7') === -1);
      esit('null metin boş dizge', temiz(null, 10), '');
      esit('sayı dizgeye çevriliyor', temiz(42, 10), '42');
    }
    {
      esit('dizge madde aynen', maddeMetni('CSP ekleyin'), 'CSP ekleyin');
      esit('nesne madde başlık + açıklama',
        maddeMetni({ title: 'HSTS açın', description: 'Başlığı ekleyin.' }),
        'HSTS açın — Başlığı ekleyin.');
      esit('tanınmayan madde boş dizge', maddeMetni(12), '');
      esit('null madde boş dizge', maddeMetni(null), '');
    }
    {
      const ad = aiReportFilename(RAPOR);
      dogru('dosya adı .pdf ile bitiyor', /\.pdf$/.test(ad));
      dogru('dosya adında Türkçe harf yok', /^[a-z0-9.\-]+$/.test(ad));
      dogru('dosya adı markayı taşıyor', ad.indexOf('cyberlion-ai-') === 0);
      dogru('dosya adında yol ayracı yok', ad.indexOf('/') === -1);
      esit('kova yolu ai/ altında', aiReportStorageKey(IS), 'ai/' + IS + '.pdf');
    }

    /* ---------------------------------------------------------------- */
    /* 7. Kova yolu doğrulayıcısı (storage.guvenliYol)                   */
    /* ---------------------------------------------------------------- */
    {
      const storage = require(path.join(API, '_lib', 'storage.js'));
      esit('normal yol kabul', storage.guvenliYol('ai/' + IS + '.pdf'), 'ai/' + IS + '.pdf');
      esit('üst dizin reddedilir', storage.guvenliYol('ai/../gizli.pdf'), null);
      esit('baştaki / reddedilir', storage.guvenliYol('/ai/x.pdf'), null);
      esit('çift / reddedilir', storage.guvenliYol('ai//x.pdf'), null);
      esit('boş yol reddedilir', storage.guvenliYol(''), null);
      esit('null yol reddedilir', storage.guvenliYol(null), null);
      esit('boşluklu yol reddedilir', storage.guvenliYol('ai/a b.pdf'), null);
      esit('sorgu eki reddedilir', storage.guvenliYol('ai/x.pdf?a=1'), null);
      esit('tek nokta parçası reddedilir', storage.guvenliYol('ai/./x.pdf'), null);
      esit('çok uzun yol reddedilir', storage.guvenliYol('ai/' + 'a'.repeat(400)), null);
      esit('kova adı reports', storage.BUCKET, 'reports');
      dogru('genel adres yardımcısı YOK (kova gizli)', typeof storage.publicUrl === 'undefined');
    }

    /* ---------------------------------------------------------------- */
    /* 8. Kaynak sözleşmeleri                                            */
    /* ---------------------------------------------------------------- */
    {
      const fs = require('node:fs');
      const ucSrc = fs.readFileSync(path.join(API, 'cron', 'ai-report-pdf.js'), 'utf8');
      const stSrc = fs.readFileSync(path.join(API, '_lib', 'storage.js'), 'utf8');
      const raiSrc = fs.readFileSync(path.join(API, '_lib', 'report-ai.js'), 'utf8');

      dogru('uç cronauth kullanıyor', ucSrc.indexOf("require('../_lib/cronauth.js')") !== -1);
      dogru('uç kendi yetki kontrolünü yazmıyor (sırrı kendi okumuyor)',
        ucSrc.indexOf('process.env.CRON_SECRET') === -1 && ucSrc.indexOf('timingSafeEqual') === -1);
      dogru('uç oturum/auth katmanını çağırmıyor',
        ucSrc.indexOf('_lib/auth.js') === -1 && ucSrc.indexOf('_lib/session.js') === -1);
      dogru('uç telegram sarmalayıcıyla dışa veriliyor', /tg\.ucuSar\(handler/.test(ucSrc));
      dogru('yükleme x-upsert ile (tekrar üretim kopya biriktirmiyor)', stSrc.indexOf("'x-upsert': 'true'") !== -1);
      dogru('servis anahtarı loglanmıyor', !/console\.(log|error|warn)[^\n]*cfg\.key/.test(stSrc));
      dogru('PDF motorun puanını basıyor', raiSrc.indexOf('r.scanner_score') !== -1);
      dogru('PDF modelin puanını basmıyor', !/r\.score/.test(raiSrc));
      dogru('ikinci bir PDF kütüphanesi girmedi',
        raiSrc.indexOf('jspdf') === -1 && raiSrc.indexOf('pdfkit') === -1);
      dogru('PDF yazıcısı paylaşılıyor', raiSrc.indexOf("require('./pdf.js')") !== -1);
    }
  } finally {
    console.error = eskiHata;
    if (eskiSir === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = eskiSir;
    saplamalariSil();
  }

  if (hatalar.length) {
    console.log('\nBAŞARISIZ (' + hatalar.length + '):');
    hatalar.forEach(function (h) { console.log('  - ' + h); });
    console.log('\ngeçen: ' + gecti);
    process.exit(1);
  }
  console.log('AI rapor PDF ucu: ' + gecti + ' / ' + gecti + ' doğrulama geçti');
}

kos().catch(function (e) { console.error(e); process.exit(1); });
