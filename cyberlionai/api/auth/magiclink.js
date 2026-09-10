'use strict';

/**
 * POST /api/auth/magiclink  →  { email }
 *
 * Şifresiz giriş bağlantısı gönderir. Ana akış e-posta + şifre; bu yalnızca
 * ek bir kolaylık. `create_user: false` ile çağrılır, yani bu uçtan yeni hesap
 * açılamaz — kayıt akışı tek yerde kalır.
 *
 * Yanıt, recover'da olduğu gibi e-postanın varlığını sızdırmaz.
 */

const auth = require('../_lib/auth.js');
const { guard } = require('../_lib/authguard.js');

module.exports = async function handler(req, res) {
  const g = await guard(req, res, { bucket: 'magiclink', max: 5, windowSeconds: 60 * 60 });
  if (!g.ok) return;

  const email = String(g.body.email || '').trim().toLowerCase();
  if (!auth.validEmail(email)) {
    return res.status(400).json({ error: { code: 'invalid_email' } });
  }

  try {
    await auth.signInMagicLink(email, auth.siteUrl() + '/');
  } catch (err) {
    if (console && console.error) console.error('magiclink failed:', err.message);
  }

  return res.status(200).json({ ok: true });
};
