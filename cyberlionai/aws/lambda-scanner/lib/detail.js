'use strict';

/**
 * `report-owasp.js`'in beklediği "detay" nesnesini bellekteki tarama
 * sonucundan kurar.
 *
 * NEDEN VERİTABANINDAN GERİ OKUMUYORUZ
 *
 * Lambda bulguları zaten yazdı; aynı satırları PDF için tekrar okumak fazladan
 * bir tur ve PostgREST'in replika gecikmesine açık (yazdığını hemen görmeme
 * riski). Gruplama kuralı `db.getJobWithFindings()` ile AYNI olmak zorunda:
 * kategori koduna göre artan, kategorisizler ('other') en sonda, her grup
 * içinde önem sırasına göre. `tools/lambda-detail-test.js` bu sıralamayı
 * sabitliyor; sıra bozulursa PDF'teki bölüm düzeni sessizce değişirdi.
 */

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

function buildDetail(jobRow, result, findings) {
  const liste = findings || [];

  const gruplar = {};
  liste.forEach(function (f) {
    const anahtar = f.owasp_category || 'other';
    if (!gruplar[anahtar]) gruplar[anahtar] = [];
    gruplar[anahtar].push(f);
  });

  const siraliGruplar = Object.keys(gruplar).sort(function (a, b) {
    if (a === 'other') return 1;
    if (b === 'other') return -1;
    return a < b ? -1 : 1;
  }).map(function (anahtar) {
    return {
      category: anahtar,
      findings: gruplar[anahtar].slice().sort(function (x, y) {
        return SEVERITY_ORDER.indexOf(x.severity) - SEVERITY_ORDER.indexOf(y.severity);
      })
    };
  });

  const sayac = {};
  SEVERITY_ORDER.forEach(function (s) { sayac[s] = 0; });
  liste.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(sayac, f.severity)) sayac[f.severity] += 1;
  });

  return {
    job: {
      id: jobRow.id,
      domain: result.host,
      url: result.url,
      status: 'completed',
      score: typeof result.score === 'number' ? result.score : null,
      scannerMode: jobRow.scanner_mode || 'passive',
      country: result.country || null,
      createdAt: jobRow.created_at || null,
      completedAt: jobRow.completed_at || new Date().toISOString(),
      result: {
        score: result.score,
        summary: result.summary,
        owaspFailedCategories: result.owaspFailedCategories || {}
      }
    },
    severityCounts: sayac,
    totalFindings: liste.length,
    groups: siraliGruplar
  };
}

module.exports = { buildDetail, SEVERITY_ORDER };
