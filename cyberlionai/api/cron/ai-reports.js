'use strict';

/**
 * Zamanlanmış AI rapor üretimi.
 *
 *   POST /api/cron/ai-reports   (QStash imzası)
 *   GET  /api/cron/ai-reports   (Vercel Cron, Bearer CRON_SECRET)
 *
 * NEDEN BU UÇ VAR: n8n WORKFLOW 2 ve haftalık tarama akışı, bir kullanıcı
 * oturumu taşımadan rapor üretmek istiyor. /api/ai-report'un makine yolu
 * YOK — bir kimlik doğrulama atlatma yolu açmak yerine deponun zaten
 * kullandığı `_lib/cronauth.js` kullanılıyor: fail-closed, iki imza
 * yöntemi, sır loglanmıyor.
 *
 * Uç müşteri verisi DÖNDÜRMÜYOR: yalnızca kaç rapor üretildiğini ve hata
 * kodlarını döndürüyor. Bu yüzden sahiplik filtresinin olmaması veri
 * sızdırmıyor — üretilen rapor veritabanına yazılıyor, oradan da yalnızca
 * işin sahibi okuyabiliyor (RLS + /api/ai-report).
 */

const cronauth = require('../_lib/cronauth.js');
const db = require('../_lib/db.js');
const ai = require('../_lib/aianalyst.js');
const tg = require('../_lib/telegram.js');

/* Bir koşuda en çok bu kadar rapor. Vercel'in işlev süresi ve NVIDIA kotası
   ikisi de sınırlı; kalanlar bir sonraki koşuda üretiliyor. */
const MAX_PER_RUN = 5;

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const yetki = cronauth.authorize(req);
  if (!yetki.ok) return res.status(yetki.status).json({ error: { code: yetki.code } });

  if (!db.isConfigured()) return res.status(503).json({ error: { code: 'db_unavailable' } });
  if (!ai.isConfigured()) return res.status(503).json({ error: { code: 'ai_unconfigured' } });

  let isler = [];
  try {
    isler = await db.jobsMissingAiReport(MAX_PER_RUN);
  } catch (err) {
    if (console && console.error) console.error('ai cron: job query failed:', err.message);
    return res.status(503).json({ error: { code: 'jobs_unavailable' } });
  }

  let uretilen = 0;
  const kodlar = {};
  for (const is of isler) {
    const cikti = await ai.analyzeScan(is.result);
    if (!cikti.ok) {
      kodlar[cikti.code] = (kodlar[cikti.code] || 0) + 1;
      /* Yetki ve kota hataları koşunun TAMAMINI boşa çıkarır: ilkinde dur,
         sırayla 5 kez aynı 401'i almanın bir faydası yok. */
      if (cikti.code === 'ai_unauthorized' || cikti.code === 'ai_rate_limited') break;
      continue;
    }
    try {
      await db.saveAiReport(is.id, cikti.report);
      uretilen += 1;
    } catch (err) {
      kodlar.save_failed = (kodlar.save_failed || 0) + 1;
      if (console && console.error) console.error('ai cron: save failed:', err.message);
    }
  }

  if (kodlar.ai_unauthorized || kodlar.ai_rate_limited) {
    try {
      await tg.sendTelegram(tg.mesaj.hata('/api/cron/ai-reports', 200,
        kodlar.ai_unauthorized ? 'ai_unauthorized' : 'ai_rate_limited'), { type: 'alert' });
    } catch (e) { /* bildirim ucu kırmaz */ }
    tg.bildirimIsaretle(res);
  }

  return res.status(200).json({
    ok: true, via: yetki.via, candidates: isler.length, generated: uretilen, errors: kodlar
  });
}

module.exports = tg.ucuSar(handler, '/api/cron/ai-reports');
