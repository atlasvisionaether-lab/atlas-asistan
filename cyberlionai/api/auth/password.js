'use strict';

/**
 * POST /api/auth/password  →  { password }
 *
 * Giriş yapmış kullanıcının şifresini değiştirir. Şifre sıfırlama akışının
 * son adımı da burasıdır: sıfırlama bağlantısı /api/auth/verify ile geçici bir
 * oturum açar, kullanıcı yeni şifresini bu uçtan yazar.
 *
 * Oturum yoksa 401. Token istemciden gelmez; çerezden okunur.
 */

const auth = require('../_lib/auth.js');
const { guard } = require('../_lib/authguard.js');

module.exports = async function handler(req, res) {
  const g = await guard(req, res, { bucket: 'password', max: 10, windowSeconds: 60 * 60 });
  if (!g.ok) return;

  const password = g.body.password;
  const problem = auth.passwordProblem(password);
  if (problem) {
    return res.status(400).json({ error: { code: problem, min: auth.PASSWORD_MIN } });
  }

  // resolveUser gerekirse token'ı yeniler; süresi dolmuş bir erişim çerezi
  // yüzünden şifre değişikliği başarısız olmasın.
  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'not_authenticated' } });

  let r;
  try {
    // resolveUser'ın döndürdüğü token kullanılır; yenileme olduysa çerezdeki
    // değer artık eskidir.
    r = await auth.updatePassword(user.accessToken, password);
  } catch (err) {
    return res.status(503).json({ error: { code: 'auth_unavailable' } });
  }

  if (!r.ok) {
    return res.status(400).json({ error: { code: auth.mapError(r.status, r.body) } });
  }

  return res.status(200).json({ ok: true });
};
