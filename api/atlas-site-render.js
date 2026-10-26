'use strict';

/**
 * Yayındaki klinik sitesi — herkese açık.
 *
 *   GET /s/<alt-alan>                      (vercel.json → ?sub=<alt-alan>)
 *   GET /api/atlas-site-render?sub=<alt-alan>
 *   <alt-alan>.atlasasistan.com → Cloudflare Worker (tools/cloudflare/) → buraya,
 *     X-Atlas-Site-Host başlığıyla.
 *
 * Yalnız ONAYLANIP yayınlanmış anlık görüntü (published_html) sunulur; taslak
 * asla. Sıkı CSP: betik yok, görseller yalnız kendi kovası. atlasasistan.com/s/
 * adresinden gelen istek noindex (asıl adres alt alan adı; kopya içerik olmasın).
 */

const store = require('./_atlas/site/store.js');
const slug = require('./_atlas/site/slug.js');
const { esc } = require('./_atlas/site/render.js');

function csp() {
  const sb = (function () { try { return new URL(process.env.SUPABASE_URL || '').origin; } catch (e) { return ''; } })();
  return [
    "default-src 'none'", "img-src " + (sb || "'none'") + " data:", "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"
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

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end(); }
  const sub = String((req.query && req.query.sub) || '').toLowerCase();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', csp());
  if (slug.check(sub)) return notFound(res, '');

  const row = await store.getPublished(sub);
  if (!row || !row.published_html) return notFound(res, sub);

  const viaSubdomain = String((req.headers && req.headers['x-atlas-site-host']) || '') === sub + '.atlasasistan.com';
  if (!viaSubdomain) res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
  return res.status(200).send(req.method === 'HEAD' ? '' : row.published_html);
}

module.exports = handler;
