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
 *
 * TELEGRAM: istek, başarı ve başarısızlık öncelikli hattan bildiriliyor
 * (alan adı, maskeli e-posta, zone kimliği, hata KODU). Token hiçbir
 * mesaja girmez; Cloudflare'in hata metni de değil, yalnız kodu.
 */

const { cf, findZoneId, applyTransformRule, maskToken, FIX_HEADERS } = require('./_lib/cloudflare.js');

/** Rollback: ruleset icinden kurali siler. Token yalnizca bellekte. */
async function cfRuleDelete(zoneId, rulesetId, ruleId, token) {
  return cf('/zones/' + zoneId + '/rulesets/' + rulesetId + '/rules/' + ruleId, 'DELETE', token);
}
const db = require('./_lib/db.js');
const { requireUser, validToken } = require('./_lib/cfaccess.js');
const tg = require('./_lib/telegram.js');
const ownership = require('./_lib/ownership.js');
const levels = require('./_lib/scan-levels.js');
const { clientIp } = require('./_lib/session.js');
const entitlement = require('./_lib/entitlement.js');

/**
 * Zone'un GERÇEK adını Cloudflare'den okur. İstemcinin verdiği zoneId'ye
 * güvenilmiyor: başka bir zone kimliği verip doğrulanmış alan adının
 * kapısından başka bir siteye kural yazdırmak mümkün olmasın.
 */
async function zoneName(zoneId, token) {
  const r = await cf('/zones/' + encodeURIComponent(zoneId), 'GET', token);
  if (!r.ok) return { ok: false, code: r.code, status: r.status };
  const name = r.data && r.data.result && r.data.result.name;
  return name ? { ok: true, name: String(name).toLowerCase() } : { ok: false, code: 'zone_not_found' };
}

/** Alan adı bu zone'un kendisi ya da alt alanı mı. */
function inZone(domain, zone) {
  return domain === zone || domain.slice(-(zone.length + 1)) === '.' + zone;
}

function modificationLog(req, user, domain, verified) {
  return ownership.logScan({
    userId: user.id, ip: clientIp(req), domain: domain, level: 'modification',
    verified: verified, consent: true, userAgent: req.headers && req.headers['user-agent']
  });
}

/** fixType'ın eklediği başlık sayısı ('all' hepsini ekler). */
function headerCount(fixType) {
  return fixType === 'all' ? Object.keys(FIX_HEADERS).length : 1;
}

async function bildirBasarisiz(res, domain, code, perm) {
  tg.bildirimIsaretle(res);
  if (console && console.error) console.error('autofix failed: domain=' + domain + ' code=' + code + (perm ? ' missing=' + perm : ''));
  await tg.sendTelegram(tg.mesaj.autofixBasarisiz(domain, code + (perm ? ' — eksik izin: ' + perm : '')),
    { type: 'alert', priority: true });
}

/**
 * Cloudflare hatasından eksik izni çıkarır. 1-Tık yalnızca iki izin kullanır:
 *   bölgeyi bulmak/okumak   → Zone › Zone › Read
 *   başlık kuralı yazmak    → Zone › Transform Rules › Edit
 * Cloudflare hangi iznin eksik olduğunu söylemiyor; hatanın geldiği AŞAMA
 * söylüyor. 10000/9109/403 = yetki yok, 6003/6111/1000 = belirteç biçimi geçersiz.
 */
const PERM_ZONE_READ = 'Zone › Zone › Read';
const PERM_TRANSFORM = 'Zone › Transform Rules › Edit';
function missingPermission(stage, code, status) {
  const c = String(code || '');
  if (/cf_error_(6003|6111|1000)$/.test(c)) return 'token_invalid';
  const denied = status === 403 || /cf_error_(10000|9109|403)$/.test(c);
  if (stage === 'zone' && (denied || c === 'zone_not_found')) return PERM_ZONE_READ;
  if (stage === 'rule' && denied) return PERM_TRANSFORM;
  return null;
}

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

