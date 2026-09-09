'use strict';

/**
 * POST /api/auth/register  →  { email, password }
 *
 * E-posta onayı Supabase'de açıksa oturum açılmaz; kullanıcıya onay e-postası
 * gider ve `needsConfirmation: true` döner. Kapalıysa oturum çerezleri hemen
 * yazılır ve anonim geçmiş hesaba devredilir.
 */

const auth = require('../_lib/auth.js');
const { guard } = require('../_lib/authguard.js');
const { resolveSession } = require('../_lib/session.js');
const { claimForUser } = require('../_lib/claim.js');

module.exports = async function handler(req, res) {
  const g = await guard(req, res, { bucket: 'register', max: 5, windowSeconds: 60 * 60 });
  if (!g.ok) return;

  const email = String(g.body.email || '').trim().toLowerCase();
  const password = g.body.password;

  if (!auth.validEmail(email)) {
    return res.status(400).json({ error: { code: 'invalid_email' } });
  }
  const pwProblem = auth.passwordProblem(password);
  if (pwProblem) {
    return res.status(400).json({ error: { code: pwProblem, min: auth.PASSWORD_MIN } });
  }

  // Anonim oturum, devir için kayıttan ÖNCE okunur: çerez yoksa burada
  // üretilir ve kullanıcı zaten yeni olduğu için devredilecek kayıt olmaz.
  const anon = resolveSession(req, res);

  let r;
  try {
    r = await auth.signUp(email, password, auth.siteUrl() + '/');
  } catch (err) {
    return res.status(503).json({ error: { code: 'auth_unavailable' } });
  }

  if (!r.ok) {
    return res.status(400).json({ error: { code: auth.mapError(r.status, r.body) } });
  }

  // Oturum döndüyse e-posta onayı kapalı demektir: doğrudan giriş yapılır.
  if (r.body && r.body.access_token) {
    auth.setSessionCookies(res, r.body);
    const user = r.body.user || {};
    const claim = await claimForUser(anon.id, user.id);
    return res.status(200).json({
      ok: true,
      needsConfirmation: false,
      user: { id: user.id, email: user.email || email },
      claimed: claim.claimed
    });
  }

  // Onay bekleniyor. Devir, kullanıcı onaydan sonra giriş yaptığında yapılır.
  return res.status(200).json({ ok: true, needsConfirmation: true, email: email });
};
