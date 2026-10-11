'use strict';

/**
 * Kuyruklu taramanın `cl_scans` satırı.
 *
 * NEDEN GEREKLİ
 *
 * Dünya haritasındaki "kendi tarama etkinliğimiz" katmanı `cl_scans`'ten
 * besleniyor. Eşzamanlı yolda satırı `/api/scan` açıyor (`db.saveScan`);
 * kuyruklu yolda taramayı Lambda yürüttüğü için satırı da onun açması
 * gerekiyor. Yoksa bayrak açıldığı anda katman yeni taramalarla büyümeyi
 * bırakır — tarama sayısı artar, harita donar.
 *
 * `db.saveScan()` İLE AYNI ALANLAR. İki yer ayrışırsa haritada kuyruklu ve
 * eşzamanlı taramalar farklı görünür; bu yüzden alan kümesi sınamada
 * karşılaştırılıyor (tools/reportsign-test.js).
 *
 * IP ADRESİ YAZILMIYOR. `country`, taramanın zaten yaptığı DNS çözümünden
 * türeyen iki harf; biçim kısıtı veritabanında da var (göç 006).
 *
 * HAM BAŞLIK DEĞERİ YAZILMIYOR: `findings` yalnızca kontrol kimliği, önem,
 * durum ve kısa not taşıyor (bkz. db.js → sanitizeFindings, aynı biçim).
 */

/** `db.js` → sanitizeFindings ile AYNI daraltma. */
function sanitizeFindings(checks) {
  return (checks || []).map(function (c) {
    return { id: c.id, severity: c.severity, status: c.status, note: c.note || null };
  });
}

/**
 * @param {object} jobRow  `scan_jobs` satırı (sahiplik buradan gelir)
 * @param {object} result  `scanSite()` sonucu
 * @param {object} versions { scanner, report }
 * @returns {object} `cl_scans`'e yazılacak satır
 */
function buildClScanRow(jobRow, result, versions) {
  const ozet = result.summary || {};
  return {
    /* Sahiplik işin satırından KOPYALANIYOR, mesajdan değil: mesaj kuyruğa
       bırakan tarafın dediğini taşır, satır ise sunucunun yazdığını. */
    user_id: jobRow.user_id || null,
    anonymous_session_id: jobRow.user_id ? null : (jobRow.session_id || null),
    host: result.host,
    country: typeof result.country === 'string' && /^[A-Z]{2}$/.test(result.country)
      ? result.country
      : null,
    score: typeof result.score === 'number' ? result.score : null,
    checks_total: ozet.total,
    checks_passed: ozet.passed,
    checks_failed: ozet.failed,
    checks_skipped: ozet.skipped,
    http_status: result.httpStatus,
    redirects: result.redirects,
    duration_ms: result.durationMs,
    findings: sanitizeFindings(result.checks),
    warnings: result.warnings || [],
    scanner_version: versions.scanner,
    report_version: versions.report,
    /* Tekrar teslimde ikinci bir tarama sayılmasın: bu sütunda TEKİL indeks
       var ve yazım `resolution=ignore-duplicates` ile yapılıyor
       (göç: db/2026-10-02-clscans-job-link.sql). */
    job_id: jobRow.id
  };
}

module.exports = { buildClScanRow, sanitizeFindings };