async function handler(req, res) {
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
    /* Geri alma da bir değişiklik (seviye 3): zone'un adı okunur ve o alan
       adı bu hesap için doğrulanmış olmalı. */
    const zn = await zoneName(zId, dToken);
    if (!zn.ok) return res.status(zn.code === 'cf_unreachable' ? 502 : 400).json({ error: { code: zn.code } });
    const dVerified = await ownership.isVerified(user.id, zn.name);
    await modificationLog(req, user, zn.name, dVerified);
    if (!dVerified) return res.status(403).json(levels.ownershipRequired(zn.name));
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

  /* Model A (Cloudflare 1-Tık) Enterprise planına dahil. Diğer planlar
     "Nasıl düzeltirim?" kodunu ya da "Biz düzeltelim" hizmetini kullanır. */
  const plan = await entitlement.planFor({ userId: user.id });
  if (plan !== 'enterprise') {
    return res.status(402).json({ error: { code: 'plan_required', plan: 'enterprise' } });
  }

  /* Seviye 3: alan adı bu hesap için DOĞRULANMIŞ olmalı. Token'ın bir zone'a
     erişebilmesi sahiplik kanıtı değil (çalıntı ya da paylaşılmış olabilir). */
  const verified = await ownership.isVerified(user.id, domain);
  await modificationLog(req, user, domain, verified);
  if (!verified) {
    await tg.sendTelegram(tg.mesaj.autofixBasarisiz(domain, 'ownership_required'), { type: 'autofix' });
    return res.status(403).json(levels.ownershipRequired(domain, body && body.lang));
  }

  await tg.sendTelegram(tg.mesaj.autofixIstendi(domain, user.email, zoneId || 'auto', fixType),
    { type: 'autofix', priority: true });

  /* Zone çözümü. */
  let zone = zoneId;
  if (zone) {
    const zn = await zoneName(zone, useToken);
    if (!zn.ok) {
      const perm = missingPermission('zone', zn.code, zn.status);
      await bildirBasarisiz(res, domain, zn.code, perm);
      return res.status(zn.code === 'cf_unreachable' ? 502 : 400).json({ error: { code: zn.code, missingPermission: perm } });
    }
    if (!inZone(domain, zn.name)) {
      await bildirBasarisiz(res, domain, 'zone_mismatch');
      return res.status(403).json({ error: { code: 'zone_mismatch' } });
    }
  } else {
    const found = await findZoneId(domain, useToken);
    if (!found.ok) {
      const status = found.code === 'zone_not_found' ? 404 : (found.code === 'cf_unreachable' ? 502 : 401);
      const perm = missingPermission('zone', found.code, found.status);
      await bildirBasarisiz(res, domain, found.code, perm);
      return res.status(status).json({ error: { code: found.code, missingPermission: perm } });
    }
    zone = found.zoneId;
  }

  /* Transform Rule uygula. */
  const applied = await applyTransformRule(zone, useToken, fixType);
  if (!applied.ok) {
    // Kullanıcı hatası: 400. DB'ye failed yazmıyoruz (token hatalı olabilir, iz bırakma).
    const perm = missingPermission('rule', applied.code, applied.status);
    await bildirBasarisiz(res, domain, applied.code, perm);
    return res.status(400).json({ error: { code: applied.code, missingPermission: perm } });
  }

  /* Başarı: scan_findings'e bilgi kaydı (token'sız). */
  const findingId = await recordAppliedFix(domain, fixType, applied.ruleId);

  await tg.sendTelegram(tg.mesaj.autofixTamam(domain, fixType, headerCount(fixType)),
    { type: 'autofix', priority: true });

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
}

/* 500/502/504 ya da fırlatan bir hata kritik uyarı üretir (bkz. telegram.js). */
module.exports = tg.ucuSar(handler, '/api/autofix-cloudflare');
module.exports.inZone = inZone;
module.exports.missingPermission = missingPermission;
