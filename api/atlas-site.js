'use strict';

/**
 * Panel ↔ klinik web sitesi ("Web Sitem" ekranı) — Görev 7.
 *
 *   GET  /api/atlas-site                         → { site, suggested, services, channels, canManage, ... }
 *   POST /api/atlas-site { action, ... }:
 *     save         { subdomain, template, accent, info }   bilgiler
 *     upload       { kind:'logo'|'photo', data:<data URL>, alt? }
 *     removePhoto  { path }
 *     generate     {}                 DeepSeek metni (günde GENERATE_DAILY_LIMIT)
 *     saveContent  { content }        klinik düzenlemesi
 *     preview      {}                 → { html }  (taslak, yayınlanmaz)
 *     publish      { approve:true }   ONAY + denetim temiz → anlık görüntü yayına
 *     unpublish    {}
 *
 * Oturum ZORUNLU (_atlas/panel.js); okuma her üye, değişiklik yalnız owner/manager.
 * Kurum jetondan gelir. Yayın kapısı: içerik var, sağlık iddiası denetimi temiz
 * (compliance.js), alt alan adı atanmış ve klinik sahibi AÇIKÇA onayladı;
 * onaylanan HTML saklanır ve birebir o sunulur.
 */

const tg = require('../cyberlionai/api/_lib/telegram.js');
const panel = require('./_atlas/panel.js');
const store = require('./_atlas/site/store.js');
const slug = require('./_atlas/site/slug.js');
const contentLib = require('./_atlas/site/content.js');
const compliance = require('./_atlas/site/compliance.js');
const { render, THEMES } = require('./_atlas/site/render.js');

const GENERATE_DAILY_LIMIT = 10;
const MAX_PHOTOS = 12;
const HEX_RE = /^#[0-9a-f]{6}$/i;

function jsonBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : '');
  try { return raw ? JSON.parse(raw) || {} : {}; } catch (e) { return {}; }
}

function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function multiline(v, max) { return String(v == null ? '' : v).replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max); }

/** Panelden gelen bilgi alanları → temiz nesne (bilinmeyen alan atılır). */
function cleanInfo(i) {
  const s = i || {};
  return {
    address: str(s.address, 200), district: str(s.district, 60), city: str(s.city, 60),
    phone: str(s.phone, 25), whatsapp: s.whatsapp !== false, email: str(s.email, 120),
    instagram: str(s.instagram, 31).replace(/^@/, ''), hours: multiline(s.hours, 300),
    aboutNotes: multiline(s.aboutNotes, 1500)
  };
}

function siteUrl(sub) { return 'https://' + sub + '.atlasasistan.com'; }
function pathUrl(sub) { return 'https://atlasasistan.com/s/' + sub; }

/** Panelde gösterilecek alanlar (yayın HTML'i hariç). */
function view(row, base) {
  if (!row) return null;
  return {
    subdomain: row.subdomain, template: row.template, accent: row.accent, info: row.info || {},
    logo: row.logo_path ? { path: row.logo_path, url: base + '/' + row.logo_path } : null,
    photos: (row.photos || []).map(function (p) { return { path: p.path, alt: p.alt || '', url: base + '/' + p.path }; }),
    content: row.content || null, issues: row.content_issues || [], generatedAt: row.generated_at,
    status: row.status, publishedAt: row.published_at, approvedAt: row.approved_at,
    urls: row.subdomain ? { subdomain: siteUrl(row.subdomain), path: pathUrl(row.subdomain) } : null
  };
}

