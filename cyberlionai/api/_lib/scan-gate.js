'use strict';

/**
 * Tarama kapısı: /api/scan ve /api/enqueue-scan'in ORTAK hukuki denetimi.
 * İki uçta ayrı dursaydı biri düzeltilip öteki unutulurdu (queuestart.js ile
 * aynı gerekçe).
 *
 * Sıra (kotadan ÖNCE çağrılır; reddedilen istek hak harcamasın):
 *   1. Hedef ana bilgisayarı çıkar (geçersizse kapı karışmaz, uç 400 verir).
 *   2. Hesap varsa doğrulama durumunu oku. Anonim → doğrulanmamış.
 *   3. Açıkça seviye 2+ istendi ve doğrulanmamış → 403 ownership_required.
 *   4. Doğrulanmamış alan adına aynı IP'den günde en çok 3 tarama → 429.
 *   5. Fiilen uygulanacak seviyeyi günlüğe yaz.
 *
 * Onay kutusu işaretli ama alan adı doğrulanmamışsa tarama REDDEDİLMEZ:
 * pasif seviyede çalışır, aktif kontroller "doğrulama gerekiyor" notuyla
 * atlanır. Ret yalnızca açıkça aktif seviye istendiğinde.
 */

const { normalizeTarget } = require('./guard.js');
const ownership = require('./ownership.js');
const levels = require('./scan-levels.js');
const store = require('./store.js');
const { clientIp, ipKey } = require('./session.js');

const UNVERIFIED_DAILY_MAX = 3;
const DAY_SECONDS = 86400;

/**
 * @returns {Promise<
 *   {ok: true, host: string|null, verified: boolean, activeConsent: boolean, ownership: object}
 * | {ok: false, status: number, body: object, headers?: object}>}
 */
async function checkScan(req, input) {
  const target = normalizeTarget(input.url);
  if (target.error) {
    return { ok: true, host: null, verified: false, activeConsent: false,
      ownership: { verified: false, activeChecks: false, verifyUrl: null } };
  }
  const host = target.host.toLowerCase();
  const userId = input.owner && input.owner.isAuthenticated ? input.owner.userId : null;
  const verified = userId ? await ownership.isVerified(userId, host) : false;
  const requested = levels.parseLevel(input.level);

  if (requested >= levels.INTRUSIVE && !verified) {
    return { ok: false, status: 403, body: levels.ownershipRequired(host, input.lang) };
  }

  const ip = clientIp(req);
  if (!verified && store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit('cl:rl:unv:' + ipKey(ip) + ':' + host, DAY_SECONDS);
      if (rate.count > UNVERIFIED_DAILY_MAX) {
        const retryAfter = rate.ttl > 0 ? rate.ttl : DAY_SECONDS;
        return {
          ok: false, status: 429, headers: { 'Retry-After': String(retryAfter) },
          body: { error: { code: 'verify_to_continue', retryAfter: retryAfter,
            verifyUrl: levels.verifyUrl(host), limit: UNVERIFIED_DAILY_MAX } }
        };
      }
    } catch (err) { /* sayaç yok: pasif tarama engellenmiyor */ }
  }

  const activeConsent = levels.activeAllowed(input.consent === true, verified);
  await ownership.logScan({
    userId: userId, ip: ip, domain: host,
    level: levels.NAMES[levels.effectiveLevel(input.consent === true, verified)],
    verified: verified, consent: input.consent === true,
    userAgent: req.headers && req.headers['user-agent']
  });

  return {
    ok: true, host: host, verified: verified, activeConsent: activeConsent,
    ownership: {
      verified: verified,
      activeChecks: activeConsent,
      /* Beyan var ama kanıt yok: arayüz "aktif testler için doğrulayın" der. */
      verifyUrl: verified ? null : levels.verifyUrl(host)
    }
  };
}

/** Kapının ret sonucunu yanıta yazar. */
function reject(res, gate) {
  Object.keys(gate.headers || {}).forEach(function (k) { res.setHeader(k, gate.headers[k]); });
  return res.status(gate.status).json(gate.body);
}

module.exports = { checkScan, reject, UNVERIFIED_DAILY_MAX };
