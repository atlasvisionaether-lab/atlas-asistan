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
 *                                      (VIP: hizmet + bölge sayfaları da birlikte)
 *     unpublish    {}
 *   VIP (organizations.plan='vip' ya da ödenmiş VIP siparişi; bkz. 0023):
 *     saveRegions  { regions:[{name,service,note}] }   en çok 6, bölgeye özgü not zorunlu
 *     generatePage { kind:'service'|'region', key }    tek sayfa (60 sn sınırı)
 *     savePage     { slug, content }                   klinik düzenlemesi
 *     suggestTopics {}  draftPost { title }            blog
 *     publishPost  { slug, approve:true }  unpublishPost { slug }  archivePost { slug }
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
const pagesLib = require('./_atlas/site/pages.js');
const { render, renderServicePage, renderRegionPage, renderBlogPost, THEMES } = require('./_atlas/site/render.js');

const GENERATE_DAILY_LIMIT = 10;
const GENERATE_DAILY_LIMIT_VIP = 60;   // çok sayfalı site: ~8 hizmet + 6 bölge + blog
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
    status: row.status, publishedAt: row.published_at, approvedAt: row.approved_at, regions: row.regions || [],
    urls: row.subdomain ? { subdomain: siteUrl(row.subdomain), path: pathUrl(row.subdomain) } : null
  };
}

/** Şablonlar için ortak bağlam (kurum adı, aktif hizmetler, bağlı kanallar). */
async function siteCtx(orgId, row) {
  const [name, services, channels] = await Promise.all([store.orgName(orgId), store.activeServices(orgId), store.channelHandles(orgId)]);
  return {
    name: name || 'Klinik', services: services, site: Object.assign({}, row, { name: name || 'Klinik' }),
    opts: { storageBase: store.storageBase(), channels: channels, canonicalBase: row.subdomain ? siteUrl(row.subdomain) : 'https://atlasasistan.com' }
  };
}

function renderHome(ctx, row, pagesMap) {
  const content = row.content || contentLib.fallback(ctx.name, row.info || {}, ctx.services);
  return render(ctx.site, content, ctx.services, Object.assign({}, ctx.opts, { pages: pagesMap || null }));
}

async function renderFor(orgId, row) {
  return renderHome(await siteCtx(orgId, row), row, null);
}

/** Bağlantı haritası: hangi ek sayfalar yayında (ya da birlikte yayınlanacak). */
function pagesMap(list, vip) {
  const map = { services: {}, regions: [], blog: !!vip };
  list.forEach(function (p) {
    if (p.kind === 'service') map.services[p.ref] = p.slug;
    else if (p.kind === 'region') map.regions.push({ slug: p.slug, title: String(p.ref || '').split('|').reverse().join(' ').trim() });
  });
  return map;
}

/** Günlük üretim hakkı: varsa harcar → true; dolmuşsa false. */
async function consume(org, row, vip) {
  const today = new Date().toISOString().slice(0, 10);
  const used = row.generations_day === today ? row.generations_count : 0;
  if (used >= (vip ? GENERATE_DAILY_LIMIT_VIP : GENERATE_DAILY_LIMIT)) return false;
  await store.upsertSite(org, { generations_day: today, generations_count: used + 1 });
  row.generations_day = today; row.generations_count = used + 1;
  return true;
}