async function renderFor(orgId, row) {
  const [name, services, channels] = await Promise.all([store.orgName(orgId), store.activeServices(orgId), store.channelHandles(orgId)]);
  const content = row.content || contentLib.fallback(name || 'Klinik', row.info || {}, services);
  return render(Object.assign({}, row, { name: name || 'Klinik' }), content, services, {
    storageBase: store.storageBase(), channels: channels,
    canonicalBase: row.subdomain ? siteUrl(row.subdomain) : 'https://atlasasistan.com'
  });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  panel.cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const member = await panel.memberFromRequest(req);
  if (!member) return res.status(401).json({ error: { code: 'auth' } });
  const canManage = panel.canPay(member);
  const org = member.orgId;
  const base = store.storageBase();

  if (req.method === 'GET') {
    const [row, name, services, channels] = await Promise.all([store.getSite(org), store.orgName(org), store.activeServices(org), store.channelHandles(org)]);
    return res.status(200).json({
      site: view(row, base), clinicName: name, suggested: slug.suggest(name), services: services.length,
      channels: channels, canManage: canManage, themes: Object.keys(THEMES).map(function (k) { return { id: k, label: THEMES[k].label, accent: THEMES[k].accent }; }),
      limits: { photos: MAX_PHOTOS, bytes: store.MAX_BYTES, generationsPerDay: GENERATE_DAILY_LIMIT }
    });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.status(405).end(); }
  if (!canManage) return res.status(403).json({ error: { code: 'role' } });

  const body = jsonBody(req);
  const row = await store.getSite(org);

  switch (body.action) {
    case 'save': {
      const sub = String(body.subdomain || '').toLowerCase();
      const bad = slug.check(sub);
      if (bad) return res.status(400).json({ error: { code: 'subdomain_' + bad } });
      if (await store.subdomainTaken(sub, org)) return res.status(409).json({ error: { code: 'subdomain_taken' } });
      if (row && row.status === 'published' && row.subdomain && row.subdomain !== sub) {
        return res.status(409).json({ error: { code: 'unpublish_first' } });   // yayındaki adres sessizce değişmez
      }
      const template = THEMES[body.template] ? body.template : 'nebula';
      const accent = HEX_RE.test(String(body.accent || '')) ? String(body.accent).toLowerCase() : THEMES[template].accent;
      const saved = await store.upsertSite(org, { subdomain: sub, template: template, accent: accent, info: cleanInfo(body.info) });
      return res.status(200).json({ site: view(saved, base) });
    }

    case 'upload': {
      const kind = body.kind === 'logo' ? 'logo' : 'photo';
      if (kind === 'photo' && row && (row.photos || []).length >= MAX_PHOTOS) return res.status(400).json({ error: { code: 'too_many' } });
      const img = store.decodeImage(body.data);
      if (img.error) return res.status(400).json({ error: { code: 'image_' + img.error } });
      const path = await store.uploadImage(org, kind, img);
      let fields;
      if (kind === 'logo') {
        if (row && row.logo_path) await store.removeImage(org, row.logo_path);
        fields = { logo_path: path };
      } else {
        fields = { photos: ((row && row.photos) || []).concat([{ path: path, alt: str(body.alt, 120) }]) };
      }
      const saved = await store.upsertSite(org, fields);
      return res.status(200).json({ site: view(saved, base) });
    }

    case 'removePhoto': {
      const p = String(body.path || '');
      const photos = ((row && row.photos) || []).filter(function (x) { return x.path !== p; });
      if (!row || photos.length === (row.photos || []).length) return res.status(404).json({ error: { code: 'not_found' } });
      await store.removeImage(org, p);
      const saved = await store.upsertSite(org, { photos: photos });
      return res.status(200).json({ site: view(saved, base) });
    }

    case 'generate': {
      if (!row || !row.subdomain) return res.status(400).json({ error: { code: 'save_first' } });
      const today = new Date().toISOString().slice(0, 10);
      const used = row.generations_day === today ? row.generations_count : 0;
      if (used >= GENERATE_DAILY_LIMIT) return res.status(429).json({ error: { code: 'limit' } });
      const [name, services] = await Promise.all([store.orgName(org), store.activeServices(org)]);
      if (!services.length) return res.status(400).json({ error: { code: 'no_services' } });
      const content = await contentLib.generate(name || 'Klinik', row.info || {}, services);
      const issues = compliance.scanContent(content);
      const saved = await store.upsertSite(org, {
        content: content, content_issues: issues, generated_at: new Date().toISOString(),
        generations_day: today, generations_count: used + 1
      });
      return res.status(200).json({ site: view(saved, base), source: content.source });
    }

    case 'saveContent': {
      if (!row) return res.status(400).json({ error: { code: 'save_first' } });
      const services = await store.activeServices(org);
      const content = contentLib.sanitizeEdited(body.content || {}, services);
      const issues = compliance.scanContent(content);
      const saved = await store.upsertSite(org, { content: content, content_issues: issues });
      return res.status(200).json({ site: view(saved, base) });
    }

    case 'preview': {
      if (!row) return res.status(400).json({ error: { code: 'save_first' } });
      return res.status(200).json({ html: await renderFor(org, row) });
    }

    case 'publish': {
      if (!row || !row.subdomain) return res.status(400).json({ error: { code: 'save_first' } });
      if (!row.content) return res.status(400).json({ error: { code: 'no_content' } });
      const issues = compliance.scanContent(row.content);
      if (issues.length) return res.status(400).json({ error: { code: 'compliance' }, issues: issues });
      if (body.approve !== true) return res.status(400).json({ error: { code: 'approval_required' } });
      const html = await renderFor(org, row);
      const now = new Date().toISOString();
      const saved = await store.upsertSite(org, {
        status: 'published', published_html: html, published_at: now, approved_by: member.userId, approved_at: now,
        approval_note: 'Klinik sahibi/yönetici metinleri okudu; sağlık iddiası ve öncesi/sonrası görsel içermediğini onayladı.',
        content_issues: []
      });
      return res.status(200).json({ site: view(saved, base) });
    }

    case 'unpublish': {
      if (!row) return res.status(404).json({ error: { code: 'not_found' } });
      const saved = await store.upsertSite(org, { status: 'draft', published_html: null });
      return res.status(200).json({ site: view(saved, base) });
    }

    default:
      return res.status(400).json({ error: { code: 'action' } });
  }
}

module.exports = tg.ucuSar(handler, '/api/atlas-site');
module.exports.cleanInfo = cleanInfo;
