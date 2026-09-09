'use strict';

/**
 * POST /api/auth/logout
 *
 * Oturumu Supabase tarafında da sonlandırır (yenileme token'ı iptal edilir),
 * ardından çerezleri siler. Sunucu tarafı başarısız olsa bile çerezler
 * temizlenir: kullanıcı "çıkış yaptım" dediğinde tarayıcıda token kalmamalı.
 *
 * Anonim `cl_sid` çerezine dokunulmaz: kullanıcı çıkış yapınca kendi anonim
 * geçmişine ve kota sayacına döner.
 */

const auth = require('../_lib/auth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const tokens = auth.readTokens(req);
  if (tokens.accessToken && auth.isConfigured()) {
    try { await auth.logout(tokens.accessToken); } catch (e) { /* yine de çıkış */ }
  }

  auth.clearSessionCookies(res);
  return res.status(200).json({ ok: true });
};
