'use strict';

/**
 * POST /api/auth/verify  →  { token_hash, type }
 *
 * E-posta bağlantısındaki tek kullanımlık kodu oturuma çevirir. Kayıt onayı,
 * şifre sıfırlama ve magic link aynı uçtan geçer.
 *
 * Neden `token_hash`: Supabase'in varsayılan (implicit) akışında token'lar
 * adres çubuğunda `#access_token=...` olarak taşınır. Orada durdukları sürece
 * geçmişte, kaydedilen bağlantılarda ve yönlendirme zincirinde görünürler.
 * `token_hash` tek kullanımlıktır ve gerçek token hiç tarayıcıya girmeden
 * burada, sunucuda oturuma çevrilir. Bunun için e-posta şablonlarının
 * `{{ .TokenHash }}` kullanması gerekir — README'de anlatıldı.
 */

const auth = require('../_lib/auth.js');
const { guard } = require('../_lib/authguard.js');
const { resolveSession } = require('../_lib/session.js');
const { claimForUser } = require('../_lib/claim.js');

const TYPES = ['signup', 'recovery', 'magiclink', 'email_change', 'invite'];

module.exports = async function handler(req, res) {
  const g = await guard(req, res, { bucket: 'verify', max: 20, windowSeconds: 15 * 60 });
  if (!g.ok) return;

  const tokenHash = String(g.body.token_hash || '').trim();
  const type = String(g.body.type || '').trim();

  if (!tokenHash || tokenHash.length > 512 || TYPES.indexOf(type) === -1) {
    return res.status(400).json({ error: { code: 'link_invalid' } });
  }

  const anon = resolveSession(req, res);

  let r;
  try {
    r = await auth.verifyOtp(type, tokenHash);
  } catch (err) {
    return res.status(503).json({ error: { code: 'auth_unavailable' } });
  }

  if (!r.ok || !r.body || !r.body.access_token) {
    return res.status(400).json({ error: { code: auth.mapError(r.status, r.body) } });
  }

  auth.setSessionCookies(res, r.body);

  const user = r.body.user || {};
  const claim = await claimForUser(anon.id, user.id);

  return res.status(200).json({
    ok: true,
    type: type,
    user: { id: user.id, email: user.email || null },
    claimed: claim.claimed,
    // Sıfırlama akışında arayüz yeni şifre formunu açar.
    needsNewPassword: type === 'recovery'
  });
};
