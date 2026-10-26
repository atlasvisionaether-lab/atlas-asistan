'use strict';

/**
 * Instagram adaptörü (Meta Graph API — Instagram Messaging, Facebook Sayfası üzerinden).
 *
 * Kimlik bilgileri (panel): pageAccessToken (Instagram işletme hesabına bağlı
 * Facebook Sayfasının jetonu), appSecret.
 * connect: GET /me → sayfa + bağlı Instagram işletme hesabı → sayfa uygulamaya
 *   abone edilir (subscribed_fields=messages) → 'pending'; Meta uygulamasında
 *   webhook doğrulanınca 'connected'.
 * İzolasyon: entry.id (Instagram hesap kimliği) bağlantınınkiyle aynı olmalı.
 * Yankı (is_echo: işletmenin kendi gönderdiği) ve metinsiz mesajlar yok sayılır.
 * Gönderim: 1000 karakter sınırı (uzun cevap parçalanır); 24 saat penceresi.
 */

const store = require('./store.js');
const secrets = require('./secrets.js');
const meta = require('./meta.js');
const { MAX_TEXT, chunk, ChannelError } = require('./adapter.js');

function fail(error, message) { return { success: false, status: 'error', error: error, message: message }; }

async function connect(clinicId, credentials) {
  const c = credentials || {};
  const token = String(c.pageAccessToken || '').trim();
  const appSecret = String(c.appSecret || '').trim();
  if (token.length < 50) return fail('access_token', 'Sayfa erişim jetonu çok kısa. Facebook Sayfanızın uzun ömürlü jetonunu yapıştırın.');
  if (!meta.APP_SECRET_RE.test(appSecret)) return fail('app_secret', 'Uygulama gizli anahtarı (App Secret) 32 karakterlik bir değerdir.');
  if (!secrets.isConfigured()) return fail('server_config', 'Sunucu yapılandırması eksik; Atlas ekibine haber verin.');

  const me = await meta.graph('/me?fields=id,name,instagram_business_account{id,username}', token);
  if (!me.ok || !me.data || !me.data.id) return fail(meta.errorCode(me), 'Meta bu jetonu tanımadı. Facebook Sayfası jetonunu kontrol edin.');
  const ig = me.data.instagram_business_account;
  if (!ig || !ig.id) return fail('no_instagram_account', 'Bu Facebook Sayfasına bağlı bir Instagram işletme hesabı yok. Önce Instagram hesabınızı Sayfaya bağlayın.');

  const sub = await meta.graph('/' + me.data.id + '/subscribed_apps?subscribed_fields=messages', token, { method: 'POST' });
  if (!sub.ok) return fail(meta.errorCode(sub), 'Sayfa uygulamaya abone edilemedi. Jeton izinlerini (pages_manage_metadata, instagram_manage_messages) kontrol edin.');

  const row = await store.beginConnect(clinicId, 'instagram');
  try {
    await store.update(row.id, {
      status: 'pending', external_id: String(ig.id), display_name: ig.username ? '@' + ig.username : me.data.name,
      creds: { pageAccessToken: token, appSecret: appSecret, pageId: String(me.data.id) }
    });
  } catch (e) {
    await store.update(row.id, { status: 'error', last_error: 'already_connected_elsewhere' });
    return fail('already_connected_elsewhere', 'Bu Instagram hesabı başka bir hesaba bağlı.');
  }
  return {
    success: true, status: 'pending', webhookUrl: store.webhookUrl(row.id),
    message: 'Instagram hesabı bulundu. Son adım: Meta uygulamanızda Instagram webhook adresini ve doğrulama jetonunu girip "messages" alanına abone olun.'
  };
}

async function disconnect(clinicId) {
  const conn = await store.byOrg(clinicId, 'instagram');
  if (conn) await store.disconnect(conn.id);
}

async function sendMessage(clinicId, to, text) {
  const conn = await store.byOrg(clinicId, 'instagram');
  if (!conn || conn.status !== 'connected' || !conn.creds) throw new ChannelError('not_connected');
  let lastId;
  for (const part of chunk(text, MAX_TEXT.instagram)) {
    const r = await meta.graph('/' + conn.creds.pageId + '/messages', conn.creds.pageAccessToken, {
      method: 'POST', body: { recipient: { id: to }, messaging_type: 'RESPONSE', message: { text: part } }
    });
    if (!r.ok) throw new ChannelError(meta.errorCode(r));
    lastId = r.data ? r.data.message_id : undefined;
  }
  return { id: lastId };
}

async function verifyWebhook(req) {
  if (!req.connection || req.connection.channel !== 'instagram' || req.method !== 'POST') return false;
  return meta.signatureValid(req);
}

function parseAll(payload, connection) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry) || !connection) return [];
  const own = String(connection.external_id);
  const out = [];
  payload.entry.forEach(function (entry) {
    if (String(entry.id) !== own) return;
    (entry.messaging || []).forEach(function (ev) {
      const m = ev.message;
      if (!m || m.is_echo || m.is_deleted || typeof m.text !== 'string' || !m.text.trim()) return;
      if (!ev.sender || !ev.sender.id || String(ev.sender.id) === own) return;
      out.push({
        clinicId: connection.organization_id, channel: 'instagram', from: String(ev.sender.id), text: m.text.trim(),
        timestamp: Number(ev.timestamp || 0), raw: ev, externalId: m.mid, name: null
      });
    });
  });
  return out;
}

function parseIncoming(payload, connection) {
  return parseAll(payload, connection)[0] || null;
}

module.exports = {
  type: 'instagram', connect, disconnect, sendMessage, verifyWebhook, parseIncoming, parseAll,
  handleVerification: meta.handleVerification
};