function pageView(p) {
  return { kind: p.kind, slug: p.slug, ref: p.ref, content: p.content || null, issues: p.issues || [], status: p.status, publishedAt: p.published_at, generatedAt: p.generated_at };
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
    const [row, name, services, channels, vip] = await Promise.all([store.getSite(org), store.orgName(org), store.activeServices(org), store.channelHandles(org), store.isVip(org)]);
    const pages = vip ? (await store.listPages(org)).map(pageView) : [];
    return res.status(200).json({
      site: view(row, base), clinicName: name, suggested: slug.suggest(name), services: services.length,
      serviceNames: services.map(function (s) { return s.name; }), vip: vip, pages: pages,
      vipLimits: { regions: pagesLib.MAX_REGIONS, regionNoteMin: pagesLib.REGION_NOTE_MIN, generationsPerDay: GENERATE_DAILY_LIMIT_VIP },
      channels: channels, canManage: canManage, themes: Object.keys(THEMES).map(function (k) { return { id: k, label: THEMES[k].label, accent: THEMES[k].accent }; }),
      limits: { photos: MAX_PHOTOS, bytes: store.MAX_BYTES, generationsPerDay: GENERATE_DAILY_LIMIT }
    });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.status(405).end(); }
  if (!canManage) return res.status(403).json({ error: { code: 'role' } });

  const body = jsonBody(req);
  const row = await store.getSite(org);
  const vipActions = ['saveRegions', 'generatePage', 'savePage', 'suggestTopics', 'draftPost', 'publishPost', 'unpublishPost', 'archivePost'];
  const vip = vipActions.indexOf(body.action) !== -1 || body.action === 'publish' || body.action === 'generate' ? await store.isVip(org) : false;
  if (vipActions.indexOf(body.action) !== -1) {
    if (!vip) return res.status(403).json({ error: { code: 'vip_required' } });
    if (!row || !row.subdomain) return res.status(400).json({ error: { code: 'save_first' } });
  }

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
      const [name, services] = await Promise.all([store.orgName(org), store.activeServices(org)]);
      if (!services.length) return res.status(400).json({ error: { code: 'no_services' } });
      if (!(await consume(org, row, vip))) return res.status(429).json({ error: { code: 'limit' } });
      const content = await contentLib.generate(name || 'Klinik', row.info || {}, services);
      const issues = compliance.scanContent(content);
      const saved = await store.upsertSite(org, { content: content, content_issues: issues, generated_at: new Date().toISOString() });
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
      const ctx = await siteCtx(org, row);
      const now = new Date().toISOString();
      let map = null;
      if (vip) {
        /* Hizmet + bölge sayfaları ana sayfayla AYNI onayla yayınlanır; biri bile
           denetimden geçmezse hiçbiri yayına çıkmaz. Pasifleşen hizmetin sayfası yayından iner. */
        const active = new Set(ctx.services.map(function (s) { return s.name; }));
        const regionsByslug = {};
        (row.regions || []).forEach(function (r) { regionsByslug[r.slug] = r; });
        const all = await store.listPages(org);
        const cands = all.filter(function (p) {
          return p.content && ((p.kind === 'service' && active.has(p.ref)) || (p.kind === 'region' && regionsByslug[p.slug] && active.has(regionsByslug[p.slug].service)));
        });
        const bad = cands.filter(function (p) { return compliance.scanContent(pagesLib.scanShape(p.kind, p.content)).length; });
        if (bad.length) return res.status(400).json({ error: { code: 'compliance_pages' }, pages: bad.map(function (p) { return p.slug; }) });
        map = pagesMap(cands, true);
        for (const p of cands) {
          const html = p.kind === 'service'
            ? renderServicePage(ctx.site, p.content, ctx.services.find(function (s) { return s.name === p.ref; }), p.slug, Object.assign({}, ctx.opts, { pages: map }))
            : renderRegionPage(ctx.site, p.content, regionsByslug[p.slug], ctx.services.find(function (s) { return s.name === regionsByslug[p.slug].service; }), p.slug, Object.assign({}, ctx.opts, { pages: map }));
          await store.upsertPage(org, p.slug, { status: 'published', published_html: html, published_at: now, approved_by: member.userId, approved_at: now, issues: [] });
        }
        for (const p of all) {
          if ((p.kind === 'service' || p.kind === 'region') && p.status === 'published' && cands.indexOf(p) === -1) {
            await store.upsertPage(org, p.slug, { status: 'draft', published_html: null });
          }
        }
      }
      const html = renderHome(ctx, row, map);
      const saved = await store.upsertSite(org, {
        status: 'published', published_html: html, published_at: now, approved_by: member.userId, approved_at: now,
        approval_note: 'Klinik sahibi/yönetici metinleri okudu; sağlık iddiası ve öncesi/sonrası görsel içermediğini onayladı.',
        content_issues: []
      });
      return res.status(200).json(vip ? { site: view(saved, base), pages: (await store.listPages(org)).map(pageView) } : { site: view(saved, base) });
    }

    case 'unpublish': {
      if (!row) return res.status(404).json({ error: { code: 'not_found' } });
      const saved = await store.upsertSite(org, { status: 'draft', published_html: null });
      return res.status(200).json({ site: view(saved, base) });
    }

    case 'saveRegions': {
      const services = await store.activeServices(org);
      const r = pagesLib.cleanRegions(body.regions, services.map(function (s) { return s.name; }));
      if (r.error) return res.status(400).json({ error: { code: r.error } });
      const keep = new Set(r.regions.map(function (x) { return x.slug; }));
      for (const p of await store.listPages(org)) {
        if (p.kind === 'region' && !keep.has(p.slug)) await store.upsertPage(org, p.slug, { kind: 'region', status: 'archived', published_html: null });
      }
      const saved = await store.upsertSite(org, { regions: r.regions });
      return res.status(200).json({ site: view(saved, base), pages: (await store.listPages(org)).map(pageView) });
    }

    case 'generatePage': {
      const ctx = await siteCtx(org, row);
      let slugValue, ref, content;
      if (body.kind === 'service') {
        const svc = ctx.services.find(function (s) { return s.name === body.key; });
        if (!svc) return res.status(400).json({ error: { code: 'service_unknown' } });
        if (!(await consume(org, row, true))) return res.status(429).json({ error: { code: 'limit' } });
        slugValue = pagesLib.serviceSlug(svc.name); ref = svc.name;
        content = await pagesLib.generateService(ctx.name, row.info || {}, svc);
      } else if (body.kind === 'region') {
        const reg = (row.regions || []).find(function (x) { return x.slug === body.key; });
        if (!reg) return res.status(400).json({ error: { code: 'region_unknown' } });
        if (!(await consume(org, row, true))) return res.status(429).json({ error: { code: 'limit' } });
        slugValue = reg.slug; ref = reg.service + '|' + reg.name;
        content = await pagesLib.generateRegion(ctx.name, row.info || {}, reg);
      } else {
        return res.status(400).json({ error: { code: 'kind' } });
      }
      const existing = await store.getPage(org, slugValue);
      if (existing && existing.kind !== body.kind) return res.status(409).json({ error: { code: 'slug_conflict' } });
      const issues = compliance.scanContent(pagesLib.scanShape(body.kind, content));
      const page = await store.upsertPage(org, slugValue, { kind: body.kind, ref: ref, content: content, issues: issues, generated_at: new Date().toISOString(), status: existing && existing.status === 'published' ? 'published' : 'draft' });
      return res.status(200).json({ page: pageView(page), source: content.source });
    }

    case 'savePage': {
      const page = await store.getPage(org, String(body.slug || ''));
      if (!page || page.status === 'archived') return res.status(404).json({ error: { code: 'not_found' } });
      const content = pagesLib.sanitizePage(page.kind, body.content);
      const issues = compliance.scanContent(pagesLib.scanShape(page.kind, content));
      const saved = await store.upsertPage(org, page.slug, { content: content, issues: issues });
      return res.status(200).json({ page: pageView(saved) });
    }

    case 'suggestTopics': {
      const ctx = await siteCtx(org, row);
      if (!(await consume(org, row, true))) return res.status(429).json({ error: { code: 'limit' } });
      return res.status(200).json({ topics: await pagesLib.suggestTopics(ctx.name, row.info || {}, ctx.services) });
    }

    case 'draftPost': {
      const title = str(body.title, 80);
      if (title.length < 8) return res.status(400).json({ error: { code: 'title' } });
      const slugValue = pagesLib.blogSlug(title);
      const existing = await store.getPage(org, slugValue);
      if (existing && existing.status !== 'archived') return res.status(409).json({ error: { code: 'post_exists' } });
      const ctx = await siteCtx(org, row);
      if (!(await consume(org, row, true))) return res.status(429).json({ error: { code: 'limit' } });
      const content = await pagesLib.generatePost(ctx.name, row.info || {}, ctx.services, title);
      if (!content) return res.status(502).json({ error: { code: 'llm' } });
      const issues = compliance.scanContent(pagesLib.scanShape('blog', content));
      const page = await store.upsertPage(org, slugValue, { kind: 'blog', ref: title, content: content, issues: issues, generated_at: new Date().toISOString(), status: 'draft', published_html: null });
      return res.status(200).json({ page: pageView(page) });
    }

    case 'publishPost': {
      const page = await store.getPage(org, String(body.slug || ''));
      if (!page || page.kind !== 'blog' || page.status === 'archived') return res.status(404).json({ error: { code: 'not_found' } });
      if (!page.content) return res.status(400).json({ error: { code: 'no_content' } });
      const issues = compliance.scanContent(pagesLib.scanShape('blog', page.content));
      if (issues.length) return res.status(400).json({ error: { code: 'compliance' }, issues: issues });
      if (body.approve !== true) return res.status(400).json({ error: { code: 'approval_required' } });
      if (row.status !== 'published') return res.status(400).json({ error: { code: 'site_not_published' } });
      const ctx = await siteCtx(org, row);
      const map = pagesMap((await store.publishedPages(org)), true);
      const now = new Date().toISOString();
      const html = renderBlogPost(ctx.site, page.content, page.slug, page.published_at || now, Object.assign({}, ctx.opts, { pages: map }));
      const saved = await store.upsertPage(org, page.slug, { status: 'published', published_html: html, published_at: page.published_at || now, approved_by: member.userId, approved_at: now, issues: [] });
      return res.status(200).json({ page: pageView(saved) });
    }

    case 'unpublishPost':
    case 'archivePost': {
      const page = await store.getPage(org, String(body.slug || ''));
      if (!page || page.kind !== 'blog') return res.status(404).json({ error: { code: 'not_found' } });
      const saved = await store.upsertPage(org, page.slug, { status: body.action === 'archivePost' ? 'archived' : 'draft', published_html: null });
      return res.status(200).json({ page: pageView(saved) });
    }

    default:
      return res.status(400).json({ error: { code: 'action' } });
  }
}

module.exports = tg.ucuSar(handler, '/api/atlas-site');
module.exports.cleanInfo = cleanInfo;
