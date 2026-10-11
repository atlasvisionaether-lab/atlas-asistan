'use strict';

/**
 * GET /api/auth/me
 *
 * Arayüzün açılışta "giriş yapılmış mı" sorusunu sorduğu uç. Token'ı istemci
 * göremediği için durumu yalnızca sunucu söyleyebilir.
 *
 * Kota da burada döner: sayfa açılışında gösterilecek "kalan hak" sayısının
 * kime ait olduğunu (hesap mı, anonim oturum mu) yalnızca sunucu bilir.
 * Tarayıcıdaki sayı sadece bir gösterim; karar hep sunucuda.
 */

const auth = require('../_lib/auth.js');
const store = require('../_lib/store.js');
const { resolveSession } = require('../_lib/session.js');
const entitlement = require('../_lib/entitlement.js');

/** Sayaç okunamazsa kota alanı hiç dönmez; arayüz eski gösterimini korur.
    Sınır plana göre (bkz. _lib/entitlement.js): tarama uçlarıyla aynı politika,
    aynı sayaç anahtarı — gösterilen hak ile uygulanan hak ayrışamaz. */
async function quotaFor(owner) {
  if (!store.isConfigured()) return null;
  try {
    const policy = await entitlement.resolvePolicy(owner, store.quotaKey(owner));
    const scope = owner.userId ? 'account' : 'anonymous';
    if (policy.unlimited) return entitlement.quotaView(policy, null, scope);
    return entitlement.quotaView(policy, await store.readQuota(policy.key), scope);
  } catch (err) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!auth.isConfigured()) {
    return res.status(200).json({ authenticated: false, available: false });
  }

  const user = await auth.resolveUser(req, res);

  if (!user) {
    const anon = resolveSession(req, res);
    // Yeni oturumda sayaç zaten sıfır; gereksiz depo turu yapılmaz.
    const quota = anon.isNew ? null : await quotaFor({ sessionId: anon.id });
    return res.status(200).json({ authenticated: false, available: true, quota: quota });
  }

  return res.status(200).json({
    authenticated: true,
    available: true,
    user: { id: user.id, email: user.email },
    quota: await quotaFor({ userId: user.id })
  });
};
