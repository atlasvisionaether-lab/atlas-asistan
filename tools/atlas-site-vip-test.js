'use strict';
/**
 * VIP çok sayfalı site — hizmet/bölge sayfaları, blog, sunum (alt sayfa, sitemap, robots).
 *
 *   node tools/atlas-site-vip-test.js
 *
 * Ağ yok: sahte Supabase (PostgREST tabloları bellekte; upsert on_conflict
 * anahtarıyla) ve sahte DeepSeek (SSE). VIP kapısı, kapı sayfası önlemi,
 * sağlık iddiası kapısı, yazı başına onay ve paket düşünce yayından inme dahil.
 */

const ORG = '00000000-0000-4000-a000-00000000000a';
const U_OWNER = '00000000-0000-4000-a000-0000000000a1';
const U_RECEP = '00000000-0000-4000-a000-0000000000a2';
const OWNER = 'Bearer ' + 'o'.repeat(40);
const RECEP = 'Bearer ' + 'r'.repeat(40);

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxxxxxx',
  DEEPSEEK_API_KEY: 'sk-deepseek-test-key-0123456789abcdef'
});
delete process.env.ANTHROPIC_API_KEY; delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.ATLAS_PANEL_URL;

const T = {
  clinic_sites: [],
  clinic_site_pages: [],
  organizations: [{ id: ORG, name: 'Işıl Güzellik', plan: 'pro' }],
  atlas_orders: [],
  services: [{ organization_id: ORG, name: 'Lazer Epilasyon', price: 2500, duration_min: 45, is_active: true }, { organization_id: ORG, name: 'Cilt Bakımı', price: 1500, duration_min: 60, is_active: true }],
  channel_connections: []
};
const DEFAULTS = {
  clinic_sites: { template: 'nebula', accent: '#fbbf24', info: {}, photos: [], status: 'draft', generations_count: 0, content_issues: [], regions: [] },
  clinic_site_pages: { status: 'draft', issues: [], content: null, published_html: null }
};
let aiReplies = [];
let aiCalls = 0;

function json(status, body) { return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })); }
function sse(text) {
  return Promise.resolve(new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
}
function filterRows(rows, q) {
  return rows.filter(function (r) {
    let ok = true;
    q.forEach(function (v, k) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return;
      if (v.startsWith('eq.') && String(r[k]) !== decodeURIComponent(v.slice(3))) ok = false;
      if (v.startsWith('neq.') && String(r[k]) === decodeURIComponent(v.slice(4))) ok = false;
    });
    return ok;
  });
}

global.fetch = function (url, opts) {
  const u = new URL(String(url));
  const method = (opts && opts.method) || 'GET';
  const headers = (opts && opts.headers) || {};
  if (u.host === 'api.deepseek.com') { aiCalls++; return sse(aiReplies.shift() || '{}'); }
  if (u.host !== 'db.test') return Promise.reject(new Error('beklenmeyen ağ ' + u.href));
  if (u.pathname === '/auth/v1/user') {
    if (headers.Authorization === OWNER) return json(200, { id: U_OWNER });
    if (headers.Authorization === RECEP) return json(200, { id: U_RECEP });
    return json(401, {});
  }
  const path = u.pathname.replace('/rest/v1/', '');
  if (path === 'users') return json(200, [{ organization_id: ORG, role: u.searchParams.get('id').slice(3) === U_OWNER ? 'owner' : 'receptionist' }]);
  const rows = T[path];
  if (!rows) return Promise.reject(new Error('tablo ' + path));
  if (method === 'GET') return json(200, filterRows(rows, u.searchParams).slice(0, Number(u.searchParams.get('limit')) || 1000));
  if (method === 'POST') {
    const b = JSON.parse(opts.body);
    const keys = String(u.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
    let row = keys.length ? rows.find(function (r) { return keys.every(function (k) { return r[k] === b[k]; }); }) : null;
    if (row) Object.assign(row, b); else { row = Object.assign({}, DEFAULTS[path] || {}, b); rows.push(row); }
    return json(201, [row]);
  }
  return Promise.reject(new Error('beklenmeyen ' + method + ' ' + path));
};

const contentLib = require('../api/_atlas/site/content.js');
const pagesLib = require('../api/_atlas/site/pages.js');
const site = require('../api/atlas-site.js');
const siteRender = require('../api/atlas-site-render.js');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? 'ok   ' : 'HATA ') + ad + (ok ? '' : ' — bulunan ' + JSON.stringify(bulunan) + ', beklenen ' + JSON.stringify(beklenen)));
}
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = function (k, v) { res.headers[k.toLowerCase()] = v; };
  res.getHeader = function (k) { return res.headers[k.toLowerCase()]; };
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.send = function (b) { res.body = b; return res; };
  res.end = function () { return res; };
  return res;
}
async function call(handler, req) { const res = fakeRes(); await handler(Object.assign({ headers: {}, query: {} }, req), res); return res; }
const post = (body, auth) => call(site, { method: 'POST', headers: { authorization: auth || OWNER }, body: body });
const get = () => call(site, { method: 'GET', headers: { authorization: OWNER } });
const serve = (page, host, extra) => call(siteRender, { method: 'GET', query: Object.assign({ sub: 'isil', page: page }, extra || {}), headers: host ? { 'x-atlas-site-host': host } : {} });
const page = (slug) => T.clinic_site_pages.find(function (p) { return p.slug === slug; });
const code = (r) => r.body && r.body.error && r.body.error.code;

