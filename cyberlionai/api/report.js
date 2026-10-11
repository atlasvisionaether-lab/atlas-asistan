'use strict';

/**
 * PDF güvenlik raporu — iki kaynaktan.
 *
 *   GET /api/report?id=<uuid>&lang=tr|en      → eski `cl_scans` kaydı,
 *                                               kontrol listesi biçiminde
 *   GET  /api/report?jobId=<uuid>&lang=tr|en  → `scan_jobs` kaydı, OWASP
 *                                               kategorilerine göre gruplu
 *   POST /api/report  { jobId, lang }         → aynı OWASP raporu
 *
 * NEDEN HEM GET HEM POST
 *
 * POST istendi ve destekleniyor. Panodaki bağlantı yine GET kullanıyor: bir
 * tarayıcı POST yanıtını kendiliğinden dosya olarak indiremez (ya form
 * göndermek ya da yanıtı belleğe alıp Blob URL üretmek gerekir; ikincisi
 * CSP'de `blob:` açmak demek). Uç hiçbir şeyi DEĞİŞTİRMEDİĞİ, yalnızca
 * okuduğu için GET semantiği de doğrudur. İkisi aynı kodu çağırıyor, yani
 * ikisinden biri eskiyip diğerinden ayrışamaz.
 *
 * Erişim kontrolü zorunlu: rapor yalnızca **isteği yapan oturuma/hesaba ait**
 * bir kayıttan üretilir. Sahiplik filtresi sorgunun içinde olduğu için başka
 * bir oturumun kayıt kimliğini bilmek işe yaramaz. `scan_jobs` kayıtları
 * yalnızca hesaba bağlı olduğu için `jobId` yolu GİRİŞ İSTER.
 *
 * Rapor içeriği yalnızca veritabanındaki kayıttan gelir; istemciden gönderilen
 * skor veya bulgu verisine güvenilmez.
 */

const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const { resolveOwner, ownerRef } = require('./_lib/session.js');
const { buildReport, reportFilename } = require('./_lib/report.js');
const { buildOwaspReport, owaspReportFilename } = require('./_lib/report-owasp.js');

/** PDF'i indirme olarak yazar. */
function sendPdf(res, pdf, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200);
  return res.end(pdf);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!db.isConfigured()) {
    return res.status(503).json({ error: { code: 'report_unavailable' } });
  }

  const query = (req.query && typeof req.query === 'object') ? req.query : {};

  /* POST gövdesi string de gelebiliyor (Content-Type gönderilmediğinde
     Vercel ayrıştırmıyor); iki durum da aynı yerden okunuyor. */
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') body = {};

  const jobId = query.jobId || body.jobId;
  const lang = (query.lang || body.lang) === 'en' ? 'en' : 'tr';

  /* POST yalnızca OWASP raporu için: eski `cl_scans` yolu ana sayfadan GET
     ile çağrılıyor ve POST'u olmasının bir sebebi yok. */
  if (req.method === 'POST' && !jobId) {
    return res.status(400).json({ error: { code: 'missing_job_id' } });
  }

  /* ---- OWASP raporu (scan_jobs) ---- */
  if (jobId) {
    if (!UUID_RE.test(String(jobId))) {
      return res.status(400).json({ error: { code: 'invalid_id' } });
    }
    if (!auth.isConfigured()) {
      return res.status(503).json({ error: { code: 'report_unavailable' } });
    }

    const user = await auth.resolveUser(req, res);
    if (!user) return res.status(401).json({ error: { code: 'auth_required' } });

    let detail;
    try {
      detail = await db.getJobWithFindings(user.id, String(jobId));
    } catch (err) {
      if (console && console.error) console.error('owasp report lookup failed:', err.message);
      return res.status(503).json({ error: { code: 'report_unavailable' } });
    }
    if (!detail) return res.status(404).json({ error: { code: 'not_found' } });

    let owaspPdf;
    try {
      owaspPdf = buildOwaspReport(detail, lang);
    } catch (err) {
      if (console && console.error) console.error('owasp report build failed:', err.message);
      return res.status(500).json({ error: { code: 'report_failed' } });
    }
    return sendPdf(res, owaspPdf, owaspReportFilename(detail.job));
  }

  const id = query.id;
  if (!id || !UUID_RE.test(String(id))) {
    return res.status(400).json({ error: { code: 'invalid_id' } });
  }

  const who = await resolveOwner(req, res);

  // Giriş yapılmamış yeni oturumun hiçbir kaydı olamaz; sorguya gerek yok.
  if (!who.isAuthenticated && who.isNewSession) {
    return res.status(404).json({ error: { code: 'not_found' } });
  }

  let scan;
  try {
    scan = await db.getScan(ownerRef(who), String(id));
  } catch (err) {
    if (console && console.error) console.error('report lookup failed:', err.message);
    return res.status(503).json({ error: { code: 'report_unavailable' } });
  }

  // Kayıt yoksa ya da başka bir oturuma aitse aynı yanıt döner: varlığı sızdırma.
  if (!scan) return res.status(404).json({ error: { code: 'not_found' } });

  let pdf;
  try {
    pdf = buildReport(scan, lang);
  } catch (err) {
    if (console && console.error) console.error('report build failed:', err.message);
    return res.status(500).json({ error: { code: 'report_failed' } });
  }

  return sendPdf(res, pdf, reportFilename(scan));
};
