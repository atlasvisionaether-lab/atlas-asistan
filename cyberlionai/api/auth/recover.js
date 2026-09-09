'use strict';

/**
 * POST /api/auth/recover  →  { email }
 *
 * Şifre sıfırlama e-postası ister.
 *
 * Yanıt her zaman aynı: e-posta kayıtlı olsa da olmasa da `ok: true` döner.
 * Aksi hâlde bu uç, hangi adreslerin sistemde olduğunu sorgulayan bir araca
 * dönüşürdü. Gerçek sonuç yalnızca posta kutusunda görünür.
 */

const auth = require('../_lib/auth.js');
const { guard } = require('../_lib/authguard.js');

module.exports = async function handler(req, res) {
  const g = await guard(req, res, { bucket: 'recover', max: 5, windowSeconds: 60 * 60 });
  if (!g.ok) return;

  const email = String(g.body.email || '').trim().toLowerCase();
  if (!auth.validEmail(email)) {
    return res.status(400).json({ error: { code: 'invalid_email' } });
  }

  try {
    await auth.recover(email, auth.siteUrl() + '/');
  } catch (err) {
    // Sunucu hatası da sızdırılmaz; kullanıcı e-postayı beklemeyi sürdürür.
    if (console && console.error) console.error('recover failed:', err.message);
  }

  return res.status(200).json({ ok: true });
};
