'use strict';

/**
 * POST /api/auth/login  →  { email, password }
 *
 * Başarılıysa oturum çerezleri yazılır ve bu tarayıcıdaki anonim tarama
 * geçmişi hesaba devredilir.
 *
 * Hata mesajı ayrıştırılmaz: "kullanıcı yok" ile "şifre yanlış" aynı kodu
 * döndürür, böylece uç kayıtlı e-postaları sayan bir araca dönüşmez.
 */

const auth = require('../_lib/auth.js');
const { guard } = require('../_lib/authguard.js');
const { resolveSession } = require('../_lib/session.js');
const { claimForUser } = require('../_lib/claim.js');

module.exports = async function handler(req, res) {
  const g = await guard(req, res, { bucket: 'login', max: 10, windowSeconds: 15 * 60 });
  if (!g.ok) return;

  const email = String(g.body.email || '').trim().toLowerCase();
  const password = g.body.password;

  if (!auth.validEmail(email) || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: { code: 'invalid_credentials' } });
  }

  const anon = resolveSession(req, res);

  let r;
  try {
    r = await auth.signInPassword(email, password);
  } catch (err) {
    return res.status(503).json({ error: { code: 'auth_unavailable' } });
  }

  if (!r.ok || !r.body || !r.body.access_token) {
    const code = auth.mapError(r.status, r.body);
    // Onaylanmamış e-posta ayrı bir durum: kullanıcının ne yapacağını bilmesi
    // gerekiyor ve bu bilgi zaten kayıt sırasında kendisine verilmişti.
    const status = code === 'too_many_requests' ? 429 : 401;
    return res.status(status).json({ error: { code: code } });
  }

  auth.setSessionCookies(res, r.body);

  const user = r.body.user || {};
  const claim = await claimForUser(anon.id, user.id);

  return res.status(200).json({
    ok: true,
    user: { id: user.id, email: user.email || email },
    claimed: claim.claimed
  });
};
