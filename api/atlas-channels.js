'use strict';

/**
 * Panel ↔ kanal bağlantıları (Kanallar ekranı).
 *
 *   GET  /api/atlas-channels                                  → { channels[], ready }
 *   POST /api/atlas-channels { action:'connect', channel, credentials } → ConnectResult (+ channel görünümü)
 *   POST /api/atlas-channels { action:'disconnect', channel }           → { success }
 *   POST /api/atlas-channels { action:'embeddedSignup', channel:'whatsapp', code, wabaId, phoneNumberId, coexistence }
 *        → tek tıkla bağla (Embedded Signup v4; bkz. _atlas/channels/whatsapp.js connectEmbedded)
 *
 * Oturum ZORUNLU (Bearer Supabase jetonu, _atlas/panel.js); CORS panel origin'i.
 * Listeyi her üye görür; bağlama/kesme ve Meta webhook değerleri yalnız
 * owner/manager. Kurum, jetonun kurumudur — istekten ALINMAZ.
 * Kimlik bilgileri (jetonlar) LOGLANMAZ ve cevaba geri DÖNMEZ.
 */

const tg = require('../cyberlionai/api/_lib/telegram.js');
const panel = require('./_atlas/panel.js');
const store = require('./_atlas/channels/store.js');
const secrets = require('./_atlas/channels/secrets.js');
const meta = require('./_atlas/channels/meta.js');
const { TYPES, adapterFor } = require('./_atlas/channels/adapter.js');

function jsonBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : '');
  try { return raw ? JSON.parse(raw) || {} : {}; } catch (e) { return {}; }
}

async function views(orgId, canManage) {
  const rows = await store.listByOrg(orgId);
  return TYPES.map(function (t) {
    const row = rows.find(function (r) { return r.channel === t; });
    return row ? store.publicView(row, canManage) : { channel: t, status: 'disconnected' };
  });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  panel.cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const member = await panel.memberFromRequest(req);
  if (!member) return res.status(401).json({ error: { code: 'auth' } });
  const canManage = panel.canPay(member);

  if (req.method === 'GET') {
    const es = meta.embeddedConfig();
    return res.status(200).json({
      channels: await views(member.orgId, canManage), canManage: canManage, ready: secrets.isConfigured(),
      /* Tek tıkla bağla: yalnız herkese açık değerler (App Secret ASLA). */
      embedded: es && canManage ? { whatsapp: es } : null
    });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.status(405).end(); }
  if (!canManage) return res.status(403).json({ error: { code: 'role' } });

  const body = jsonBody(req);
  const adapter = adapterFor(String(body.channel || ''));
  if (!adapter) return res.status(400).json({ error: { code: 'channel' } });

  if (body.action === 'disconnect') {
    await adapter.disconnect(member.orgId);
    return res.status(200).json({ success: true });
  }
  if (body.action === 'embeddedSignup') {
    if (adapter.type !== 'whatsapp') return res.status(400).json({ error: { code: 'channel' } });
    const r = await adapter.connectEmbedded(member.orgId, {
      code: body.code, wabaId: body.wabaId, phoneNumberId: body.phoneNumberId, coexistence: body.coexistence === true
    });
    if (!r.success) console.warn('atlas-channels: embedded_failed (' + r.error + ')');
    const row = await store.byOrg(member.orgId, 'whatsapp');
    return res.status(r.success ? 200 : 400).json(Object.assign({}, r, { channel: row ? store.publicView(row, true) : null }));
  }
  if (body.action !== 'connect') return res.status(400).json({ error: { code: 'action' } });

  const creds = body.credentials && typeof body.credentials === 'object' ? body.credentials : {};
  const result = await adapter.connect(member.orgId, creds);
  if (!result.success) console.warn('atlas-channels: connect_failed ' + adapter.type + ' (' + result.error + ')');
  const row = await store.byOrg(member.orgId, adapter.type);
  return res.status(result.success ? 200 : 400).json(Object.assign({}, result, { channel: row ? store.publicView(row, true) : null }));
}

module.exports = tg.ucuSar(handler, '/api/atlas-channels');
