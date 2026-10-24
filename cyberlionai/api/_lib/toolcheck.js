'use strict';

/**
 * Ücretsiz tek konulu araçlar (/araclar/*). İlk araç: güvenlik başlıkları.
 *
 * Tam taramanın KOPYASI değil: aynı motoru (engines/header-scanner.js) ve
 * aynı SSRF kapısını (scanner.guardedFetch → guard.assertPublicHost)
 * kullanır, ama yalnızca başlık kontrollerini döndürür ve en önemli
 * TOP_N bulguyu gösterir. Bütünü tam taramada. Gövde okunmaz (yalnız
 * yanıt başlıkları) — pasif seviye 1, sahiplik doğrulaması gerekmez.
 *
 * Kontrol mantığı burada DEĞİŞMEZ; puan yalnızca bu alt küme üzerinden
 * hesaplanır, bu yüzden tam taramanın puanıyla aynı olması beklenmez.
 */

const scanner = require('./scanner.js');
const headerEngine = require('./engines/header-scanner.js');
const { normalizeTarget } = require('./guard.js');
const { CHECKS } = require('./report.js');
const fixpricing = require('./fixpricing.js');

const HEADER_IDS = ['https', 'hsts', 'csp', 'xframe', 'nosniff', 'referrer', 'permissions', 'disclosure'];
const TOP_N = 3;
const TYPES = ['headers'];

/** Bağlamdan (headers + finalUrl) araç sonucunu üretir. Saf: ağ yok. */
function headersReport(context) {
  const checks = headerEngine.analyze(context, 'tr').checks.filter(function (c) {
    return HEADER_IDS.indexOf(c.id) !== -1;
  });
  const failed = checks.filter(function (c) { return c.status === 'fail'; }).sort(function (a, b) {
    return (scanner.WEIGHTS[b.severity] - scanner.WEIGHTS[a.severity])
      || (HEADER_IDS.indexOf(a.id) - HEADER_IDS.indexOf(b.id));
  });
  const metin = CHECKS.tr;
  const top = failed.slice(0, TOP_N).map(function (c) {
    const m = metin[c.id] || [c.id, '', ''];
    return {
      id: c.id, severity: c.severity, detail: c.detail,
      name: m[0], risk: m[1], fix: m[2],
      fixPrice: fixpricing.TIERS[fixpricing.tierOf(c.id)]
    };
  });
  return {
    type: 'headers',
    host: context.finalUrl.hostname,
    score: scanner.scoreOf(checks),
    summary: {
      total: checks.length,
      pass: checks.filter(function (c) { return c.status === 'pass'; }).length,
      fail: failed.length
    },
    top: top,
    hiddenFailures: failed.length - top.length,
    checkedAt: new Date().toISOString()
  };
}

function errorCode(err) {
  const m = err && err.message;
  if (m === 'timeout' || m === 'blocked_target' || m === 'dns_failed') return m;
  return 'unreachable';
}

/**
 * @param {string} type  TYPES içinden
 * @param {string} rawUrl
 * @param {{fetch?: Function}} [deps] sınama için guardedFetch yerine geçer
 * @returns {Promise<{ok: true} & object | {ok: false, code: string}>}
 */
async function run(type, rawUrl, deps) {
  if (TYPES.indexOf(type) === -1) return { ok: false, code: 'invalid_type' };
  const target = normalizeTarget(rawUrl);
  if (target.error) return { ok: false, code: target.error };
  const fetchFn = (deps && deps.fetch) || scanner.guardedFetch;
  let sonuc;
  try {
    sonuc = await fetchFn(target.url, {});
  } catch (err) {
    return { ok: false, code: errorCode(err) };
  }
  try { if (sonuc.response.body) await sonuc.response.body.cancel(); } catch (e) { /* yok say */ }
  return Object.assign({ ok: true },
    headersReport({ headers: sonuc.response.headers, finalUrl: sonuc.finalUrl, html: null }));
}

module.exports = { run, headersReport, HEADER_IDS, TOP_N, TYPES };
