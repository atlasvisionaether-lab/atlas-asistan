'use strict';

/**
 * AI analist katmanı — NVIDIA Nemotron.
 *
 * Tarama SONUCUNU alır, müşteriye gösterilecek Türkçe bir özet, risk seviyesi
 * ve üç maddelik aksiyon planı üretir. Taramanın kendisini YAPMAZ ve puanı
 * DEĞİŞTİRMEZ: ölçüm `_lib/scanner.js` motorlarının işi, bu katman yalnızca
 * anlatıyor.
 *
 * ORTAM DEĞİŞKENLERİ (değerleri koda yazılmaz, Vercel'de tanımlanır)
 *   NVIDIA_API_KEY   build.nvidia.com/settings/api-keys → "nvapi-..."
 *   NVIDIA_MODEL     (ops.) varsayılan aşağıda; model adı değişirse tek satır
 *   NVIDIA_BASE_URL  (ops.) varsayılan https://integrate.api.nvidia.com
 *
 * Anahtar yoksa katman KAPALI: `isConfigured()` false döner, hiç ağ isteği
 * atılmaz ve çağıran uç taramayı AI özeti olmadan döndürür. AI özeti bir
 * kolaylık, taramanın kendisi değil.
 *
 * MODELİN ÇIKTISI VERİDİR, TALİMAT DEĞİL
 *
 * Model, müşterinin seçtiği alan adını ve motorların ürettiği kodları görüyor;
 * döndürdüğü metin de müşteriye gösterilen ekrana ve PDF'e giriyor. Bu yüzden
 * çıktı ŞEMAYA KARŞI DOĞRULANIYOR: `risk_level` kapalı bir listeden, `score`
 * 0–100'e kırpılıyor, diziler ve metinler uzunlukla sınırlanıyor, denetim
 * karakterleri atılıyor. Modelin döndürdüğü hiçbir alan "olduğu gibi"
 * geçmiyor; şemaya uymayan yanıt reddediliyor (`ai_bad_output`).
 *
 * PUAN ÇELİŞKİSİ — BİLİNÇLİ
 *
 * Modelden de bir `score` isteniyor (sözleşmede var) ama GÖSTERİLEN puan
 * motorların hesapladığı puandır. İki sayıdan hangisinin doğru olduğunu
 * tartışmak yerine ikisi birlikte saklanıyor (`score` modelin, `scanner_score`
 * bizim); sapma büyükse bu, kalibrasyonun bozulduğunun işareti. Bir dil
 * modelinin ürettiği sayı müşteriye satılan ölçüm olamaz.
 *
 * ÜÇÜNCÜ TARAFA NE GİTMEZ
 *
 * NVIDIA dış bir servis. Modele giden gövde `ozetle()` ile kuruluyor ve
 * yalnızca alan adı, puan ve kontrol başına {id, severity, status} taşıyor.
 * HAM BAŞLIK DEĞERLERİ GİTMİYOR: bir `Set-Cookie` ya da `CSP` başlığı hedef
 * sitenin iç yapısını taşıyabilir (aynı gerekçe `db.js`'teki
 * `sanitizeFindings` için de geçerli). E-posta, IP, oturum/kullanıcı kimliği
 * ve sertifika ayrıntısı da gitmiyor.
 */

const DEFAULT_BASE = 'https://integrate.api.nvidia.com';
const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const PATH = '/v1/chat/completions';

/* Tarama saniyeler sürüyor; AI özeti onun üstüne sınırsız eklenemez. Süre
   aşılırsa tarama AI özeti olmadan döner. */
const TIMEOUT_MS = 20000;

const MAX_TOKENS = 1500;
const TEMPERATURE = 0.3;

/* Modelin çıktısına konan tavanlar. Şemanın kendisi sınır: sınırsız bir
   dizi ya da metin, ekranı ve PDF'i bozardı. */
const LIMITS = {
  summary: 600,
  finding: 300,
  recommendation: 300,
  findings: 20,
  recommendations: 10
};

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

