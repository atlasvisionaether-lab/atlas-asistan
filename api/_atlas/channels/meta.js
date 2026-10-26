'use strict';

/**
 * Meta (WhatsApp Cloud API + Instagram Messaging) ortak parçaları.
 *
 * Model: klinik KENDİ Meta uygulamasını kullanır (App Secret + erişim jetonu
 * panelde girilir). Webhook adresi kliniğe özeldir (?c=<bağlantı>) ve bu
 * adrese gelen her POST, kliniğin App Secret'ıyla HMAC-SHA256 imzalı olmalı
 * (X-Hub-Signature-256: sha256=<hex>). İmza HAM gövde üzerinden doğrulanır:
 * Meta gövdeyi kendi kaçış kurallarıyla yazar; JSON yeniden yazılırsa tutmaz.
 *
 * Webhook kurulumu: Meta, adresi GET ile doğrular (hub.mode=subscribe,
 * hub.verify_token=<bağlantının webhook_secret'ı>, hub.challenge). Doğrulama
 * geçince bağlantı 'connected' olur.
 *
 *   META_GRAPH_VERSION  varsayılan v21.0
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

/** POST imzası: X-Hub-Signature-256 = "sha256=" + HMAC(appSecret, ham gövde). */
function signatureValid(req) {
  const conn = req.connection;
  if (!conn || !conn.creds || !conn.creds.appSecret || !Buffer.isBuffer(req.raw)) return false;
  const header = String((req.headers || {})['x-hub-signature-256'] || '');
  if (header.indexOf('sha256=') !== 0) return false;
  const expected = crypto.createHmac('sha256', conn.creds.appSecret).update(req.raw).digest('hex');
  return secrets.safeEqual(header.slice(7).toLowerCase(), expected);
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

module.exports = { graph, graphBase, signatureValid, handleVerification, errorCode, APP_SECRET_RE, ID_RE };
