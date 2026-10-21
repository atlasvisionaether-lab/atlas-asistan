'use strict';

/**
 * Asistan hafızası tercihi.
 *
 *   GET /api/user/memory
 *     → { authenticated, remember: true|false|null, hasMemory, greeting }
 *        greeting: 'returning'  — hafıza açık ve kayıtlı konuşma var
 *                  'first_time' — giriş yapmış ama hakkında kayıt yok
 *                                 (yeni kullanıcı ya da verisini silmiş biri;
 *                                 ikisi bilerek AYIRT EDİLEMEZ)
 *                  null         — giriş yok (anonim ziyaretçiye kalıcı hafıza yok)
 *   PUT /api/user/memory  { remember: boolean }
 *     → { remember, deleted }   remember=false kayıtlı konuşmaları da siler
 *
 * Kimlik gövdeden değil, oturum çerezinden gelir. Çerezler SameSite=Lax ve
 * gövde JSON olduğu için başka bir site bu ucu kullanıcı adına çağıramaz
 * (Lax çerez siteler arası PUT'ta gitmez; JSON gövde ön kontrol ister).
 */

const auth = require('../_lib/auth.js');
const memory = require('../_lib/memory.js');

function bodyOf(req) {
  const b = req && req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) { try { return JSON.parse(b); } catch (e) { return null; } }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  if (!memory.isConfigured() || !auth.isConfigured()) {
    return res.status(503).json({ error: { code: 'memory_unavailable' } });
  }

  const user = await auth.resolveUser(req, res);

  if (req.method === 'GET') {
    if (!user) {
      return res.status(200).json({ authenticated: false, remember: null, hasMemory: false, greeting: null });
    }
    try {
      const remember = await memory.getRemember(user.id);
      const hasMemory = remember === true ? await memory.hasMessages(user.id) : false;
      return res.status(200).json({
        authenticated: true, remember: remember, hasMemory: hasMemory,
        greeting: hasMemory ? 'returning' : 'first_time'
      });
    } catch (err) {
      return res.status(503).json({ error: { code: 'memory_unavailable' } });
    }
  }

  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });
  const body = bodyOf(req);
  if (!body || typeof body.remember !== 'boolean') {
    return res.status(400).json({ error: { code: 'remember_boolean_required' } });
  }
  try {
    const r = await memory.setRemember(user.id, body.remember);
    return res.status(200).json(r);
  } catch (err) {
    if (console && console.error) console.error('memory pref failed:', err.message);
    return res.status(503).json({ error: { code: 'memory_unavailable' } });
  }
};