const SYSTEM_PROMPT = [
  'Sen CyberLion AI güvenlik analistisin. Tonun net ve doğrudan.',
  'Verilen tarama sonucunu Türkçe özetle. Yalnızca verilen bulgulara dayan;',
  'taranmamış bir şey hakkında yorum yapma, eksik veriyi tahminle doldurma.',
  'SADECE şu biçimde JSON döndür, başka hiçbir metin yazma:',
  '{"risk_level":"low|medium|high|critical","score":0-100,',
  '"summary_tr":"en çok iki cümle","findings":["..."],',
  '"recommendations":["üç madde"]}'
].join(' ');

function config() {
  const key = process.env.NVIDIA_API_KEY;
  if (!key || String(key).length < 20) return null;
  return {
    key: String(key),
    model: process.env.NVIDIA_MODEL || DEFAULT_MODEL,
    base: String(process.env.NVIDIA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
  };
}

function isConfigured() { return config() !== null; }

/**
 * Loglanacak metinden anahtarı siler. Anahtar başlıkta duruyor, adreste değil
 * (bkz. telegram.js'teki aynı sorun), ama hata gövdesi isteği yankılayabilir.
 */
function gizle(metin) {
  const s = metin === null || metin === undefined ? '' : String(metin);
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return s;
  return s.split(String(key)).join('[key]');
}

/** Metni tavana kırpar ve denetim karakterlerini atar. */
function metin(deger, tavan) {
  if (typeof deger !== 'string') return null;
  let s = deger.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (!s) return null;
  if (s.length > tavan) s = s.slice(0, tavan - 1) + '…';
  return s;
}

/** Dizi alanları: yalnızca metin elemanlar, tavana kadar. */
function dizi(deger, enFazla, tavan) {
  if (!Array.isArray(deger)) return [];
  const cikti = [];
  for (let i = 0; i < deger.length && cikti.length < enFazla; i += 1) {
    const s = metin(deger[i], tavan);
    if (s) cikti.push(s);
  }
  return cikti;
}

/**
 * Modele gidecek gövde. Ham başlık değerleri BİLEREK dışarıda — yukarıdaki
 * "üçüncü tarafa ne gitmez" notuna bakın.
 */
function ozetle(sonuc) {
  const s = sonuc || {};
  const checks = Array.isArray(s.checks) ? s.checks : [];
  return {
    domain: typeof s.host === 'string' ? s.host : null,
    scanner_score: typeof s.score === 'number' ? s.score : null,
    summary: s.summary && typeof s.summary === 'object' ? {
      total: s.summary.total || 0,
      passed: s.summary.passed || 0,
      failed: s.summary.failed || 0,
      skipped: s.summary.skipped || 0
    } : null,
    checks: checks.slice(0, 60).map(function (c) {
      return {
        id: typeof c.id === 'string' ? c.id : null,
        severity: typeof c.severity === 'string' ? c.severity : null,
        status: typeof c.status === 'string' ? c.status : null
      };
    })
  };
}

/**
 * Modelin metninden JSON söker.
 *
 * Model ```json çiti koyabiliyor ya da JSON'un önüne bir cümle yazabiliyor;
 * "sadece JSON döndür" demek bunu garanti etmiyor. Bu yüzden önce düz parse
 * denenir, olmazsa ilk `{` ile son `}` arası alınır. Bulunamazsa yanıt
 * REDDEDİLİR — yarım bir JSON'u tahminle tamamlamak, müşteriye uydurma bir
 * özet göstermek olurdu.
 */
function jsonSok(ham) {
  if (typeof ham !== 'string') return null;
  const temiz = ham.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(temiz); } catch (err) { /* aşağıdaki yola düşülür */ }
  const bas = temiz.indexOf('{');
  const son = temiz.lastIndexOf('}');
  if (bas === -1 || son <= bas) return null;
  try { return JSON.parse(temiz.slice(bas, son + 1)); } catch (err) { return null; }
}

/**
 * Modelin çıktısını şemaya indirger. Şemaya uymayan alanlar DÜŞER; zorunlu
 * alanlar yoksa `null` döner ve çağıran bunu `ai_bad_output` sayar.
 */
