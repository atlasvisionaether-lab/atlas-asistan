/**
 * Cloudflare Worker — <alt-alan>.atlasasistan.com → Vercel'deki klinik sitesi.
 *
 * atlasasistan.com DNS'i Cloudflare'da; Vercel'in wildcard alan adı Vercel
 * nameserver'ı ister. Bu Worker alt alan adı isteğini
 * https://atlasasistan.com/s/<alt-alan>/<sayfa> adresine aktarır (Vercel sunar, CDN önbelleğiyle).
 *
 * Kurulum: tools/cloudflare/README.md. Rota: *.atlasasistan.com/*
 * Yalnız GET/HEAD; "/", tek düzeyli sayfa (VIP: hizmet/bölge/blog), sitemap.xml
 * ve robots.txt. Sondaki "/" atılır; daha derin yol ana sayfaya yönlenir. www ve
 * ayrılmış adlar dokunulmadan geçer (Worker rotası onları da yakalarsa asıl sunucuya gider).
 * h=1: alt alan sürümü (<base href="/">, indekslenir) yedek adresinkinden ayrı önbelleklensin.
 */
const ROOT = 'atlasasistan.com';
const PASS_THROUGH = new Set(['www', 'panel', 'api', 'mail']);
const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const PAGE_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?|sitemap\.xml|robots\.txt)$/;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    if (!host.endsWith('.' + ROOT)) return fetch(request);
    const sub = host.slice(0, -(ROOT.length + 1));
    if (PASS_THROUGH.has(sub) || sub.includes('.')) return fetch(request);
    if (!SUB_RE.test(sub)) return new Response('Bulunamadı', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });

    const page = url.pathname.slice(1).replace(/\/+$/, '').toLowerCase();
    if (page && !PAGE_RE.test(page)) return Response.redirect('https://' + host + '/', 301);
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) return Response.redirect('https://' + host + '/' + page, 301);

    const upstream = await fetch('https://' + ROOT + '/s/' + sub + (page ? '/' + page : '') + '?h=1', {
      method: request.method,
      headers: { 'X-Atlas-Site-Host': host, 'Accept': 'text/html' },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
};
