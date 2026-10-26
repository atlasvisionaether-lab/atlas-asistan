'use strict';

/**
 * clinic_sites (0022) + 'clinic-sites' Storage kovası — yalnız servis rolüyle.
 *
 * Görsel yükleme: tür UZANTIDAN değil BAYTLARDAN (JPEG/PNG/WebP imzası)
 * belirlenir; en çok 2 MB; yol <kurum>/<tür>-<rastgele>.<uzantı> (render.js
 * PATH_RE ile aynı biçim). SVG kabul edilmez (betik taşıyabilir).
 */

const crypto = require('node:crypto');
const db = require('../../../cyberlionai/api/_lib/db.js');

const BUCKET = 'clinic-sites';
const MAX_BYTES = 2 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function supabaseUrl() { return String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''); }
function serviceKey() { return String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(); }
function storageBase() { return supabaseUrl() + '/storage/v1/object/public/' + BUCKET; }

async function one(path) {
  const rows = await db.request(path);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function getSite(orgId) {
  if (!UUID_RE.test(String(orgId))) return Promise.resolve(null);
  return one('clinic_sites?organization_id=eq.' + orgId + '&limit=1');
}

function getPublished(subdomain) {
  return one('clinic_sites?subdomain=eq.' + encodeURIComponent(subdomain) + '&status=eq.published&select=organization_id,subdomain,template,accent,info,logo_path,photos,published_html,updated_at&limit=1');
}

/* ---- VIP çok sayfalı site (0023) ---- */

/** VIP: kurum planı 'vip' (yönetici elle) ya da ödenmiş VIP siparişi. */
async function isVip(orgId) {
  if (!UUID_RE.test(String(orgId))) return false;
  try {
    const org = await one('organizations?id=eq.' + orgId + '&select=plan&limit=1');
    if (org && String(org.plan || '').toLowerCase() === 'vip') return true;
    const order = await one('atlas_orders?organization_id=eq.' + orgId + '&plan=eq.vip&status=eq.paid&select=id&limit=1');
    return !!order;
  } catch (e) {
    /* Okunamazsa VIP sayılmaz; tek sayfalı site çalışmayı sürdürür. */
    console.warn('site-store: vip_check_failed (' + e.message + ')');
    return false;
  }
}

const PAGE_FIELDS = 'id,kind,slug,ref,content,issues,status,published_at,approved_at,generated_at,updated_at';

async function listPages(orgId) {
  if (!UUID_RE.test(String(orgId))) return [];
  const rows = await db.request('clinic_site_pages?organization_id=eq.' + orgId + '&status=neq.archived&select=' + PAGE_FIELDS + '&order=kind,slug');
  return Array.isArray(rows) ? rows : [];
}

function getPage(orgId, slug) {
  return one('clinic_site_pages?organization_id=eq.' + orgId + '&slug=eq.' + encodeURIComponent(slug) + '&select=' + PAGE_FIELDS + '&limit=1');
}

function getPublishedPage(orgId, slug) {
  return one('clinic_site_pages?organization_id=eq.' + orgId + '&slug=eq.' + encodeURIComponent(slug) + '&status=eq.published&select=kind,published_html&limit=1');
}

async function publishedPages(orgId) {
  const rows = await db.request('clinic_site_pages?organization_id=eq.' + orgId + '&status=eq.published&select=kind,slug,ref,content,published_at&order=published_at.desc');
  return Array.isArray(rows) ? rows : [];
}

async function upsertPage(orgId, slug, fields) {
  const rows = await db.request('clinic_site_pages?on_conflict=organization_id,slug', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: Object.assign({ organization_id: orgId, slug: slug, updated_at: new Date().toISOString() }, fields)
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function subdomainTaken(subdomain, orgId) {
  const row = await one('clinic_sites?subdomain=eq.' + encodeURIComponent(subdomain) + '&select=organization_id&limit=1');
  return !!row && row.organization_id !== orgId;
}

/** Satırı açar ya da günceller (kurum başına tek satır). */
async function upsertSite(orgId, fields) {
  const rows = await db.request('clinic_sites?on_conflict=organization_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: Object.assign({ organization_id: orgId, updated_at: new Date().toISOString() }, fields)
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function orgName(orgId) {
  const row = await one('organizations?id=eq.' + orgId + '&select=name&limit=1');
  return row ? row.name : null;
}

async function activeServices(orgId) {
  const rows = await db.request('services?organization_id=eq.' + orgId + '&is_active=eq.true&select=name,price,duration_min&order=name');
  return Array.isArray(rows) ? rows : [];
}

/** Bağlı kanalların görünen adları → { telegram:'@bot', instagram:'@hesap' } */
async function channelHandles(orgId) {
  let rows = [];
  try { rows = await db.request('channel_connections?organization_id=eq.' + orgId + '&status=eq.connected&select=channel,display_name'); } catch (e) { rows = []; }
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if ((r.channel === 'telegram' || r.channel === 'instagram') && /^@/.test(r.display_name || '')) out[r.channel] = r.display_name;
  });
  return out;
}

/** data URL → { buf, ext } | { error } */
function decodeImage(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'format' };
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) return { error: 'format' };
  if (buf.length > MAX_BYTES) return { error: 'too_large' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { buf, ext: 'jpg', type: 'image/jpeg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { buf, ext: 'png', type: 'image/png' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { buf, ext: 'webp', type: 'image/webp' };
  return { error: 'format' };
}

async function storage(method, path, body, type) {
  const r = await fetch(supabaseUrl() + '/storage/v1/object/' + BUCKET + '/' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + serviceKey(), apikey: serviceKey() },
      type ? { 'Content-Type': type, 'x-upsert': 'false', 'cache-control': '31536000' } : {}),
    body: body
  });
  if (!r.ok) throw new Error('storage_' + r.status);
}

/** Kurum klasörüne yükler; yolu döndürür. */
async function uploadImage(orgId, kind, img) {
  const path = orgId + '/' + kind + '-' + crypto.randomBytes(6).toString('hex') + '.' + img.ext;
  await storage('POST', path, img.buf, img.type);
  return path;
}

/** Yalnız bu kurumun klasöründeki dosya silinir. */
async function removeImage(orgId, path) {
  if (String(path || '').indexOf(orgId + '/') !== 0) return;
  try { await storage('DELETE', path); } catch (e) { console.warn('site-store: delete_failed (' + e.message + ')'); }
}

module.exports = {
  isVip, listPages, getPage, getPublishedPage, publishedPages, upsertPage,
  getSite, getPublished, subdomainTaken, upsertSite, orgName, activeServices, channelHandles,
  decodeImage, uploadImage, removeImage, storageBase, MAX_BYTES, UUID_RE
};
