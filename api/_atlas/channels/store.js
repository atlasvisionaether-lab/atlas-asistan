'use strict';

/**
 * channel_connections tablosu (migration 0020) + sağlayıcı HTTP yardımcısı.
 *
 * Yalnız servis rolüyle (db.request) okunur/yazılır; tarayıcıdan erişim yok.
 * `secrets` sütunu şifreli (secrets.js); burada çözülüp `creds` olarak verilir.
 * İstemciye giden listede secrets, webhook_secret ve creds YOKTUR (publicView).
 */

const db = require('../../../cyberlionai/api/_lib/db.js');
const secrets = require('./secrets.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_TIMEOUT_MS = 8000;

function siteUrl() {
  const v = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\//.test(v) ? v : 'https://atlasasistan.com';
}

function webhookUrl(connectionId) {
  return siteUrl() + '/api/atlas-channel-webhook?c=' + connectionId;
}

function withCreds(row) {
  if (!row) return null;
  let creds = null;
  if (row.secrets) {
    try { creds = secrets.open(row.secrets); } catch (e) { creds = null; }
  }
  return Object.assign({}, row, { creds: creds });
}

async function one(query) {
  const rows = await db.request('channel_connections?' + query + '&limit=1');
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function byId(id) {
  if (!UUID_RE.test(String(id))) return null;
  return withCreds(await one('id=eq.' + id));
}

async function byOrg(orgId, channel) {
  if (!UUID_RE.test(String(orgId))) return null;
  return withCreds(await one('organization_id=eq.' + orgId + '&channel=eq.' + encodeURIComponent(channel)));
}

async function listByOrg(orgId) {
  if (!UUID_RE.test(String(orgId))) return [];
  const rows = await db.request('channel_connections?organization_id=eq.' + orgId + '&order=channel');
  return Array.isArray(rows) ? rows : [];
}

/**
 * Kurum + kanal için bağlantı satırını açar ya da yeniler. Her bağlanma
 * denemesinde webhook gizli değeri YENİLENİR (eski adres/anahtar geçersiz olur).
 */
async function beginConnect(orgId, channel) {
  const rows = await db.request('channel_connections?on_conflict=organization_id,channel', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      organization_id: orgId, channel: channel, status: 'pending', webhook_secret: secrets.randomToken(),
      secrets: null, external_id: null, display_name: null, last_error: null, connected_at: null,
      updated_at: new Date().toISOString()
    }
  });
  return Array.isArray(rows) ? rows[0] : null;
}

/** Alanları günceller; `creds` verilirse şifrelenip secrets'a yazılır. */
async function update(id, fields) {
  const body = Object.assign({}, fields, { updated_at: new Date().toISOString() });
  if (body.creds) { body.secrets = secrets.seal(body.creds); }
  delete body.creds;
  const rows = await db.request('channel_connections?id=eq.' + id, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: body
  });
  return Array.isArray(rows) ? rows[0] : null;
}

/** Bağlantıyı keser: jetonlar silinir, satır 'disconnected' kalır (geçmiş için). */
function disconnect(id) {
  return update(id, { status: 'disconnected', secrets: null, last_error: null, connected_at: null });
}

/** Panelde gösterilecek alanlar (gizli değer yok). */
function publicView(row, canManage) {
  const meta = row.channel === 'whatsapp' || row.channel === 'instagram';
  return {
    channel: row.channel,
    status: row.status,
    displayName: row.display_name || null,
    externalId: row.external_id || null,
    lastError: row.last_error || null,
    connectedAt: row.connected_at || null,
    /* Meta uygulamasına girilecek değerler: yalnız yönetebilen görür. */
    webhookUrl: meta && canManage && row.status !== 'disconnected' ? webhookUrl(row.id) : null,
    verifyToken: meta && canManage && row.status !== 'disconnected' ? row.webhook_secret : null
  };
}

/**
 * Sağlayıcıya JSON isteği: { ok, status, data }. Ağ hatası/zaman aşımında
 * ok:false, status:0. Gövde ve jeton loglanmaz.
 */
async function http(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: (opts && opts.method) || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}),
      body: opts && opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    });
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    return { ok: r.ok, status: r.status, data: data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { byId, byOrg, listByOrg, beginConnect, update, disconnect, publicView, webhookUrl, siteUrl, http, UUID_RE };
