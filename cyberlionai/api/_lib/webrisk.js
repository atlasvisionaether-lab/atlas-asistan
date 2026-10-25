'use strict';

/**
 * Google Web Risk — Lookup API (uris.search). Kara liste kaynağı.
 *
 * NEDEN: önceki kaynak abuse.ch URLhaus'un toplu listeleri 410 Gone dönüyor
 * (ölçüldü: 2026-10-24) ve ücretsiz anahtarı yalnızca kâr amacı gütmeyen
 * kullanıma açık. Web Risk ticari kullanıma açık; ayda 100.000 sorgu ücretsiz.
 *
 * GİZLİLİK: Google'a yalnızca adresin kökeni ve yolu gider; sorgu dizesi ve
 * # parçası (belirteç taşıyabilir) GÖNDERİLMEZ. IP, e-posta, hesap bilgisi
 * hiçbir zaman gönderilmez. Gizlilik politikası ve KVKK metni bunu söylüyor.
 *
 * KULLANIM KOŞULLARI (docs.cloud.google.com/web-risk/docs/user-warnings):
 *   - Uyarı yalnızca sonucun geçerlilik süresi (expireTime) içinde gösterilir.
 *     Bu yüzden eşleşme EN FAZLA expireTime'a kadar önbelleklenir ve sonuç
 *     `expireTime`'ı taşır; çağıran (araç ucu) kendi önbelleğini de buna göre
 *     kısaltır.
 *   - Uyarı kesin dil kullanmaz ("olası"), "Advisory provided by Google"
 *     atfını ve tehdit türüne göre bilgi bağlantısını taşır: ADVISORY ve
 *     LEARN_MORE burada, metinler arayüzde.
 *
 * Ortam: GOOGLE_WEB_RISK_API_KEY. Yoksa sonuç { ok:false, reason:'not_configured' }
 * olur ve kontrol "ölçülemedi" görünür — tarama düşmez.
 */

const ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search';
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
const TIMEOUT_MS = 5000;
/* Temiz sonuç için önbellek. Uyarı göstermediği için süre kuralına tabi değil;
   yine de kısa tutuluyor ki yeni listelenen bir site çabuk görünsün. */
const CLEAN_CACHE_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;

const ADVISORY_URL = 'https://docs.cloud.google.com/web-risk/docs/advisory';
const LEARN_MORE = {
  SOCIAL_ENGINEERING: 'https://www.antiphishing.org',
  MALWARE: 'https://developers.google.com/search/docs/advanced/security/malware',
  UNWANTED_SOFTWARE: 'https://www.google.com/about/company/unwanted-software-policy.html'
};

/* Kullanıcıya görünen tür adları. Kesin dil YOK: arayüz "olası" ile kullanır. */
const THREAT_LABEL = {
  tr: { MALWARE: 'zararlı yazılım', SOCIAL_ENGINEERING: 'oltalama (sosyal mühendislik)', UNWANTED_SOFTWARE: 'istenmeyen yazılım' },
  en: { MALWARE: 'malware', SOCIAL_ENGINEERING: 'phishing (social engineering)', UNWANTED_SOFTWARE: 'unwanted software' }
};

const cache = new Map(); // anahtar → { until, value }

/** Google'a gidecek adres: köken + yol; sorgu ve parça atılır. */
function lookupUri(raw) {
  let u;
  try { u = raw instanceof URL ? new URL(raw.href) : new URL(String(raw)); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.search = '';
  u.hash = '';
  u.username = '';
  u.password = '';
  return u.href;
}

function onbellektenOku(anahtar, simdi) {
  const k = cache.get(anahtar);
  if (!k) return null;
  if (k.until <= simdi) { cache.delete(anahtar); return null; }
  return k.value;
}

function onbellegeYaz(anahtar, value, until) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(anahtar, { until: until, value: value });
}

/**
 * @param {string|URL} raw   kontrol edilecek adres
 * @param {{fetch?: Function, key?: string, now?: number}} [deps] sınama için
 * @returns {Promise<{ok:true, uri, threats:string[], expireTime:string|null, checkedAt}
 *                 | {ok:false, reason:string}>}
 */
async function lookup(raw, deps) {
  const d = deps || {};
  const key = d.key !== undefined ? d.key : process.env.GOOGLE_WEB_RISK_API_KEY;
  if (!key) return { ok: false, reason: 'not_configured' };
  const uri = lookupUri(raw);
  if (!uri) return { ok: false, reason: 'bad_uri' };

  const simdi = d.now || Date.now();
  const onceki = onbellektenOku(uri, simdi);
  if (onceki) return onceki;

  const qs = THREAT_TYPES.map(function (t) { return 'threatTypes=' + t; }).join('&')
    + '&uri=' + encodeURIComponent(uri) + '&key=' + encodeURIComponent(key);
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  let body;
  try {
    const res = await (d.fetch || fetch)(ENDPOINT + '?' + qs, { signal: controller.signal });
    /* Anahtar URL'de olduğu için hata nesnesi/URL hiçbir yere yazılmaz. */
    if (!res.ok) return { ok: false, reason: 'http_' + res.status };
    body = await res.json();
  } catch (err) {
    return { ok: false, reason: err && err.name === 'AbortError' ? 'timeout' : 'error' };
  } finally {
    clearTimeout(timer);
  }

  const threat = body && body.threat;
  const threats = threat && Array.isArray(threat.threatTypes)
    ? threat.threatTypes.filter(function (t) { return THREAT_TYPES.indexOf(t) !== -1; })
    : [];
  const sonuc = {
    ok: true,
    uri: uri,
    threats: threats,
    expireTime: threats.length && threat.expireTime ? String(threat.expireTime) : null,
    checkedAt: new Date(simdi).toISOString()
  };

  if (threats.length) {
    /* Eşleşme yalnızca Google'ın verdiği süre kadar geçerli. Süre yoksa veya
       okunamıyorsa önbelleğe ALINMAZ (her seferinde taze sorgu). */
    const bitis = Date.parse(sonuc.expireTime || '');
    if (!isNaN(bitis) && bitis > simdi) onbellegeYaz(uri, sonuc, bitis);
  } else {
    onbellegeYaz(uri, sonuc, simdi + CLEAN_CACHE_MS);
  }
  return sonuc;
}

/** Eşleşmenin uyarı olarak gösterilebileceği kalan saniye (0 = gösterilemez). */
function warningSecondsLeft(result, now) {
  if (!result || !result.ok || !result.threats || !result.threats.length) return 0;
  const bitis = Date.parse(result.expireTime || '');
  if (isNaN(bitis)) return 0;
  return Math.max(0, Math.floor((bitis - (now || Date.now())) / 1000));
}

function _resetCache() { cache.clear(); }

module.exports = {
  lookup, lookupUri, warningSecondsLeft, THREAT_TYPES, THREAT_LABEL, ADVISORY_URL, LEARN_MORE, _resetCache
};
