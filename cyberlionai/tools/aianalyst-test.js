'use strict';

/**
 * AI analist katmanının sınaması.
 *
 * NEDEN BU DOSYA VAR
 *
 * Bu katmanın çıktısı müşteriye gösterilen ekrana ve PDF'e giriyor, girdisi
 * ise DIŞ bir servise gidiyor. İki yönde de sessizce yanlış olabilir:
 * modelin uydurduğu bir alan ekrana düşebilir, ya da hedef sitenin ham
 * başlıkları üçüncü tarafa sızabilir. İkisi de bir hata mesajı vermez.
 *
 * Sabitlenen kararlar:
 *   - Modelin çıktısı VERİDİR: şemaya uymayan yanıt REDDEDİLİR, tahminle
 *     tamamlanmaz.
 *   - HAM BAŞLIK DEĞERLERİ (`detail`) modele GİTMEZ; e-posta/IP de gitmez.
 *   - Anahtar hiçbir loga girmez, "Bearer " öneki kodda kurulur (403'ün
 *     en sık sebebi bu önekin eksikliği).
 *   - 401/403 ayrı bir kodla ayrılır: operatör "anahtar süresi dolmuş"u
 *     genel bir başarısızlıktan ayırt edebilsin.
 *   - analyzeScan ASLA fırlatmaz; AI özeti yüzünden tarama 500 dönmez.
 *
 * Ağ yok: `global.fetch` saplanıyor.
 */

const path = require('node:path');

const YOL = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'aianalyst.js'));

const ANAHTAR = 'nvapi-7KqZm3Rn4pQw7sTvB2cDeFgHiJkLmNoPqRsTuVwX';

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen)
    + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

function yukle(env) {
  const anahtarlar = ['NVIDIA_API_KEY', 'NVIDIA_MODEL', 'NVIDIA_BASE_URL'];
  const eski = {};
  anahtarlar.forEach(function (k) { eski[k] = process.env[k]; delete process.env[k]; });
  Object.keys(env || {}).forEach(function (k) { process.env[k] = env[k]; });
  delete require.cache[YOL];
  const mod = require(YOL);
  return {
    ai: mod,
    geriAl: function () {
      anahtarlar.forEach(function (k) {
        if (eski[k] === undefined) delete process.env[k];
        else process.env[k] = eski[k];
      });
      delete require.cache[YOL];
    }
  };
}

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
      },
      text: async function () { return y.text === undefined ? '' : y.text; }
    };
  };
  return { cagrilar: cagrilar, geriAl: function () { global.fetch = eski; } };
}

function logYakala() {
  const eski = console.error;
  const satirlar = [];
  console.error = function () {
    satirlar.push(Array.prototype.slice.call(arguments).map(String).join(' '));
  };
  return { satirlar: satirlar, geriAl: function () { console.error = eski; } };
}

/* Gerçek bir tarama sonucunun şekli. `detail` alanları BİLEREK dolu: sınama
   onların modele gitmediğini ölçüyor. */
const TARAMA = {
  host: 'ornek.com',
  url: 'https://ornek.com/',
  score: 72,
  summary: { total: 20, passed: 14, failed: 5, skipped: 1 },
  checks: [
    { id: 'hsts', severity: 'high', status: 'fail', detail: 'max-age=0', note: null },
    {
      id: 'csp', severity: 'high', status: 'fail',
      detail: "default-src 'self' https://ic-panel.ornek.com", note: null
    },
    {
      id: 'cookies', severity: 'medium', status: 'fail',
      detail: 'Set-Cookie: SESSID=abc; Path=/admin-gizli', note: null
    },
    { id: 'spf', severity: 'medium', status: 'pass', detail: 'v=spf1 -all', note: null }
  ],
  warnings: [],
  httpStatus: 200,
  clientIp: '203.0.113.7',
  ownerEmail: 'musteri@ornek.com'
};

function iyiYanit(govde) {
  return { status: 200, json: { choices: [{ message: { content: govde } }] } };
}

const IYI_JSON = JSON.stringify({
  risk_level: 'high',
  score: 68,
  summary_tr: 'HSTS ve CSP eksik. Alan adı sahte e-postaya karşı korumalı.',
  findings: ['HSTS yok', 'CSP eksik'],
  recommendations: ['HSTS ekle', 'CSP yaz', 'Çerez bayrakları']
});

