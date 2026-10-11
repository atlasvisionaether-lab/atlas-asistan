'use strict';

/**
 * Bildirimi bekleyen işler — WORKFLOW 4'ün ilk adımı.
 *
 *   GET  /api/cron/scan-jobs/pending?limit=10   (Bearer CRON_SECRET)
 *   POST aynı yol                               (QStash imzası)
 *   → { ok, via, jobs: [{ jobId }], count }
 *
 * NEDEN BU UÇ VAR: n8n WORKFLOW 4 bugüne kadar `scan_jobs`'u DOĞRUDAN
 * PostgREST'ten, `SUPABASE_SERVICE_KEY` ile okuyordu. Servis rolü anahtarı
 * RLS'i tamamen atlar — yani o anahtar n8n'de durduğu sürece n8n'i ele
 * geçiren biri tüm müşteri verisini okuyabilirdi. Bu uç o okumayı
 * sunucuya alıyor; n8n'de yalnızca `CRON_SECRET` kalıyor ve onun yetkisi
 * bu üç cron ucuyla sınırlı.
 *
 * YANIT YALNIZCA KİMLİK TAŞIYOR: alan adı, puan, e-posta, kullanıcı
 * kimliği YOK. n8n bir iş kimliğini öğreniyor, başka bir şey değil.
 */

const cronauth = require('../../_lib/cronauth.js');
const db = require('../../_lib/db.js');
const tg = require('../../_lib/telegram.js');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const yetki = cronauth.authorize(req);
  if (!yetki.ok) return res.status(yetki.status).json({ error: { code: yetki.code } });

  if (!db.isConfigured()) return res.status(503).json({ error: { code: 'db_unavailable' } });

  const istenen = Number((req.query && req.query.limit) || DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, isNaN(istenen) ? DEFAULT_LIMIT : istenen));

  let isler;
  try {
    isler = await db.jobsPendingNotify(limit);
  } catch (err) {
    if (console && console.error) console.error('pending: query failed:', err.message);
    return res.status(503).json({ error: { code: 'jobs_unavailable' } });
  }

  /* Satırın TAMAMI dönmüyor; yalnızca kimlik eşleniyor. Sorgu ileride bir
     sütun daha seçerse o sütun buradan sızmaz. */
  return res.status(200).json({
    ok: true,
    via: yetki.via,
    count: isler.length,
    jobs: isler.map(function (j) { return { jobId: j.id }; })
  });
}

module.exports = tg.ucuSar(handler, '/api/cron/scan-jobs/pending');