const NOTE = 'Kadıköy iskelesinden 10 dakika yürüme; binanın önünde ücretli otopark var, Moda yönünden gelenler Bahariye caddesini kullanabilir.';
const SVC_AI = (extra) => JSON.stringify({
  intro: 'Lazer epilasyon hizmetimiz hakkında bilgi alın.' + (extra || ''),
  sections: [{ h: 'Hizmet nedir?', p: 'Uygulama uzmanımız tarafından yapılır.' }, { h: 'Seans nasıl geçer?', p: 'Seans yaklaşık 45 dakika sürer.' }],
  faq: [{ q: 'Kaç seans gerekir?', a: 'Kişiden kişiye değişir; uzmanımız size özel bilgi verir.' }],
  metaDescription: 'Lazer epilasyon — Işıl Güzellik.'
});
const POST_AI = JSON.stringify({
  title: 'Lazer epilasyon öncesi hazırlık', excerpt: 'Randevunuzdan önce bilmeniz gerekenler.',
  sections: [{ h: 'Güneşten korunun', p: 'Randevudan önceki günlerde cildinizi güneşten koruyun.' }, { h: 'Tıraş', p: 'Bir gün önce tıraş olmanız yeterlidir.' }],
  metaDescription: 'Lazer epilasyon randevusuna hazırlık rehberi.'
});

