'use strict';

/**
 * POST /api/autofix-cloudflare  →  { domain, zoneId?, token, fixType }
 *
 * Cloudflare ile 1-Tık Düzeltme: kullanıcının KENDİ API token'ı ile
 * Transform Rule ekler. "Tam Otomatik Düzeltme" değil — token kullanıcıya
 * aittir ve bizde saklanmaz.
 *
 * Token güvenliği (bkz. _lib/cloudflare.js):
 *   - console.log(token) YOK; hata mesajlarına token türevi girmez.
 *   - DB'ye token yazılmaz; scan_findings evidence'si yalnız
 *     fixType + zone adı içerir.
 *   - Yanıtta token yalnız maskeli döner.
 *
 * Mock mod: CLOUDFLARE_TEST_TOKEN env'i yoksa gerçek Cloudflare çağrısı
 * YAPILMAZ; { mocked: true } döner. Bu, token'sız deployment'ta hem
 * endpoint'in çalıştığını hem de akışın doğru döndüğünü doğrulamak içindir.
 */

const { findZoneId, applyTransformRule, maskToken } = require('./_lib/cloudflare.js');
const db = require('./_lib/db.js');

const FIX_TYPES = ['hsts', 'csp', 'xframe', 'all'];

/**
 * Supabase: autofix için bağımsız bir job kaydı + info bulgusu.
 * job_id FK NOT NULL olduğundan önce job satırı açılır, sonra bulgu.
 * Hiçbir alana token girmez. İstisna durumunda bulgu kaydı atlanır;
 * fix'in kendisi başarılıdır, kayıt yalnızca denetim izidir.
 */
async function recordAppliedFix(domain, fixType, ruleId) {
  if (!db.isConfigured()) return null;
  try {
    const jobId = await db.saveAutofixJob(domain, fixType, ruleId);
    if (!jobId) return null;
    const findingId = await db.saveAutofixFinding(jobId, domain, fixType, ruleId);
    return findingId;
  } catch (err) {
    if (console && console.error) console.error('autofix record failed:', err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  const domain = body && typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  const zoneId = body && typeof body.zoneId === 'string' && body.zoneId ? body.zoneId.trim() : null;
  const token = body && typeof body.token === 'string' ? body.token : null;
  const fixType = body && typeof body.fixType === 'string' ? body.fixType.trim().toLowerCase() : 'hsts';

  if (!domain || !/^[a-z0-9.-]{1,253}\.[a-z]{2,}$/.test(domain)) {
    return res.status(400).json({ error: { code: 'invalid_domain' } });
  }
  if (!FIX_TYPES.includes(fixType)) {
    return res.status(400).json({ error: { code: 'invalid_fix_type' } });
  }
  const envToken = process.env.CLOUDFLARE_TEST_TOKEN;
  const useToken = token || envToken;

  /* Mock mod: token yoksa (env + body boş) gerçek çağrı yapılmaz. */
  if (!useToken || useToken.length < 20) {
    if (token && token.length < 20) {
      return res.status(400).json({ error: { code: 'invalid_token' } });
    }
    return res.status(200).json({
      mocked: true,
      message: 'Cloudflare token sağlanmadı — mock mod. Panelden kendi API token\'ınızı girin.',
      fixType: fixType,
      domain: domain,
      tokenMasked: maskToken()
    });
  }

  /* Zone çözümü. */
  let zone = zoneId;
  if (!zone) {
    const found = await findZoneId(domain, useToken);
    if (!found.ok) {
      const status = found.code === 'zone_not_found' ? 404 : (found.code === 'cf_unreachable' ? 502 : 401);
      return res.status(status).json({ error: { code: found.code } });
    }
    zone = found.zoneId;
  }

  /* Transform Rule uygula. */
  const applied = await applyTransformRule(zone, useToken, fixType);
  if (!applied.ok) {
    // Kullanıcı hatası: 400. DB'ye failed yazmıyoruz (token hatalı olabilir, iz bırakma).
    return res.status(400).json({ error: { code: applied.code } });
  }

  /* Başarı: scan_findings'e bilgi kaydı (token'sız). */
  const findingId = await recordAppliedFix(domain, fixType, applied.ruleId);

  return res.status(200).json({
    ok: true,
    mocked: false,
    fixType: fixType,
    domain: domain,
    zoneId: zone,
    ruleId: applied.ruleId,
    findingId: findingId,
    tokenMasked: maskToken(),
    rollback: 'Cloudflare Dashboard > Rules > Transform Rules > CyberLion kuralını silin'
  });
};
