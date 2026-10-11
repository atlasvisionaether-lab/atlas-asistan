'use strict';

/**
 * /api/verify/* uçlarının ortak girişi: yöntem, oturum, gövde, alan adı.
 * Doğrulama bir HESABA ait: anonim oturumla başlatılamaz.
 */

const auth = require('../_lib/auth.js');
const db = require('../_lib/db.js');
const ownership = require('../_lib/ownership.js');

function bodyOf(req) {
  const b = req && req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) { try { return JSON.parse(b); } catch (e) { return null; } }
  return null;
}

/**
 * @returns {Promise<{user: object, body: object, domain: string|null} | null>}
 *   null ise yanıt zaten yazıldı.
 */
async function prepare(req, res, method, needDomain) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== method) {
    res.setHeader('Allow', method);
    res.status(405).json({ error: { code: 'method_not_allowed' } });
    return null;
  }
  if (!db.isConfigured() || !auth.isConfigured()) {
    res.status(503).json({ error: { code: 'service_unavailable' } });
    return null;
  }
  const user = await auth.resolveUser(req, res);
  if (!user || !user.id) {
    res.status(401).json({ error: { code: 'auth_required' } });
    return null;
  }
  const body = bodyOf(req) || {};
  let domain = null;
  if (needDomain) {
    domain = ownership.normalizeDomain(body.domain || (req.query && req.query.domain));
    if (!domain) {
      res.status(400).json({ error: { code: 'invalid_domain' } });
      return null;
    }
  }
  return { user: user, body: body, domain: domain };
}

module.exports = { prepare };
