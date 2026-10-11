'use strict';

/**
 * AI raporunun PDF'ini üretip Supabase Storage'a koyar (WORKFLOW 3).
 *
 *   POST /api/cron/ai-report-pdf?jobId=<uuid>   (QStash imzası)
 *   GET  /api/cron/ai-report-pdf?jobId=<uuid>   (Vercel Cron / n8n, Bearer CRON_SECRET)
 *
 * NEDEN BU UÇ VAR: n8n WORKFLOW 3 bugün `/api/report?jobId=` çağırıyor ve o
 * uç OTURUM istiyor — cron sırrını kabul etmediği için akış 401 ile düşüyor
 * (bkz. n8n/README.md "bilinen boşluklar"). Düzeltme, `/api/report`'a bir
 * makine yolu açmak DEĞİL (bu, bir kimlik doğrulama atlatması olurdu ve aynı
 * gerekçeyle `/api/ai-report` için de reddedilmişti): deponun zaten kullandığı
 * `_lib/cronauth.js` ile yetkilenen ayrı bir uç.
 *
 * Uç MÜŞTERİ VERİSİ DÖNDÜRMÜYOR: alan adı, özet, bulgu ya da puan gövdede
 * yok; yalnızca kova yolu ve bayt sayısı dönüyor. PDF gizli kovaya yazılıyor,
 * oradan da yalnızca işin sahibi (oturumla ya da imzalı adresle) indiriyor.
 *
 * `jobId` ZORUNLU. Toplu kip bilerek yok: hangi işin PDF'i var bilgisini
 * tutan bir sütun olmadığı için toplu koşu her gün tüm kovayı yeniden
 * yazardı. WORKFLOW 2 zaten jobId'yi elinde taşıyor.
 */

const cronauth = require('../_lib/cronauth.js');
const db = require('../_lib/db.js');
const storage = require('../_lib/storage.js');
const tg = require('../_lib/telegram.js');
const { buildAiReport, aiReportStorageKey } = require('../_lib/report-ai.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Storage'a konan kopya TÜRKÇE. Lambda'nın ürettiği OWASP PDF'i de Türkçe
   (bkz. aws/lambda-scanner); iki kopyanın dili ayrışmıyor. Dil duyarlı
   indirme oturum açık kullanıcının yolu. */
const LANG = 'tr';

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const yetki = cronauth.authorize(req);
  if (!yetki.ok) return res.status(yetki.status).json({ error: { code: yetki.code } });

  const jobId = String((req.query && req.query.jobId) || '').trim();
  if (!UUID_RE.test(jobId)) return res.status(400).json({ error: { code: 'bad_job_id' } });

  if (!db.isConfigured()) return res.status(503).json({ error: { code: 'db_unavailable' } });
  if (!storage.isConfigured()) return res.status(503).json({ error: { code: 'storage_unavailable' } });

  let rapor;
  try {
    rapor = await db.aiReportOf(jobId);
  } catch (err) {
    if (console && console.error) console.error('ai pdf: report query failed:', err.message);
    return res.status(503).json({ error: { code: 'report_unavailable' } });
  }
  /* Rapor yoksa bu bir hata değil, sıra meselesi: WORKFLOW 2 henüz üretmemiş.
     404, n8n'in yeniden denemesi için yeterince açık. */
  if (!rapor) return res.status(404).json({ error: { code: 'no_ai_report' } });

  let pdf;
  try {
    pdf = buildAiReport(rapor, LANG);
  } catch (err) {
    if (console && console.error) console.error('ai pdf: build failed:', err.message);
    return res.status(500).json({ error: { code: 'pdf_build_failed' } });
  }

  const key = aiReportStorageKey(jobId);
  let sonuc;
  try {
    sonuc = await storage.upload(key, pdf, 'application/pdf');
  } catch (err) {
    const kod = /^storage_/.test(err.message) ? err.message : 'storage_failed';
    if (console && console.error) console.error('ai pdf: upload failed:', kod);
    try {
      await tg.sendTelegram(tg.mesaj.hata('/api/cron/ai-report-pdf', 502, kod), { type: 'alert' });
    } catch (e) { /* bildirim ucu kırmaz */ }
    tg.bildirimIsaretle(res);
    return res.status(502).json({ error: { code: kod } });
  }

  return res.status(200).json({
    ok: true, via: yetki.via, bucket: storage.BUCKET, key: sonuc.key, bytes: sonuc.bytes
  });
}

module.exports = tg.ucuSar(handler, '/api/cron/ai-report-pdf');