async function kos() {

  /* ---- 1. Yapılandırma ---- */
  {
    let y = yukle({});
    esit('anahtar yoksa kapalı', y.ai.isConfigured(), false);
    y.geriAl();

    y = yukle({ NVIDIA_API_KEY: 'kisa' });
    esit('20 karakterden kısa anahtar reddediliyor', y.ai.isConfigured(), false);
    y.geriAl();

    y = yukle({ NVIDIA_API_KEY: ANAHTAR });
    esit('geçerli anahtar açık', y.ai.isConfigured(), true);
    y.geriAl();
  }

  /* ---- 2. Modele giden gövde: ham başlıklar GİTMİYOR ---- */
  {
    const y = yukle({ NVIDIA_API_KEY: ANAHTAR });
    const g = y.ai.ozetle(TARAMA);
    const metin = JSON.stringify(g);

    esit('alan adı gidiyor', g.domain, 'ornek.com');
    esit('motorun puanı gidiyor', g.scanner_score, 72);
    esit('kontrol sayısı korunuyor', g.checks.length, 4);
    esit('kontrol yalnızca üç alan taşıyor',
      Object.keys(g.checks[0]).sort().join(','), 'id,severity,status');

    dogru('ham CSP değeri gitmiyor', metin.indexOf('ic-panel') === -1);
    dogru('Set-Cookie değeri gitmiyor', metin.indexOf('SESSID') === -1);
    dogru('gizli yol gitmiyor', metin.indexOf('admin-gizli') === -1);
    dogru('IP gitmiyor', metin.indexOf('203.0.113.7') === -1);
    dogru('e-posta gitmiyor', metin.indexOf('musteri@ornek.com') === -1);
    dogru('hiçbir detail alanı yok', metin.indexOf('detail') === -1);

    /* Çok kontrollü bir tarama modele sınırsız gövde göndermiyor. */
    const cok = { host: 'a.com', score: 1, checks: [] };
    for (let i = 0; i < 200; i += 1) {
      cok.checks.push({ id: 'k' + i, severity: 'low', status: 'pass' });
    }
    dogru('kontrol listesi tavanla sınırlı', y.ai.ozetle(cok).checks.length <= 60);
    y.geriAl();
  }

  /* ---- 3. JSON sökme: çit, önsöz, bozuk ---- */
  {
    const y = yukle({ NVIDIA_API_KEY: ANAHTAR });
    esit('düz JSON', (y.ai.jsonSok('{"a":1}') || {}).a, 1);
    esit('```json çitli', (y.ai.jsonSok('```json\n{"a":2}\n```') || {}).a, 2);
    esit('``` çitli (dilsiz)', (y.ai.jsonSok('```\n{"a":3}\n```') || {}).a, 3);
    esit('önsözlü', (y.ai.jsonSok('İşte sonuç:\n{"a":4}\nUmarım yardımcı olur.') || {}).a, 4);
    esit('bozuk JSON null', y.ai.jsonSok('{"a":'), null);
    esit('hiç JSON yok null', y.ai.jsonSok('merhaba'), null);
    esit('string değil null', y.ai.jsonSok(null), null);
    y.geriAl();
  }

  /* ---- 4. Şema doğrulaması: uymayan yanıt REDDEDİLİYOR ---- */
  {
    const y = yukle({ NVIDIA_API_KEY: ANAHTAR });
    const d = y.ai.dogrula;
    const t = { domain: 'ornek.com', scanner_score: 72 };

    esit('risk_level listede değilse reddediliyor',
      d({ risk_level: 'apocalyptic', summary_tr: 'x' }, t), null);
    esit('risk_level yoksa reddediliyor', d({ summary_tr: 'x' }, t), null);
    esit('özet yoksa reddediliyor', d({ risk_level: 'low' }, t), null);
    esit('boş özet reddediliyor', d({ risk_level: 'low', summary_tr: '   ' }, t), null);
    esit('nesne değilse reddediliyor', d('{}', t), null);
    esit('büyük harfli risk_level kabul',
      (d({ risk_level: 'HIGH', summary_tr: 'x' }, t) || {}).risk_level, 'high');

    esit('puan 100 üstünde kırpılıyor',
      d({ risk_level: 'low', summary_tr: 'x', score: 150 }, t).score, 100);
    esit('negatif puan sıfıra kırpılıyor',
      d({ risk_level: 'low', summary_tr: 'x', score: -5 }, t).score, 0);
    esit('puan sayı değilse null',
      d({ risk_level: 'low', summary_tr: 'x', score: 'yüksek' }, t).score, null);
    esit('sonsuz puan null',
      d({ risk_level: 'low', summary_tr: 'x', score: Infinity }, t).score, null);
    esit('motorun puanı korunuyor',
      d({ risk_level: 'low', summary_tr: 'x' }, t).scanner_score, 72);

    const uzun = d({
      risk_level: 'low', summary_tr: 'ö'.repeat(5000),
      findings: new Array(100).fill('f'),
      recommendations: new Array(100).fill('r')
    }, t);
    dogru('özet tavana kırpılıyor', uzun.summary_tr.length <= y.ai.LIMITS.summary);
    dogru('bulgular tavanla sınırlı', uzun.findings.length === y.ai.LIMITS.findings);
    dogru('öneriler tavanla sınırlı',
      uzun.recommendations.length === y.ai.LIMITS.recommendations);

    const karisik = d({
      risk_level: 'medium', summary_tr: 'a\u0000b\u001fc',
      findings: ['iyi', 42, null, { a: 1 }, '  ', 'ikinci']
    }, t);
    dogru('denetim karakterleri atılıyor', !/[\u0000-\u001f]/.test(karisik.summary_tr));
    esit('metin olmayan elemanlar düşüyor', karisik.findings.join('|'), 'iyi|ikinci');

    esit('actions takma adı da okunuyor',
      d({ risk_level: 'low', summary_tr: 'x', actions: ['bir'] }, t)
        .recommendations.join(''), 'bir');
    y.geriAl();
  }

  /* ---- 5. İstek biçimi: Bearer öneki ve model ---- */
  {
    const y = yukle({ NVIDIA_API_KEY: ANAHTAR });
    const f = fetchSapla([iyiYanit(IYI_JSON)]);
    const sonuc = await y.ai.analyzeScan(TARAMA);
    f.geriAl();

    esit('başarılı', sonuc.ok, true);
    esit('tek istek', f.cagrilar.length, 1);
    const c = f.cagrilar[0];
    esit('POST', c.secenek.method, 'POST');
    dogru('adres chat/completions',
      /^https:\/\/integrate\.api\.nvidia\.com\/v1\/chat\/completions$/.test(c.adres));
    esit('Authorization başlığı "Bearer " önekli',
      c.secenek.headers.Authorization, 'Bearer ' + ANAHTAR);
    const govde = JSON.parse(c.secenek.body);
    esit('varsayılan model', govde.model, y.ai.DEFAULT_MODEL);
    esit('model adı talimattaki', govde.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
    esit('iki mesaj', govde.messages.length, 2);
    esit('ilk mesaj system', govde.messages[0].role, 'system');
    dogru('ham başlık gövdede yok', c.secenek.body.indexOf('SESSID') === -1);

    esit('risk seviyesi', sonuc.report.risk_level, 'high');
    esit('özet', sonuc.report.summary_tr,
      'HSTS ve CSP eksik. Alan adı sahte e-postaya karşı korumalı.');
    esit('üç öneri', sonuc.report.recommendations.length, 3);
    esit('model raporda', sonuc.report.model, y.ai.DEFAULT_MODEL);
    esit('motorun puanı raporda', sonuc.report.scanner_score, 72);
    y.geriAl();
  }

  /* ---- 6. Model adı ve taban ortamdan değiştirilebiliyor ---- */
  {
    const y = yukle({
      NVIDIA_API_KEY: ANAHTAR,
      NVIDIA_MODEL: 'nvidia/baska-model',
      NVIDIA_BASE_URL: 'https://ornek.invalid/'
    });
    const f = fetchSapla([iyiYanit(IYI_JSON)]);
    await y.ai.analyzeScan(TARAMA);
    f.geriAl();
    esit('model ortamdan', JSON.parse(f.cagrilar[0].secenek.body).model, 'nvidia/baska-model');
    esit('taban ortamdan, sonda eğik çizgi yok', f.cagrilar[0].adres,
      'https://ornek.invalid/v1/chat/completions');
    y.geriAl();
  }

  /* ---- 7. 403 ayrı kod, ANAHTAR LOGA GİRMİYOR ---- */
  {
    const y = yukle({ NVIDIA_API_KEY: ANAHTAR });
    const f = fetchSapla([{
      status: 403,
      text: 'Forbidden: invalid api key nvapi-7KqZm3Rn4pQw7sTvB2cDeFgHiJkLmNoPqRsTuVwX'
    }]);
    const log = logYakala();
    const sonuc = await y.ai.analyzeScan(TARAMA);
    log.geriAl(); f.geriAl();

    esit('403 ai_unauthorized', sonuc.code, 'ai_unauthorized');
    esit('başarısız', sonuc.ok, false);
    dogru('başarısızlık loglanıyor', log.satirlar.length >= 1);
    const hepsi = log.satirlar.join('\n');
    dogru('ANAHTAR logda YOK', hepsi.indexOf(ANAHTAR) === -1);
    dogru('log durum kodunu söylüyor', hepsi.indexOf('403') !== -1);
    y.geriAl();
  }

  /* ---- 8. Diğer HTTP kodları ---- */
  {
    const y = yukle({ NVIDIA_API_KEY: ANAHTAR });
    const durumlar = [[401, 'ai_unauthorized'], [429, 'ai_rate_limited'],
      [500, 'ai_rejected'], [404, 'ai_rejected']];
    for (const [durum, kod] of durumlar) {
      const f = fetchSapla([{ status: durum, text: 'hata' }]);
      const log = logYakala();
      const s = await y.ai.analyzeScan(TARAMA);
      log.geriAl(); f.geriAl();
      esit(durum + ' → ' + kod, s.code, kod);
      esit(durum + ' durum kodu taşınıyor', s.status, durum);
    }
    y.geriAl();
  }

  /* ---- 9. Zaman aşımı, ağ hatası ve bozuk çıktı FIRLATMIYOR ---- */
  {
    const y = yukle({ NVIDIA_API_KEY: ANAHTAR });

    let f = fetchSapla([function () {
      const e = new Error('abort'); e.name = 'AbortError'; throw e;
    }]);
    let log = logYakala();
    let s = await y.ai.analyzeScan(TARAMA);
    log.geriAl(); f.geriAl();
    esit('zaman aşımı kodu', s.code, 'ai_timeout');

    f = fetchSapla([function () { throw new Error('ECONNRESET ' + ANAHTAR); }]);
    log = logYakala();
    s = await y.ai.analyzeScan(TARAMA);
    log.geriAl(); f.geriAl();
    esit('ağ hatası kodu', s.code, 'ai_unreachable');
    dogru('ağ hatasında da anahtar loga girmiyor',
      log.satirlar.join('\n').indexOf(ANAHTAR) === -1);

    /* Model şemaya uymayan bir şey döndürdü: UYDURMA ÖZET ÜRETİLMİYOR. */
    for (const kotu of ['merhaba, nasılsın', '{"risk_level":"bilmiyorum"}',
      '{"summary_tr":"özet var ama seviye yok"}', '{"a":']) {
      f = fetchSapla([iyiYanit(kotu)]);
      log = logYakala();
      s = await y.ai.analyzeScan(TARAMA);
      log.geriAl(); f.geriAl();
      esit('bozuk çıktı reddediliyor: ' + kotu.slice(0, 20), s.code, 'ai_bad_output');
      esit('bozuk çıktıda rapor YOK', s.report, undefined);
    }

    /* choices hiç yoksa da aynı. */
    f = fetchSapla([{ status: 200, json: { choices: [] } }]);
    log = logYakala();
    s = await y.ai.analyzeScan(TARAMA);
    log.geriAl(); f.geriAl();
    esit('choices boşsa ai_bad_output', s.code, 'ai_bad_output');

    y.geriAl();
  }

  /* ---- 10. Yapılandırma yoksa ağa HİÇ çıkılmıyor ---- */
  {
    const y = yukle({});
    const f = fetchSapla([iyiYanit(IYI_JSON)]);
    const s = await y.ai.analyzeScan(TARAMA);
    f.geriAl();
    esit('unconfigured', s.code, 'unconfigured');
    esit('istek atılmıyor', f.cagrilar.length, 0);
    y.geriAl();
  }

  /* ---- 11. Alan adı olmayan tarama modele gönderilmiyor ---- */
  {
    const y = yukle({ NVIDIA_API_KEY: ANAHTAR });
    const f = fetchSapla([iyiYanit(IYI_JSON)]);
    const s = await y.ai.analyzeScan({ score: 10, checks: [] });
    f.geriAl();
    esit('alan adı yoksa ai_bad_input', s.code, 'ai_bad_input');
    esit('alan adı yoksa istek yok', f.cagrilar.length, 0);
    y.geriAl();
  }

  if (hatalar.length) {
    console.error('\nAI analist sınaması: ' + hatalar.length + ' KALDI, '
      + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('AI analist sınaması: ' + gecti + ' / ' + gecti + ' geçti');
}

kos().catch(function (err) {
  console.error('sınama çöktü:', err && err.stack || err);
  process.exit(1);
});
