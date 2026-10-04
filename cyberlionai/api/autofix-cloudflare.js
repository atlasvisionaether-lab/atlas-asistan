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
 * Erişim (bkz. _lib/cfaccess.js): oturum zorunlu, token YALNIZCA müşteriden.
 * Eskiden token yoksa sunucudaki CLOUDFLARE_TEST_TOKEN kullanılıyordu ve uç
 * kimlik doğrulamasızdı; o değişken tanımlansa herkes bizim Cloudflare
 * hesabımızla kural ekleyip silebilirdi. Sunucu token'ına düşüş kaldırıldı.
 */

const { cf, findZoneId, applyTransformRule, maskToken } = require('./_lib/cloudflare.js');

/** Rollback: ruleset icinden kurali siler. Token yalnizca bellekte. */
async function cfRuleDelete(zoneId, rulesetId, ruleId, token) {
  return cf('/zones/' + zoneId + '/rulesets/' + rulesetId + '/rules/' + ruleId, 'DELETE', token);
}
const db = require('./_lib/db.js');
const { requireUser, validToken } = require('./_lib/cfaccess.js');

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

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  /* DELETE: rollback — Cloudflare'deki CyberLion kuralını siler (test temizliği). */
  if (req.method === 'DELETE') {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
    const zId = b && typeof b.zoneId === 'string' ? b.zoneId.trim() : null;
    const rsId = b && typeof b.rulesetId === 'string' ? b.rulesetId.trim() : null;
    const rId = b && typeof b.ruleId === 'string' ? b.ruleId.trim() : null;
    const dToken = b && typeof b.token === 'string' ? b.token : null;
    if (!zId || !rsId || !rId) return res.status(400).json({ error: { code: 'missing_ids' } });
    if (!validToken(dToken)) return res.status(400).json({ error: { code: 'token_required' } });
    const del = await cfRuleDelete(zId, rsId, rId, dToken);
    if (!del.ok) return res.status(400).json({ error: { code: del.code } });
    return res.status(200).json({ ok: true, deleted: true, ruleId: rId });
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
  /* Token zorunlu ve yalnızca müşteriden: sunucu token'ına düşüş yok. */
  if (!validToken(token)) {
    return res.status(400).json({ error: { code: token ? 'invalid_token' : 'token_required' } });
  }
  const useToken = token;

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
    rulesetId: applied.rulesetId,
    ruleId: applied.ruleId,
    findingId: findingId,
    tokenMasked: maskToken(),
    rollback: 'Cloudflare Dashboard > Rules > Transform Rules > CyberLion kuralını silin'
  });
};
