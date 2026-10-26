/**
 * Cloudflare Worker — <alt-alan>.atlasasistan.com → Vercel'deki klinik sitesi.
 *
 * atlasasistan.com DNS'i Cloudflare'da; Vercel'in wildcard alan adı Vercel
 * nameserver'ı ister. Bu Worker alt alan adı isteğini
 * https://atlasasistan.com/s/<alt-alan> adresine aktarır (Vercel sunar, CDN önbelleğiyle).
 *
 * Kurulum: tools/cloudflare/README.md. Rota: *.atlasasistan.com/*
 * Yalnız GET/HEAD ve yalnız "/" (+ robots.txt); başka yol 404. www ve ayrılmış
 * adlar dokunulmadan geçer (Worker rotası onları da yakalarsa asıl sunucuya gider).
 */
const ROOT = 'atlasasistan.com';
const PASS_THROUGH = new Set(['www', 'panel', 'api', 'mail']);
const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    if (!host.endsWith('.' + ROOT)) return fetch(request);
    const sub = host.slice(0, -(ROOT.length + 1));
    if (PASS_THROUGH.has(sub) || sub.includes('.')) return fetch(request);
    if (!SUB_RE.test(sub)) return new Response('Bulunamadı', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });

    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname !== '/') return Response.redirect('https://' + host + '/', 301);

    const upstream = await fetch('https://' + ROOT + '/s/' + sub, {
      method: request.method,
      headers: { 'X-Atlas-Site-Host': host, 'Accept': 'text/html' },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
};
