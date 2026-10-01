'use strict';

/**
 * GET /api/cloudflare-zones  →  { domain } (token header veya query)
 *
 * Kullanıcının Cloudflare zone listesini döndürür (yalnızca name + id).
 *
 * Token güvenliği (bkz. _lib/cloudflare.js):
 *   - Token loglanmaz, DB'ye yazılmaz, yanıta açık girmez.
 *   - Token Authorization başlığından (Bearer) ya da ?token= sorgusundan alınır.
 */

const { cf, maskToken } = require('./_lib/cloudflare.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }


  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  const auth = req.headers && req.headers.authorization || '';
  const headerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const queryToken = (req.query && typeof req.query.token === 'string') ? req.query.token : null;
  const bodyToken = body && typeof body.token === 'string' ? body.token : null;
  /* Body token env'yi override eder; token asla loglanmaz / yazilmaz. */
  const token = bodyToken || headerToken || queryToken || process.env.CLOUDFLARE_TEST_TOKEN;

  if (!token || token.length < 20) {
    return res.status(401).json({ error: { code: 'token_required' } });
  }

  const qDomain = (req.query && typeof req.query.domain === 'string') ? req.query.domain.trim().toLowerCase() : '';
  const domain = (body && typeof body.domain === 'string' && body.domain) ? body.domain.trim().toLowerCase() : qDomain;
  const path = '/zones?per_page=50' + (domain ? '&name=' + encodeURIComponent(domain) : '');

  const r = await cf(path, 'GET', token);
  if (!r.ok) {
    const status = (r.code === 'cf_unreachable') ? 502
      : (typeof r.code === 'string' && /cf_error_9[0-9]{3}/.test(r.code)) ? 401 : 400;
    return res.status(status).json({ error: { code: r.code } });
  }

  const zones = ((r.data && r.data.result) || []).map(function (z) {
    return { id: z.id, name: z.name };
  });

  return res.status(200).json({ zones: zones, tokenMasked: maskToken() });
};
