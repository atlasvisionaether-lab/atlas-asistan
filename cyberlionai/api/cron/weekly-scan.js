'use strict';

/**
 * Günlük izleme koşusu (eski adıyla haftalık tarama; yol geriye uyum için
 * aynı kaldı).
 *
 *   GET  /api/cron/weekly-scan   Vercel Cron, günde bir (vercel.json)
 *   POST /api/cron/weekly-scan   QStash (imzalı)
 *
 * Yaptıkları:
 *   1. 5 dakikalık QStash tetikleyicisini (api/cron/tick) oluşturur/günceller.
 *      Upstash konsolunda elle ayar gerekmez; günlük koşu onu ayakta tutar.
 *   2. 12 aydan eski tarama günlüğünü siler (gizlilik metniyle aynı süre).
 *   3. Bugün taranmamış Pro/Enterprise alan adlarından birkaçını tarar
 *      (tick asıl yükü taşır; bu koşu QStash düşerse yedek).
 *
 * Kimlik doğrulaması: _lib/cronauth.js (fail-closed).
 */

const db = require('../_lib/db.js');
const cronauth = require('../_lib/cronauth.js');
const ownership = require('../_lib/ownership.js');
const monitor = require('../_lib/monitor.js');
const { scanSite, SCANNER_VERSION, REPORT_VERSION } = require('../_lib/scanner.js');

/* Serverless süresi 60 sn; bir tarama ~10–20 sn. */
const MAX_SCANS_PER_RUN = 2;

function saveJob(scan, target) {
  /* İzleme taraması PASİF ve kullanıcının o anki isteği değil: consent false,
     IP yok. */
  return db.saveOwaspJob(scan, { userId: target.userId, ip: null },
    { scanner: SCANNER_VERSION, report: REPORT_VERSION }, false);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  const auth = cronauth.authorize(req);
  if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code } });
  if (!db.isConfigured()) return res.status(503).json({ error: { code: 'db_unavailable' } });

  const schedule = await monitor.ensureTickSchedule();
  if (!schedule.ok && console && console.error) console.error('monitor: tick schedule -', schedule.code);

  let purgedBefore = null;
  try { purgedBefore = await ownership.purgeOldLogs(); } catch (err) {
    if (console && console.error) console.error('scan log purge failed:', err.message);
  }

  let targets = [];
  try {
    targets = await monitor.paidTargets();
  } catch (err) {
    if (console && console.error) console.error('monitor: targets query failed:', err.message);
    return res.status(503).json({ error: { code: 'targets_unavailable' }, tickSchedule: schedule });
  }

  const due = await monitor.claimDue(targets, MAX_SCANS_PER_RUN);
  const blacklist = due.length ? await monitor.loadBlacklist() : new Set();
  const results = [];
  for (const t of due) {
    results.push(await monitor.dailyCheck(t, { blacklist: blacklist, scanSite: scanSite, saveJob: saveJob }));
  }

  return res.status(200).json({
    ok: true, via: auth.via, tickSchedule: schedule,
    targets: targets.length, scanned: results.length, results: results,
    logsPurgedBefore: purgedBefore, ranAt: new Date().toISOString()
  });
};
