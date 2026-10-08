'use strict';

/**
 * AI analist raporu — tarama sonucunun Türkçe anlatımı.
 *
 *   POST /api/ai-report  { jobId }   → { ok, report }
 *   GET  /api/ai-report?jobId=<uuid> → varsa KAYITLI raporu döner, model
 *                                      çağırmaz
 *
 * NEDEN GET MODEL ÇAĞIRMIYOR: üretim para ve saniye harcıyor; GET'in
 * yinelenebilir ve yan etkisiz kalması gerekiyor. Pano raporu GET ile
 * yokluyor, "yok" yanıtı alınca POST ile bir kez üretiyor.
 *
 * GİRİŞ ZORUNLU. `scan_jobs` kayıtları hesaba bağlı; sahiplik filtresi
 * sorgunun İÇİNDE (db.getJob), yani başka bir hesabın iş kimliğini bilmek
 * işe yaramıyor. Rapor yalnızca veritabanındaki tarama kaydından üretiliyor;
 * istemciden gelen skora, alana ya da bulguya güvenilmiyor.
 *
 * GÖSTERİLEN PUAN MODELİN PUANI DEĞİL: müşteriye motorların ölçtüğü
 * `scanner_score` gösteriliyor, modelin `score`'u yalnızca sapmayı görmek
 * için saklanıyor. Bir dil modelinin uydurduğu sayı satılan ölçüm olamaz.
 */

const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const store = require('./_lib/store.js');
const ai = require('./_lib/aianalyst.js');
const tg = require('./_lib/telegram.js');
const { clientIp, ipKey } = require('./_lib/session.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Üretim pahalı: saatte 10 istek, hesap başına değil IP başına — bir hesabın
   belirtecini ele geçiren birinin faturayı şişirmesini de sınırlıyor. */
const RATE_WINDOW_SECONDS = 3600;
const RATE_MAX = 10;

/** İstemciye dönen biçim. `model` ve ham yanıt dışarı verilmiyor. */
function gorunum(r) {
  return {
    risk_level: r.risk_level,
    score: typeof r.scanner_score === 'number' ? r.scanner_score : null,
    ai_score: typeof r.score === 'number' ? r.score : null,
    summary_tr: r.summary_tr,
    findings: Array.isArray(r.findings) ? r.findings : [],
    recommendations: Array.isArray(r.recommendations) ? r.recommendations : [],
    created_at: r.created_at || null
  };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!db.isConfigured() || !auth.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') body = {};
  const query = (req.query && typeof req.query === 'object') ? req.query : {};

  const jobId = String(query.jobId || body.jobId || '');
  if (!UUID_RE.test(jobId)) {
    return res.status(400).json({ error: { code: 'invalid_id' } });
  }

  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });

  /* ---- GET: yalnızca kayıtlı rapor ---- */
  if (req.method === 'GET') {
    let kayitli;
    try {
      kayitli = await db.latestAiReport(user.id, jobId);
    } catch (err) {
      if (console && console.error) console.error('ai report lookup failed:', err.message);
      return res.status(503).json({ error: { code: 'service_unavailable' } });
    }
    if (!kayitli) return res.status(404).json({ error: { code: 'not_found' } });
    return res.status(200).json({ ok: true, report: gorunum(kayitli) });
  }

  /* ---- POST: gerekirse üret ---- */
  if (!ai.isConfigured()) {
    return res.status(503).json({ error: { code: 'ai_unconfigured' } });
  }

  /* Var olan rapor yeniden üretilmiyor: aynı taramaya iki kez ödeme yok. */
  try {
    const kayitli = await db.latestAiReport(user.id, jobId);
    if (kayitli) return res.status(200).json({ ok: true, report: gorunum(kayitli) });
  } catch (err) {
    if (console && console.error) console.error('ai report lookup failed:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (!store.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }
  try {
    const rate = await store.hitRateLimit(
      'cl:rl:ai:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
    if (rate.count > RATE_MAX) {
      const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
    }
  } catch (err) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  let job;
  try {
    job = await db.getJob(user.id, jobId);
  } catch (err) {
    if (console && console.error) console.error('job lookup failed:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }
  if (!job) return res.status(404).json({ error: { code: 'not_found' } });

  /* Tamamlanmamış taramanın anlatılacak sonucu yok. */
  const sonuc = job.result && typeof job.result === 'object' ? job.result : null;
  if (!sonuc) return res.status(409).json({ error: { code: 'scan_not_ready' } });

  const cikti = await ai.analyzeScan(sonuc);
  if (!cikti.ok) {
    /* Model hataları 502: kendi ucumuz ayakta, yukarı akış yanıt vermedi.
       `ucuSar` 500'de uyarı atıyor, bunlar sessiz kalsın diye 502 seçildi;
       gerçekten izlenmesi gereken yetki/kota hataları ayrıca bildiriliyor. */
    if (cikti.code === 'ai_unauthorized' || cikti.code === 'ai_rate_limited') {
      try {
        await tg.sendTelegram(tg.mesaj.hata('/api/ai-report', 502, cikti.code),
          { type: 'alert' });
      } catch (e) { /* bildirim ucu kırmaz */ }
      tg.bildirimIsaretle(res);
    }
    return res.status(502).json({ error: { code: cikti.code } });
  }

  /* Kayıt düşerse rapor yine dönüyor: müşterinin beklediği şey anlatım,
     saklama bizim iç işimiz. */
  try {
    await db.saveAiReport(jobId, cikti.report);
  } catch (err) {
    if (console && console.error) console.error('ai report save failed:', err.message);
  }

  return res.status(200).json({ ok: true, report: gorunum(cikti.report) });
}

module.exports = tg.ucuSar(handler, '/api/ai-report');
