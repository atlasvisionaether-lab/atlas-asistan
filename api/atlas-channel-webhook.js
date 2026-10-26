'use strict';

/**
 * Kanal webhook'u — Telegram, WhatsApp Cloud API, Instagram (gelen mesajlar).
 *
 *   GET  /api/atlas-channel-webhook?c=<bağlantı>&hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 *        → Meta webhook doğrulaması (düz metin challenge) | 403
 *   POST /api/atlas-channel-webhook?c=<bağlantı>  → 200 { ok, received } | 401 | 404
 *
 * Kurum izolasyonu: bağlantı URL'deki ?c= ile bulunur; kurum kimliği o satırdan
 * gelir, istek gövdesinden ALINMAZ. İmza adaptörde doğrulanır (Telegram:
 * secret_token başlığı; Meta: App Secret ile HMAC, ham gövde). Doğrulanamayan
 * istek 401 — gövdesi işlenmez.
 *
 * Her metin mesajı atlas_channel_inbound() ile BİR KEZ yazılır (kanalın mesaj
 * kimliği); otomatik cevap mevcut on_message_insert tetikleyicisiyle başlar.
 * Veritabanı hatası 500 döner: sağlayıcı olayı yeniden gönderir, tekrar
 * yazılmaz. Mesaj metni LOGLANMAZ.
 */

const db = require('../cyberlionai/api/_lib/db.js');
const tg = require('../cyberlionai/api/_lib/telegram.js');
const store = require('./_atlas/channels/store.js');
const { readRaw } = require('./_atlas/channels/raw.js');
const { adapterFor } = require('./_atlas/channels/adapter.js');

function inbound(m) {
  return db.request('rpc/atlas_channel_inbound', {
    method: 'POST',
    body: {
      p_org: m.clinicId, p_channel: m.channel, p_from: m.from, p_name: m.name || null,
      p_text: m.text.slice(0, 4000), p_external_id: m.externalId || null,
      p_ts: m.timestamp > 0 ? new Date(m.timestamp).toISOString() : null
    }
  });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const query = req.query || {};
  const conn = await store.byId(query.c);
  if (!conn || conn.status === 'disconnected') return res.status(404).json({ error: { code: 'not_found' } });
  const adapter = adapterFor(conn.channel);

  if (req.method === 'GET') {
    if (!adapter.handleVerification) return res.status(405).end();
    const v = await adapter.handleVerification({ method: 'GET', headers: req.headers || {}, query: query, connection: conn });
    if (!v.ok) return res.status(403).json({ error: { code: 'verify_failed' } });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(v.challenge);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  }

  let raw;
  try { raw = await readRaw(req); } catch (e) { return res.status(e.status || 400).json({ error: { code: e.message } }); }
  const wreq = { method: 'POST', headers: req.headers || {}, query: query, raw: raw, connection: conn };
  if (!(await adapter.verifyWebhook(wreq))) {
    console.warn('atlas-channel-webhook: signature_invalid (' + conn.channel + ')');
    return res.status(401).json({ error: { code: 'signature' } });
  }
  /* Henüz doğrulanmamış/hatalı bağlantı: olayı kabul et ama işleme. */
  if (conn.status !== 'connected') return res.status(200).json({ ok: true, received: 0, ignored: conn.status });

  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).json({ error: { code: 'json' } }); }

  const messages = adapter.parseAll(payload, conn);
  let written = 0;
  for (const m of messages) {
    const id = await inbound(m);
    if (id) written += 1;
  }
  return res.status(200).json({ ok: true, received: messages.length, written: written });
}

module.exports = tg.ucuSar(handler, '/api/atlas-channel-webhook');