(async function () {
  /* ---- Yardımcılar ---- */
  sina('slug: bölge + hizmet', pagesLib.regionSlug('Kadıköy', 'Lazer Epilasyon'), 'kadikoy-lazer-epilasyon');
  sina('slug: ayrılmış ad hizmete önek alır', pagesLib.serviceSlug('Blog'), 'hizmet-blog');
  sina('slug: blog öneki', pagesLib.blogSlug('Yaz Bakımı: 5 İpucu'), 'blog-yaz-bakimi-5-ipucu');
  sina('bölge: not kısa → region_note', pagesLib.cleanRegions([{ name: 'Kadıköy', service: 'Lazer Epilasyon', note: 'yakın' }], ['Lazer Epilasyon']).error, 'region_note');
  sina('bölge: aynı bölge+hizmet iki kez', pagesLib.cleanRegions([{ name: 'Kadıköy', service: 'Lazer Epilasyon', note: NOTE }, { name: 'kadıköy', service: 'Lazer Epilasyon', note: NOTE }], ['Lazer Epilasyon']).error, 'region_duplicate');
  sina('bölge: 7 bölge → region_limit', pagesLib.cleanRegions('abcdefg'.split('').map(function (c) { return { name: 'Semt ' + c, service: 'Lazer Epilasyon', note: NOTE }; }), ['Lazer Epilasyon']).error, 'region_limit');
  sina('bölge promptu: semt bilgisi yalnız nottan', /TEK KAYNAK/.test(pagesLib.promptRegion('X', {}, { name: 'Kadıköy', service: 'Lazer', note: NOTE }).user), true);

  /* ---- VIP kapısı ---- */
  T.clinic_sites.push(Object.assign({}, DEFAULTS.clinic_sites, {
    organization_id: ORG, subdomain: 'isil',
    content: contentLib.fallback('Işıl Güzellik', {}, T.services)
  }));
  let r = await get();
  sina('GET: VIP değil → vip false, sayfa yok', [r.statusCode, r.body.vip, r.body.pages.length], [200, false, 0]);
  r = await post({ action: 'saveRegions', regions: [] });
  sina('VIP değil: bölge kaydı → 403 vip_required', [r.statusCode, code(r)], [403, 'vip_required']);
  T.atlas_orders.push({ organization_id: ORG, plan: 'vip', status: 'pending' });
  sina('ödenmemiş VIP siparişi yetmez', (await get()).body.vip, false);
  T.atlas_orders[0].status = 'paid';
  r = await get();
  sina('ödenmiş VIP siparişi → vip, hizmet adları, sınırlar', [r.body.vip, r.body.serviceNames.sort(), r.body.vipLimits.regions], [true, ['Cilt Bakımı', 'Lazer Epilasyon'], 6]);
  r = await post({ action: 'saveRegions', regions: [] }, RECEP);
  sina('resepsiyon bölge kaydedemez → 403', r.statusCode, 403);

  /* ---- Bölgeler ---- */
  r = await post({ action: 'saveRegions', regions: [{ name: 'Kadıköy', service: 'Yok Böyle Hizmet', note: NOTE }] });
  sina('bölge: bilinmeyen hizmet → 400', [r.statusCode, code(r)], [400, 'region_service']);
  r = await post({ action: 'saveRegions', regions: [{ name: 'Kadıköy', service: 'Lazer Epilasyon', note: NOTE }, { name: 'Ataşehir', service: 'Cilt Bakımı', note: NOTE }] });
  sina('bölge: kaydedildi, slug üretildi', [r.statusCode, r.body.site.regions.map(function (x) { return x.slug; })], [200, ['kadikoy-lazer-epilasyon', 'atasehir-cilt-bakimi']]);

  /* ---- Hizmet sayfası + sağlık iddiası kapısı ---- */
  aiReplies.push(SVC_AI(' Sonuçlar kalıcıdır.'));
  r = await post({ action: 'generatePage', kind: 'service', key: 'Lazer Epilasyon' });
  sina('hizmet sayfası üretildi; "kalıcı" işaretlendi', [r.statusCode, r.body.page.slug, r.body.page.status, r.body.page.issues.length > 0, r.body.source], [200, 'lazer-epilasyon', 'draft', true, 'ai']);
  r = await post({ action: 'generatePage', kind: 'service', key: 'Pasif Hizmet' });
  sina('hizmet sayfası: bilinmeyen hizmet → 400', code(r), 'service_unknown');
  r = await post({ action: 'publish', approve: true });
  sina('yayın: ek sayfada engel ifade → 400 + sayfa listesi', [r.statusCode, code(r), r.body.pages], [400, 'compliance_pages', ['lazer-epilasyon']]);
  sina('yayın engellenince ana sayfa da yayına çıkmadı', T.clinic_sites[0].status, 'draft');
  const fixed = Object.assign({}, page('lazer-epilasyon').content, { intro: 'Lazer epilasyon hizmetimiz hakkında bilgi alın. Sonuçlar kişiden kişiye değişir.' });
  r = await post({ action: 'savePage', slug: 'lazer-epilasyon', content: fixed });
  sina('düzenleme: engel kalktı', [r.statusCode, r.body.page.issues.length, page('lazer-epilasyon').content.source], [200, 0, 'edited']);
  r = await post({ action: 'savePage', slug: 'lazer-epilasyon', content: { intro: '<script>x</script>Merhaba', sections: [{ h: 'A', p: 'B' }], faq: [], metaDescription: 'm' } });
  sina('düzenleme: < > ayıklanır', page('lazer-epilasyon').content.intro.indexOf('<'), -1);
  await post({ action: 'savePage', slug: 'lazer-epilasyon', content: fixed });

  /* ---- Bölge sayfası (yapay zekâ yanıtsız → nottan yedek) ---- */
  r = await post({ action: 'generatePage', kind: 'region', key: 'kadikoy-lazer-epilasyon' });
  sina('bölge sayfası: yedek metin bölge notunu kullanır', [r.statusCode, r.body.source, page('kadikoy-lazer-epilasyon').content.sections[0].p.indexOf('iskele') !== -1], [200, 'fallback', true]);
  r = await post({ action: 'generatePage', kind: 'region', key: 'besiktas-lazer-epilasyon' });
  sina('bölge sayfası: kaydedilmemiş bölge → 400', code(r), 'region_unknown');

  /* ---- Yayın: ana sayfa + ek sayfalar tek onayla ---- */
  r = await post({ action: 'publish' });
  sina('yayın: onaysız → 400', code(r), 'approval_required');
  r = await post({ action: 'publish', approve: true });
  sina('yayın: 200, ek sayfalar yayında ve onay kaydı', [r.statusCode, page('lazer-epilasyon').status, page('kadikoy-lazer-epilasyon').status, page('lazer-epilasyon').approved_by], [200, 'published', 'published', U_OWNER]);
  sina('yayın: metni olmayan hizmetin sayfası yok', T.clinic_site_pages.some(function (p) { return p.slug === 'cilt-bakimi'; }), false);
  const home = T.clinic_sites[0].published_html;
  sina('ana sayfa: hizmet ve bölge sayfasına bağlantı', [home.indexOf('href="lazer-epilasyon"') !== -1, home.indexOf('href="kadikoy-lazer-epilasyon"') !== -1], [true, true]);
  sina('hizmet sayfası: fiyat veritabanından, canonical alt alanda', [/2\.500/.test(page('lazer-epilasyon').published_html), page('lazer-epilasyon').published_html.indexOf('https://isil.atlasasistan.com/lazer-epilasyon') !== -1], [true, true]);
  sina('bölge sayfası başlığı: bölge + hizmet', /Kadıköy[^<]{0,4}Lazer Epilasyon/.test(page('kadikoy-lazer-epilasyon').published_html), true);

  /* ---- Sunum ---- */
  r = await serve('');
  sina('sunum /s/isil: yedek adres tabanı + noindex', [r.statusCode, r.body.indexOf('<base href="/s/isil/">') !== -1, r.headers['x-robots-tag']], [200, true, 'noindex']);
  r = await serve('', 'isil.atlasasistan.com');
  sina('sunum alt alan: taban "/", indekslenir, Vary', [r.body.indexOf('<base href="/">') !== -1, r.headers['x-robots-tag'], r.headers.vary], [true, undefined, 'X-Atlas-Site-Host']);
  r = await serve('lazer-epilasyon', 'isil.atlasasistan.com');
  sina('sunum: hizmet sayfası', [r.statusCode, r.body === withBase(page('lazer-epilasyon').published_html)], [200, true]);
  r = await serve('kadikoy-lazer-epilasyon');
  sina('sunum: bölge sayfası', r.statusCode, 200);
  sina('sunum: olmayan sayfa → 404', (await serve('yok-boyle')).statusCode, 404);
  sina('sunum: geçersiz sayfa adı → 404', (await serve('../etc')).statusCode, 404);
  r = await serve('sitemap.xml', 'isil.atlasasistan.com');
  sina('sitemap: ana + ek sayfalar, XML', [r.headers['content-type'].indexOf('xml') !== -1, r.body.indexOf('<loc>https://isil.atlasasistan.com/kadikoy-lazer-epilasyon</loc>') !== -1, r.body.indexOf('/blog<') === -1], [true, true, true]);
  r = await serve('robots.txt', 'isil.atlasasistan.com');
  sina('robots alt alan: Sitemap satırı', /Sitemap: https:\/\/isil\.atlasasistan\.com\/sitemap\.xml/.test(r.body), true);
  sina('robots yedek adres: Disallow', /Disallow: \//.test((await serve('robots.txt')).body), true);
  r = await serve('lazer-epilasyon', null, { h: '1' });
  sina('başlıksız h=1 önbelleğe yazılmaz', r.headers['cache-control'], 'no-store');
  r = await serve('lazer-epilasyon', 'isil.atlasasistan.com', { h: '1' });
  sina('Worker isteği önbelleklenir', /s-maxage=300/.test(r.headers['cache-control']), true);

  /* ---- Blog ---- */
  r = await post({ action: 'draftPost', title: 'Kısa' });
  sina('blog: kısa başlık → 400', code(r), 'title');
  r = await post({ action: 'draftPost', title: 'Lazer epilasyon öncesi hazırlık' });
  sina('blog: yapay zekâ yanıtsız → 502, yedek yazı uydurulmaz', [r.statusCode, code(r), !page('blog-lazer-epilasyon-oncesi-hazirlik')], [502, 'llm', true]);
  aiReplies.push(POST_AI);
  r = await post({ action: 'draftPost', title: 'Lazer epilasyon öncesi hazırlık' });
  sina('blog: taslak yazıldı', [r.statusCode, r.body.page.slug, r.body.page.status], [200, 'blog-lazer-epilasyon-oncesi-hazirlik', 'draft']);
  r = await post({ action: 'draftPost', title: 'Lazer epilasyon öncesi hazırlık' });
  sina('blog: aynı başlık → 409', code(r), 'post_exists');
  const slugB = 'blog-lazer-epilasyon-oncesi-hazirlik';
  sina('blog: taslak sunulmaz', (await serve(slugB)).statusCode, 404);
  r = await post({ action: 'publishPost', slug: slugB });
  sina('blog: onaysız yayın → 400', code(r), 'approval_required');
  await post({ action: 'savePage', slug: slugB, content: Object.assign({}, page(slugB).content, { excerpt: 'Garantili sonuç için okuyun.' }) });
  r = await post({ action: 'publishPost', slug: slugB, approve: true });
  sina('blog: engel ifade varken onay da yetmez', [r.statusCode, code(r)], [400, 'compliance']);
  await post({ action: 'savePage', slug: slugB, content: Object.assign({}, page(slugB).content, { excerpt: 'Randevunuzdan önce bilmeniz gerekenler.' }) });
  r = await post({ action: 'publishPost', slug: slugB, approve: true });
  sina('blog: onayla yayında, onay kaydı', [r.statusCode, page(slugB).status, page(slugB).approved_by, page(slugB).published_html.indexOf('tıbbi tavsiye yerine geçmez') !== -1], [200, 'published', U_OWNER, true]);
  r = await serve(slugB);
  sina('sunum: blog yazısı', r.statusCode, 200);
  r = await serve('blog', 'isil.atlasasistan.com');
  sina('sunum: blog dizini yazıyı listeler', [r.statusCode, r.body.indexOf('href="' + slugB + '"') !== -1, r.body.indexOf('<base href="/">') !== -1], [200, true, true]);
  r = await serve('sitemap.xml', 'isil.atlasasistan.com');
  sina('sitemap: blog dizini ve yazı', [r.body.indexOf('/blog</loc>') !== -1, r.body.indexOf(slugB) !== -1], [true, true]);
  r = await post({ action: 'unpublishPost', slug: slugB });
  sina('blog: yayından kaldırıldı → sunulmaz', [r.body.page.status, (await serve(slugB)).statusCode], ['draft', 404]);
  r = await post({ action: 'archivePost', slug: slugB });
  sina('blog: arşivlenen panel listesinde yok (silinmez)', [(await get()).body.pages.some(function (p) { return p.slug === slugB; }), !!page(slugB)], [false, true]);

  /* ---- Bölge kaldırma, pasif hizmet ---- */
  r = await post({ action: 'saveRegions', regions: [{ name: 'Ataşehir', service: 'Cilt Bakımı', note: NOTE }] });
  sina('bölge kaldırıldı → sayfası arşivde, sunulmaz', [page('kadikoy-lazer-epilasyon').status, (await serve('kadikoy-lazer-epilasyon')).statusCode], ['archived', 404]);
  T.services[0].is_active = false;
  r = await post({ action: 'publish', approve: true });
  sina('pasifleşen hizmetin sayfası yeniden yayında yayından iner', [r.statusCode, page('lazer-epilasyon').status, (await serve('lazer-epilasyon')).statusCode], [200, 'draft', 404]);
  T.services[0].is_active = true;
  await post({ action: 'publish', approve: true });

  /* ---- Günlük sınır ---- */
  const before = aiCalls;
  T.clinic_sites[0].generations_day = new Date().toISOString().slice(0, 10);
  T.clinic_sites[0].generations_count = 60;
  r = await post({ action: 'generatePage', kind: 'service', key: 'Cilt Bakımı' });
  sina('VIP günlük sınır (60) → 429, yapay zekâ çağrılmaz', [r.statusCode, code(r), aiCalls], [429, 'limit', before]);

  /* ---- Paket düşerse ek sayfalar yayından iner ---- */
  T.atlas_orders[0].status = 'cancelled';
  sina('VIP bitti: ek sayfa 404, ana sayfa açık', [(await serve('lazer-epilasyon')).statusCode, (await serve('')).statusCode], [404, 200]);
  r = await post({ action: 'generatePage', kind: 'service', key: 'Cilt Bakımı' });
  sina('VIP bitti: üretim 403', code(r), 'vip_required');
  r = await serve('sitemap.xml', 'isil.atlasasistan.com');
  sina('VIP bitti: sitemap yalnız ana sayfa', (r.body.match(/<loc>/g) || []).length, 1);

  console.log(hata ? '\n' + hata + ' HATA' : '\nTümü geçti');
  process.exit(hata ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });

function withBase(html) { return html.replace(/<head>/i, '<head><base href="/">'); }
