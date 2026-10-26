'use strict';

/**
 * WhatsApp adaptörü (Meta WhatsApp Cloud API).
 *
 * Kimlik bilgileri (panel): phoneNumberId, wabaId, accessToken (kalıcı sistem
 * kullanıcısı jetonu), appSecret.
 * connect: numara jetonla okunur (GET /{phone-number-id}) → uygulama WABA'ya
 *   abone edilir (POST /{waba-id}/subscribed_apps) → bağlantı 'pending';
 *   klinik Meta uygulamasına webhook adresi + doğrulama jetonunu girince
 *   (GET doğrulaması) 'connected'.
 * İzolasyon: gövdedeki metadata.phone_number_id bağlantının numarasıyla aynı
 *   olmalı; değilse olay yok sayılır.
 * Gönderim: 24 saat penceresi dışında serbest metin reddedilir (131047) —
 *   müşteri yazdıktan sonraki cevaplar bu pencerededir.
 */

const store = require('./store.js');
const secrets = require('./secrets.js');
const meta = require('./meta.js');
const { MAX_TEXT, chunk, ChannelError } = require('./adapter.js');

function fail(error, message) { return { success: false, status: 'error', error: error, message: message }; }

async function connect(clinicId, credentials) {
  const c = credentials || {};
  const phoneNumberId = String(c.phoneNumberId || '').trim();
  const wabaId = String(c.wabaId || '').trim();
  const accessToken = String(c.accessToken || '').trim();
  const appSecret = String(c.appSecret || '').trim();
  if (!meta.ID_RE.test(phoneNumberId)) return fail('phone_number_id', 'Telefon numarası kimliği (Phone number ID) yalnız rakamlardan oluşur.');
  if (!meta.ID_RE.test(wabaId)) return fail('waba_id', 'WhatsApp Business hesap kimliği (WABA ID) yalnız rakamlardan oluşur.');
  if (accessToken.length < 50) return fail('access_token', 'Erişim jetonu çok kısa. Kalıcı (System User) jetonu yapıştırın.');
  if (!meta.APP_SECRET_RE.test(appSecret)) return fail('app_secret', 'Uygulama gizli anahtarı (App Secret) 32 karakterlik bir değerdir.');
  if (!secrets.isConfigured()) return fail('server_config', 'Sunucu yapılandırması eksik; Atlas ekibine haber verin.');

  const num = await meta.graph('/' + phoneNumberId + '?fields=display_phone_number,verified_name', accessToken);
  if (!num.ok || !num.data || !num.data.display_phone_number) {
    return fail(meta.errorCode(num), 'Meta bu numarayı ya da jetonu tanımadı. Phone number ID ve erişim jetonunu kontrol edin.');
  }
  const sub = await meta.graph('/' + wabaId + '/subscribed_apps', accessToken, { method: 'POST' });
  if (!sub.ok) return fail(meta.errorCode(sub), 'Uygulama WhatsApp hesabınıza abone edilemedi. WABA ID ve jeton izinlerini (whatsapp_business_management) kontrol edin.');

  const row = await store.beginConnect(clinicId, 'whatsapp');
  try {
    await store.update(row.id, {
      status: 'pending', external_id: phoneNumberId,
      display_name: (num.data.verified_name ? num.data.verified_name + ' · ' : '') + num.data.display_phone_number,
      creds: { accessToken: accessToken, appSecret: appSecret, wabaId: wabaId }
    });
  } catch (e) {
    await store.update(row.id, { status: 'error', last_error: 'already_connected_elsewhere' });
    return fail('already_connected_elsewhere', 'Bu numara başka bir hesaba bağlı.');
  }
  return {
    success: true, status: 'pending', webhookUrl: store.webhookUrl(row.id),
    message: 'Numara doğrulandı. Son adım: Meta uygulamanızda Webhook adresini ve doğrulama jetonunu girip "messages" alanına abone olun.'
  };
}

async function disconnect(clinicId) {
  const conn = await store.byOrg(clinicId, 'whatsapp');
  /* Uygulamanın WABA aboneliği kaldırılmaz: klinik aynı uygulamayı başka iş için kullanıyor olabilir. */
  if (conn) await store.disconnect(conn.id);
}

async function sendMessage(clinicId, to, text) {
  const conn = await store.byOrg(clinicId, 'whatsapp');
  if (!conn || conn.status !== 'connected' || !conn.creds) throw new ChannelError('not_connected');
  let lastId;
  for (const part of chunk(text, MAX_TEXT.whatsapp)) {
    const r = await meta.graph('/' + conn.external_id + '/messages', conn.creds.accessToken, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: to, type: 'text', text: { body: part, preview_url: false } }
    });
    if (!r.ok) throw new ChannelError(meta.errorCode(r));
    lastId = r.data && r.data.messages && r.data.messages[0] ? r.data.messages[0].id : undefined;
  }
  return { id: lastId };
}

async function verifyWebhook(req) {
  if (!req.connection || req.connection.channel !== 'whatsapp' || req.method !== 'POST') return false;
  return meta.signatureValid(req);
}

function textOf(m) {
  if (m.type === 'text' && m.text) return m.text.body;
  if (m.type === 'button' && m.button) return m.button.text;
  if (m.type === 'interactive' && m.interactive) {
    const i = m.interactive;
    return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || null;
  }
  return null;
}

function parseAll(payload, connection) {
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return [];
  const out = [];
  payload.entry.forEach(function (entry) {
    (entry.changes || []).forEach(function (change) {
      const v = change && change.field === 'messages' ? change.value : null;
      if (!v || !Array.isArray(v.messages)) return;          // durum (status) olayları: mesaj yok
      if (!connection || !v.metadata || String(v.metadata.phone_number_id) !== String(connection.external_id)) return;
      const contacts = v.contacts || [];
      v.messages.forEach(function (m) {
        const text = textOf(m);
        if (!m.from || typeof text !== 'string' || !text.trim()) return;
        const contact = contacts.find(function (c) { return c.wa_id === m.from; });
        out.push({
          clinicId: connection.organization_id, channel: 'whatsapp', from: String(m.from), text: text.trim(),
          timestamp: Number(m.timestamp || 0) * 1000, raw: m, externalId: m.id,
          name: contact && contact.profile ? contact.profile.name : null
        });
      });
    });
  });
  return out;
}

function parseIncoming(payload, connection) {
  return parseAll(payload, connection)[0] || null;
}

module.exports = {
  type: 'whatsapp', connect, disconnect, sendMessage, verifyWebhook, parseIncoming, parseAll,
  handleVerification: meta.handleVerification
};