function dogrula(nesne, tarama) {
  if (!nesne || typeof nesne !== 'object') return null;

  const seviye = typeof nesne.risk_level === 'string'
    ? nesne.risk_level.toLowerCase().trim() : null;
  if (RISK_LEVELS.indexOf(seviye) === -1) return null;

  const ozet = metin(nesne.summary_tr || nesne.summary, LIMITS.summary);
  if (!ozet) return null;

  let puan = null;
  if (typeof nesne.score === 'number' && isFinite(nesne.score)) {
    puan = Math.max(0, Math.min(100, Math.round(nesne.score)));
  }

  return {
    risk_level: seviye,
    score: puan,
    /* Motorların puanı yanında taşınıyor: hangisinin gösterildiği
       tartışmaya açık kalmasın (bkz. "PUAN ÇELİŞKİSİ"). */
    scanner_score: tarama && typeof tarama.scanner_score === 'number'
      ? tarama.scanner_score : null,
    summary_tr: ozet,
    findings: dizi(nesne.findings, LIMITS.findings, LIMITS.finding),
    recommendations: dizi(
      nesne.recommendations || nesne.actions, LIMITS.recommendations, LIMITS.recommendation),
    model: null,
    domain: tarama ? tarama.domain : null
  };
}

/**
 * Tarama sonucunu analiz eder.
 *
 * ASLA FIRLATMAZ: AI özeti yüzünden bir tarama 500 dönmemeli. Başarısızlık
 * yutulmaz, `{ok:false, code}` ile geri verilir ve tek satır loglanır.
 *
 * Kodlar: `unconfigured` | `ai_unauthorized` (401/403 — anahtar yok ya da
 * süresi dolmuş) | `ai_rate_limited` (429) | `ai_rejected` (diğer HTTP) |
 * `ai_timeout` | `ai_unreachable` | `ai_bad_output` (şemaya uymadı).
 */
async function analyzeScan(sonuc) {
  const cfg = config();
  if (!cfg) return { ok: false, code: 'unconfigured' };

  const tarama = ozetle(sonuc);
  if (!tarama.domain) return { ok: false, code: 'ai_bad_input' };

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(cfg.base + PATH, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        /* "Bearer " ÖNEKİ ZORUNLU. Eksik olduğunda NVIDIA 403 döner ve hata
           mesajı sebebi söylemez; o yüzden önek burada kuruluyor, ortam
           değişkenine bırakılmıyor. */
        'Authorization': 'Bearer ' + cfg.key,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(tarama) }
        ]
      })
    });
  } catch (err) {
    clearTimeout(timer);
    const abort = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    return bildir({ ok: false, code: abort ? 'ai_timeout' : 'ai_unreachable' });
  }
  clearTimeout(timer);

  if (!response.ok) {
    const govde = await response.text().catch(function () { return ''; });
    const kod = response.status === 401 || response.status === 403
      ? 'ai_unauthorized'
      : (response.status === 429 ? 'ai_rate_limited' : 'ai_rejected');
    return bildir({ ok: false, code: kod, status: response.status, detay: govde });
  }

  let yanit;
  try { yanit = await response.json(); } catch (err) { yanit = null; }

  const ham = yanit && yanit.choices && yanit.choices[0]
    && yanit.choices[0].message && yanit.choices[0].message.content;

  const rapor = dogrula(jsonSok(ham), tarama);
  if (!rapor) return bildir({ ok: false, code: 'ai_bad_output' });

  rapor.model = cfg.model;
  return { ok: true, report: rapor };
}

/** Başarısızlığı tek satır loglar (anahtar gizli) ve olduğu gibi döndürür. */
function bildir(sonuc) {
  if (console && console.error) {
    console.error(gizle('ai analyst failed: ' + sonuc.code
      + ' ' + (sonuc.status || 0)
      + (sonuc.detay ? ' ' + String(sonuc.detay).slice(0, 200) : '')));
  }
  return { ok: false, code: sonuc.code, status: sonuc.status };
}

module.exports = {
  analyzeScan, isConfigured, gizle,
  ozetle, jsonSok, dogrula,
  RISK_LEVELS, LIMITS, DEFAULT_MODEL, SYSTEM_PROMPT
};
