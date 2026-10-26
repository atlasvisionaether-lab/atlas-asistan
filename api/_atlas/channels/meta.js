'use strict';

/**
 * Meta (WhatsApp Cloud API + Instagram Messaging) ortak parçaları.
 *
 * İki model:
 *   manual   — klinik KENDİ Meta uygulamasını kullanır (App Secret + erişim jetonu
 *              panelde girilir).
 *   embedded — Atlas'ın Tech Provider uygulaması; klinik "tek tıkla bağla"
 *              (Embedded Signup v4) ile bağlanır. Tek uygulama webhook'u
 *              (/api/atlas-channel-webhook?app=meta), imza META_APP_SECRET ile;
 *              olay, metadata.phone_number_id ile kliniğin bağlantısına yönlenir.
 *
 * Manual modelde Webhook adresi kliniğe özeldir (?c=<bağlantı>) ve bu
 * adrese gelen her POST, kliniğin App Secret'ıyla HMAC-SHA256 imzalı olmalı
 * (X-Hub-Signature-256: sha256=<hex>). İmza HAM gövde üzerinden doğrulanır:
 * Meta gövdeyi kendi kaçış kurallarıyla yazar; JSON yeniden yazılırsa tutmaz.
 *
 * Webhook kurulumu: Meta, adresi GET ile doğrular (hub.mode=subscribe,
 * hub.verify_token=<bağlantının webhook_secret'ı>, hub.challenge). Doğrulama
 * geçince bağlantı 'connected' olur.
 *
 *   META_GRAPH_VERSION         varsayılan v21.0
 *   META_APP_ID                Atlas Meta uygulaması (embedded)
 *   META_APP_SECRET            imza + kod değişimi (embedded; tarayıcıya ASLA gitmez)
 *   META_ES_CONFIG_ID          Facebook Login for Business yapılandırma kimliği
 *   META_WEBHOOK_VERIFY_TOKEN  uygulama webhook'unun GET doğrulama jetonu
 */

const crypto = require('node:crypto');
const store = require('./store.js');
const secrets = require('./secrets.js');

function graphBase() {
  const v = String(process.env.META_GRAPH_VERSION || '').trim();
  return 'https://graph.facebook.com/' + (/^v\d+\.\d+$/.test(v) ? v : 'v21.0');
}

function graph(path, token, opts) {
  return store.http(graphBase() + path, {
    method: (opts && opts.method) || 'GET',
    headers: { Authorization: 'Bearer ' + token },
    body: opts && opts.body
  });
}

function env(name) { return String(process.env[name] || '').trim(); }

/** Embedded Signup için gereken her şey tanımlı mı? (yoksa panel düğmeyi göstermez) */
function embeddedConfig() {
  const appId = env('META_APP_ID'), configId = env('META_ES_CONFIG_ID');
  if (!ID_RE.test(appId) || !ID_RE.test(configId) || !APP_SECRET_RE.test(env('META_APP_SECRET')) || env('META_WEBHOOK_VERIFY_TOKEN').length < 16) return null;
  return { appId: appId, configId: configId, graphVersion: graphBase().split('/').pop() };
}

/** HMAC(secret, ham gövde) = X-Hub-Signature-256 ("sha256=<hex>")? */
function hmacValid(secret, raw, headers) {
  if (!secret || !Buffer.isBuffer(raw)) return false;
  const header = String((headers || {})['x-hub-signature-256'] || '');
  if (header.indexOf('sha256=') !== 0) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return secrets.safeEqual(header.slice(7).toLowerCase(), expected);
}

/** Bağlantıya özel adres (manual): kliniğin App Secret'ı; embedded bağlantı: Atlas'ınki. */
function signatureValid(req) {
  const conn = req.connection;
  if (!conn) return false;
  const secret = conn.mode === 'embedded' ? env('META_APP_SECRET') : conn.creds && conn.creds.appSecret;
  return hmacValid(secret, req.raw, req.headers);
}

/** Uygulama webhook'u (?app=meta): Atlas App Secret ile imza. */
function appSignatureValid(raw, headers) {
  return hmacValid(env('META_APP_SECRET'), raw, headers);
}

/** Uygulama webhook'unun GET doğrulaması. */
function appVerification(query) {
  const q = query || {};
  const token = env('META_WEBHOOK_VERIFY_TOKEN');
  if (q['hub.mode'] !== 'subscribe' || token.length < 16 || !secrets.safeEqual(String(q['hub.verify_token'] || ''), token)) return { ok: false };
  return { ok: true, challenge: String(q['hub.challenge'] || '') };
}

/** Embedded Signup kodu (30 sn ömürlü) → kliniğe özel işletme jetonu | null. */
async function exchangeCode(code) {
  const qs = new URLSearchParams({ client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), code: String(code || '') });
  const r = await store.http(graphBase() + '/oauth/access_token?' + qs.toString(), { method: 'GET' });
  return r.ok && r.data && typeof r.data.access_token === 'string' && r.data.access_token.length > 20 ? r.data.access_token : null;
}

/**
 * GET doğrulaması. { ok, challenge } — ok ise challenge düz metin döner ve
 * bağlantı 'pending' ise 'connected' yapılır.
 */
async function handleVerification(req) {
  const q = req.query || {};
  const conn = req.connection;
  if (!conn || q['hub.mode'] !== 'subscribe' || !secrets.safeEqual(q['hub.verify_token'], conn.webhook_secret)) {
    return { ok: false };
  }
  if (conn.status === 'pending') {
    await store.update(conn.id, { status: 'connected', connected_at: new Date().toISOString(), last_error: null });
  }
  return { ok: true, challenge: String(q['hub.challenge'] || '') };
}

/** Graph hata cevabından kısa kod (mesaj/jeton loglanmaz). */
function errorCode(r) {
  const e = r && r.data && r.data.error;
  return e && e.code ? 'meta_' + e.code + (e.error_subcode ? '_' + e.error_subcode : '') : 'meta_http_' + (r ? r.status : 0);
}

const APP_SECRET_RE = /^[0-9a-f]{32}$/i;
const ID_RE = /^\d{5,25}$/;

module.exports = {
  graph, graphBase, signatureValid, handleVerification, errorCode, APP_SECRET_RE, ID_RE,
  embeddedConfig, appSignatureValid, appVerification, exchangeCode
};
