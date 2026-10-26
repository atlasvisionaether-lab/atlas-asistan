'use strict';

/**
 * Yayındaki klinik sitesi — herkese açık.
 *
 *   GET /s/<alt-alan>[/<sayfa>]            (vercel.json → ?sub=<alt-alan>&page=<sayfa>)
 *   GET /api/atlas-site-render?sub=<alt-alan>&page=<sayfa>
 *   <alt-alan>.atlasasistan.com/<sayfa> → Cloudflare Worker (tools/cloudflare/) → buraya,
 *     X-Atlas-Site-Host başlığı ve h=1 ile (önbellek anahtarı ayrı kalsın).
 *
 * <sayfa>: boş (ana sayfa) · VIP hizmet/bölge/blog sayfası slug'ı · blog (dizin,
 * yayındaki yazılardan) · sitemap.xml · robots.txt. Sayfalardaki bağlantılar
 * göreli; sunarken <base href> eklenir (alt alan: "/", yedek adres: "/s/<ad>/").
 *
 * Yalnız ONAYLANIP yayınlanmış anlık görüntü (published_html) sunulur; taslak
 * asla. Sıkı CSP: betik yok, görseller yalnız kendi kovası. atlasasistan.com/s/
 * adresinden gelen istek noindex (asıl adres alt alan adı; kopya içerik olmasın).
 */

const store = require('./_atlas/site/store.js');
const slug = require('./_atlas/site/slug.js');
const { esc, renderBlogIndex, sitemap } = require('./_atlas/site/render.js');

const PAGE_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;   // 0023 slug CHECK ile aynı

function csp() {
  const sb = (function () { try { return new URL(process.env.SUPABASE_URL || '').origin; } catch (e) { return ''; } })();
  return [
    "default-src 'none'", "img-src " + (sb || "'none'") + " data:", "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'"
  ].join('; ');
}

function notFound(res, sub) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(404).send('<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Sayfa bulunamadı</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#05030f;color:#f5f2ff;font:16px system-ui;text-align:center;padding:24px">' +
    '<div><h1 style="font-family:Georgia,serif;font-weight:600">Bu adreste yayında bir site yok</h1><p style="color:#a7a1c4">' + esc(sub || '') +
    '.atlasasistan.com henüz yayınlanmamış ya da kaldırılmış.</p><p><a style="color:#fbbf24" href="https://atlasasistan.com">Atlas Asistan</a></p></div></body></html>');
}

/** Göreli bağlantıların kökü: <head> başına <base href>. */
function withBase(html, href) {
  return String(html).replace(/<head>/i, '<head><base href="' + esc(href) + '">');
}

function send(req, res, status, type, body) {
  res.setHeader('Content-Type', type);
  /* h=1 yalnız Worker'ın adresi; başlıksız gelirse önbelleğe yazılmaz (alt alan sürümü zehirlenmesin). */
  const forged = String((req.query || {}).h || '') === '1' && !req.atlasViaSubdomain;
  res.setHeader('Cache-Control', forged ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=86400');
  return res.status(status).send(req.method === 'HEAD' ? '' : body);
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end(); }
  const q = req.query || {};
  const sub = String(q.sub || '').toLowerCase();
  const page = String(q.page || '').toLowerCase().replace(/\/+$/, '');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', csp());
  res.setHeader('Vary', 'X-Atlas-Site-Host');
  if (slug.check(sub)) return notFound(res, '');
  if (page && page !== 'sitemap.xml' && page !== 'robots.txt' && !PAGE_RE.test(page)) return notFound(res, sub);

  const row = await store.getPublished(sub);
  if (!row || !row.published_html) return notFound(res, sub);

  const viaSubdomain = String((req.headers && req.headers['x-atlas-site-host']) || '') === sub + '.atlasasistan.com';
  const host = 'https://' + sub + '.atlasasistan.com';
  if (!viaSubdomain) res.setHeader('X-Robots-Tag', 'noindex');
  const base = viaSubdomain ? '/' : '/s/' + sub + '/';
  req.atlasViaSubdomain = viaSubdomain;

  if (page === 'robots.txt') {
    return send(req, res, 200, 'text/plain; charset=utf-8', viaSubdomain ? 'User-agent: *\nAllow: /\nSitemap: ' + host + '/sitemap.xml\n' : 'User-agent: *\nDisallow: /\n');
  }
  if (!page) return send(req, res, 200, 'text/html; charset=utf-8', withBase(row.published_html, base));

  /* Ek sayfalar yalnız VIP sürerken sunulur (paket düşerse yayından iner). */
  const vip = await store.isVip(row.organization_id);
  const list = vip ? await store.publishedPages(row.organization_id) : [];

  if (page === 'sitemap.xml') {
    const slugs = list.map(function (p) { return p.slug; });
    if (list.some(function (p) { return p.kind === 'blog'; })) slugs.push('blog');
    return send(req, res, 200, 'application/xml; charset=utf-8', sitemap(host, slugs));
  }
  if (!vip) return notFound(res, sub);

  if (page === 'blog') {
    const [name, channels] = await Promise.all([store.orgName(row.organization_id), store.channelHandles(row.organization_id)]);
    const posts = list.filter(function (p) { return p.kind === 'blog' && p.content; }).map(function (p) {
      return { slug: p.slug, title: p.content.title || p.ref, excerpt: p.content.excerpt || '', date: p.published_at };
    });
    const services = {}, regions = [];
    list.forEach(function (p) {
      if (p.kind === 'service') services[p.ref] = p.slug;
      else if (p.kind === 'region') regions.push({ slug: p.slug, title: String(p.ref || '').split('|').reverse().join(' ').trim() });
    });
    const html = renderBlogIndex(Object.assign({}, row, { name: name || 'Klinik' }), posts, {
      storageBase: store.storageBase(), channels: channels, canonicalBase: host, pages: { services: services, regions: regions, blog: true }
    });
    return send(req, res, 200, 'text/html; charset=utf-8', withBase(html, base));
  }

  const found = await store.getPublishedPage(row.organization_id, page);
  if (!found || !found.published_html) return notFound(res, sub);
  return send(req, res, 200, 'text/html; charset=utf-8', withBase(found.published_html, base));
}

module.exports = handler;
