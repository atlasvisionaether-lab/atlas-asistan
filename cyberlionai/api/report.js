'use strict';

/**
 * GET /api/report?id=<uuid>&lang=tr|en  →  PDF güvenlik raporu
 *
 * Erişim kontrolü zorunlu: rapor yalnızca **isteği yapan oturuma ait** bir
 * tarama kaydından üretilir. Sahiplik filtresi sorgunun içinde olduğu için
 * başka bir oturumun kayıt kimliğini bilmek işe yaramaz.
 *
 * Rapor içeriği yalnızca veritabanındaki kayıttan gelir; istemciden gönderilen
 * skor veya bulgu verisine güvenilmez.
 */

const db = require('./_lib/db.js');
const { resolveSession } = require('./_lib/session.js');
const { buildReport, reportFilename } = require('./_lib/report.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!db.isConfigured()) {
    return res.status(503).json({ error: { code: 'report_unavailable' } });
  }

  const query = (req.query && typeof req.query === 'object') ? req.query : {};
  const id = query.id;
  if (!id || !UUID_RE.test(String(id))) {
    return res.status(400).json({ error: { code: 'invalid_id' } });
  }

  const session = resolveSession(req, res);

  // Yeni oturumun hiçbir kaydı olamaz; sorguya gitmeye gerek yok.
  if (session.isNew) return res.status(404).json({ error: { code: 'not_found' } });

  const lang = query.lang === 'en' ? 'en' : 'tr';

  let scan;
  try {
    scan = await db.getScan({ sessionId: session.id }, String(id));
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

  const filename = reportFilename(scan);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200);
  return res.end(pdf);
};
