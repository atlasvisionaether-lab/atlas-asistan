'use strict';

/**
 * Giden kanal mesajı — veritabanı tetikleyicisi (on_message_outbound, 0020) çağırır.
 *
 *   POST /api/atlas-channel-send  { message_id }   X-Atlas-Secret: <paylaşılan gizli değer>
 *     → 200 { sent | skipped | failed } | 401 | 400
 *
 * Gizli değer veritabanında üretilir ve atlas_check_send_secret() ile doğrulanır
 * (Vercel ortamına kopyalanmaz). Mesaj "gönderiliyor" diye ATOMİK alınır
 * (delivery_status null → sending): tetikleyici iki kez çalışsa da mesaj bir
 * kez gider. Sonuç messages.delivery_status / delivery_error'a yazılır.
 * Mesaj metni ve alıcı LOGLANMAZ.
 */

const db = require('../cyberlionai/api/_lib/db.js');
const tg = require('../cyberlionai/api/_lib/telegram.js');
const { adapterFor } = require('./_atlas/channels/adapter.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : '');
  try { return raw ? JSON.parse(raw) || {} : {}; } catch (e) { return {}; }
}

function mark(id, fields) {
  return db.request('messages?id=eq.' + id, { method: 'PATCH', body: fields });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }

  const secret = String((req.headers || {})['x-atlas-secret'] || '');
  const ok = secret.length >= 32 && await db.request('rpc/atlas_check_send_secret', { method: 'POST', body: { p_secret: secret } });
  if (ok !== true) return res.status(401).json({ error: { code: 'secret' } });

  const id = String(jsonBody(req).message_id || '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: { code: 'message_id' } });

  const claimed = await db.request('messages?id=eq.' + id + '&delivery_status=is.null&is_from_customer=eq.false', {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { delivery_status: 'sending' }
  });
  const msg = Array.isArray(claimed) ? claimed[0] : null;
  if (!msg) return res.status(200).json({ skipped: 'already_handled' });

  const adapter = adapterFor(msg.channel);
  const custRows = await db.request('customers?id=eq.' + msg.customer_id + '&select=external_id,external_channel&limit=1');
  const cust = Array.isArray(custRows) ? custRows[0] : null;
  if (!adapter || !cust || !cust.external_id || cust.external_channel !== msg.channel) {
    await mark(id, { delivery_status: 'failed', delivery_error: 'no_recipient' });
    return res.status(200).json({ failed: 'no_recipient' });
  }

  try {
    const r = await adapter.sendMessage(msg.organization_id, cust.external_id, String(msg.content || ''));
    await mark(id, { delivery_status: 'sent', delivered_at: new Date().toISOString(), delivery_error: null });
    return res.status(200).json({ sent: true, id: r && r.id ? r.id : null });
  } catch (e) {
    const code = String((e && e.code) || 'send_failed').slice(0, 80);
    console.warn('atlas-channel-send: ' + code + ' (' + msg.channel + ')');
    await mark(id, { delivery_status: 'failed', delivery_error: code });
    return res.status(200).json({ failed: code });
  }
}

module.exports = tg.ucuSar(handler, '/api/atlas-channel-send');
