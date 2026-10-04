'use strict';

/**
 * 5 dakikalık izleme tetikleyicisi (QStash zamanlayıcısı; bkz. monitor.ensureTickSchedule).
 *
 *   POST /api/cron/tick   QStash (imzalı)    GET  Vercel Cron sırrıyla (elle deneme)
 *
 *   1. Enterprise alan adlarına erişilebilirlik yoklaması (paralel, sınırlı).
 *   2. Bugün taranmamış Pro/Enterprise alan adlarından en çok 2'sini tarar.
 */

const db = require('../_lib/db.js');
const cronauth = require('../_lib/cronauth.js');
const monitor = require('../_lib/monitor.js');
const { scanSite, SCANNER_VERSION, REPORT_VERSION } = require('../_lib/scanner.js');

const MAX_SCANS_PER_TICK = 2;
const UPTIME_PARALLEL = 10;

function saveJob(scan, target) {
  return db.saveOwaspJob(scan, { userId: target.userId, ip: null },
    { scanner: SCANNER_VERSION, report: REPORT_VERSION }, false);
}

async function inBatches(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push.apply(out, await Promise.all(list.slice(i, i + size).map(fn)));
  }
  return out;
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

  let targets;
  try {
    targets = await monitor.paidTargets();
  } catch (err) {
    if (console && console.error) console.error('tick: targets query failed:', err.message);
    return res.status(503).json({ error: { code: 'targets_unavailable' } });
  }

  const enterprise = targets.filter(function (t) { return t.plan === 'enterprise'; });
  const uptime = await inBatches(enterprise, UPTIME_PARALLEL, function (t) {
    return monitor.uptimeCheck(t).catch(function () { return { domain: t.domain, up: null }; });
  });

  const due = await monitor.claimDue(targets, MAX_SCANS_PER_TICK);
  const blacklist = due.length ? await monitor.loadBlacklist() : new Set();
  const scans = [];
  for (const t of due) {
    scans.push(await monitor.dailyCheck(t, { blacklist: blacklist, scanSite: scanSite, saveJob: saveJob }));
  }

  return res.status(200).json({
    ok: true, via: auth.via, targets: targets.length,
    uptime: uptime.length, down: uptime.filter(function (u) { return u.up === false; }).length,
    scanned: scans.length, scans: scans, ranAt: new Date().toISOString()
  });
};
