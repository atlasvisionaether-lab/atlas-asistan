'use strict';
/**
 * Görev 7 — klinik web sitesi: /api/atlas-site + /api/atlas-site-render + yardımcılar.
 *
 *   node tools/atlas-site-test.js
 *
 * Ağ yok: sahte Supabase (PostgREST tabloları bellekte, Auth, Storage) ve sahte
 * DeepSeek (SSE). Yapay zekânın uydurduğu hizmet/fiyat ve sağlık iddiası
 * senaryoları dahil.
 */

const ORG = '00000000-0000-4000-a000-00000000000a';
const ORG_B = '00000000-0000-4000-a000-00000000000b';
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
  clinic_sites: [{ organization_id: ORG_B, subdomain: 'baska-klinik', template: 'nebula', accent: '#fbbf24', info: {}, photos: [], status: 'published', published_html: '<p>B</p>', generations_count: 0 }],
  organizations: [{ id: ORG, name: 'Işıl Güzellik' }],
  services: [{ organization_id: ORG, name: 'Lazer Epilasyon', price: 2500, duration_min: 45, is_active: true }, { organization_id: ORG, name: 'Cilt Bakımı', price: '1500', duration_min: 60, is_active: true }, { organization_id: ORG, name: 'Eski Hizmet', price: 1, is_active: false }],
  atlas_orders: [],
  channel_connections: [{ organization_id: ORG, channel: 'telegram', status: 'connected', display_name: '@isil_klinik_bot' }]
};
let storageCalls = [];
let aiReplies = [];

function json(status, body) { return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })); }
function sse(text) {
  return Promise.resolve(new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
}
function filterRows(rows, q) {
  return rows.filter(function (r) {
    let ok = true;
    q.forEach(function (v, k) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return;
      if (v.startsWith('eq.')) { if (String(r[k]) !== decodeURIComponent(v.slice(3))) ok = false; }
    });
    return ok;
  });
}

global.fetch = function (url, opts) {
  const u = new URL(String(url));
  const method = (opts && opts.method) || 'GET';
  const headers = (opts && opts.headers) || {};
  if (u.host === 'api.deepseek.com') {
    const body = JSON.parse(opts.body);
    const isFaq = /sık sorulan/i.test(body.messages[0].content);
    return sse(isFaq ? JSON.stringify({ faq: [{ q: 'Nasıl randevu alırım?', a: 'Bize yazmanız yeterli.' }] }) : aiReplies.shift() || '{}');
  }
  if (u.host !== 'db.test') return Promise.reject(new Error('beklenmeyen ağ ' + u.href));
  if (u.pathname === '/auth/v1/user') {
    if (headers.Authorization === OWNER) return json(200, { id: U_OWNER });
    if (headers.Authorization === RECEP) return json(200, { id: U_RECEP });
    return json(401, {});
  }
  if (u.pathname.startsWith('/storage/v1/object/clinic-sites/')) {
    storageCalls.push({ method, path: u.pathname.replace('/storage/v1/object/clinic-sites/', ''), type: headers['Content-Type'] });
    return json(200, { Key: 'x' });
  }
  const path = u.pathname.replace('/rest/v1/', '');
  if (path === 'users') return json(200, [{ organization_id: ORG, role: u.searchParams.get('id').slice(3) === U_OWNER ? 'owner' : 'receptionist' }]);
  const rows = T[path];
  if (!rows) return Promise.reject(new Error('tablo ' + path));
  if (method === 'GET') return json(200, filterRows(rows, u.searchParams).slice(0, Number(u.searchParams.get('limit')) || 1000));
  if (method === 'POST') {
    const b = JSON.parse(opts.body);
    let row = rows.find(function (r) { return r.organization_id === b.organization_id; });
    if (row) Object.assign(row, b); else { row = Object.assign({ template: 'nebula', accent: '#fbbf24', info: {}, photos: [], status: 'draft', generations_count: 0, content_issues: [] }, b); rows.push(row); }
    return json(201, [row]);
  }
  return Promise.reject(new Error('beklenmeyen ' + method + ' ' + path));
};

const slug = require('../api/_atlas/site/slug.js');
const compliance = require('../api/_atlas/site/compliance.js');
const store = require('../api/_atlas/site/store.js');
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
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.send = function (b) { res.body = b; return res; };
  res.end = function () { return res; };
  return res;
}
async function call(handler, req) { const res = fakeRes(); await handler(Object.assign({ headers: {}, query: {} }, req), res); return res; }
const post = (body, auth) => call(site, { method: 'POST', headers: { authorization: auth || OWNER }, body: body });
const mine = () => T.clinic_sites.find(function (r) { return r.organization_id === ORG; });
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');
const JPG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');

(async function () {
  /* ---- Yardımcılar ---- */
  sina('alt alan: Türkçe ad → öneri', slug.suggest('Işıl Güzellik & Lazer'), 'isil-guzellik-lazer');
  sina('alt alan: ayrılmış / biçim', [slug.check('www'), slug.check('panel'), slug.check('-x-'), slug.check('ab'), slug.check('a--b'), slug.check('isil-guzellik')], ['reserved', 'reserved', 'format', 'format', 'format', null]);
  sina('denetim: riskli ifadeler yakalanır', ['Sonuç garantili', '%100 etkili', 'Kadıköy\'ün en iyi kliniği', 'Acısız lazer', 'öncesi / sonrası', 'Kalıcı çözüm', 'Son fırsat!'].map(function (t) { return compliance.scan(t).length > 0; }), [true, true, true, true, true, true, true]);
  sina('denetim: temiz metin geçer', compliance.scan('Kadıköy’de butik ve özenli bir güzellik deneyimi; sonuçlar kişiden kişiye değişebilir.').length, 0);
  sina('görsel: PNG/JPEG imzası tanınır', [store.decodeImage(PNG).ext, store.decodeImage(JPG).ext], ['png', 'jpg']);
  sina('görsel: SVG/GIF/HTML ve imzası tutmayan reddedilir', [
    store.decodeImage('data:image/svg+xml;base64,' + Buffer.from('<svg onload=1>').toString('base64')).error,
    store.decodeImage('data:image/png;base64,' + Buffer.from('GIF89a').toString('base64')).error,
    store.decodeImage('data:image/jpeg;base64,' + Buffer.from('<html>').toString('base64')).error], ['format', 'format', 'format']);
  sina('görsel: 2 MB üstü reddedilir', store.decodeImage('data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]).toString('base64')).error, 'too_large');

  /* ---- Panel ucu: yetki ---- */
  let r = await call(site, { method: 'GET', headers: {} });
  sina('panel: oturumsuz → 401', r.statusCode, 401);
  r = await call(site, { method: 'GET', headers: { authorization: RECEP } });
  sina('panel: resepsiyon görür, öneri ve aktif hizmet sayısı', [r.statusCode, r.body.canManage, r.body.suggested, r.body.services], [200, false, 'isil-guzellik', 2]);
  r = await post({ action: 'save', subdomain: 'isil-guzellik' }, RECEP);
  sina('panel: resepsiyon kaydedemez → 403', r.statusCode, 403);

  /* ---- Bilgiler ---- */
  r = await post({ action: 'save', subdomain: 'www' });
  sina('kaydet: ayrılmış ad → 400', r.body.error.code, 'subdomain_reserved');
  r = await post({ action: 'save', subdomain: 'baska-klinik' });
  sina('kaydet: başka kliniğin adresi → 409', [r.statusCode, r.body.error.code], [409, 'subdomain_taken']);
  r = await post({ action: 'generate' });
  sina('metin: kayıtsız → save_first', r.body.error.code, 'save_first');
  r = await post({ action: 'save', subdomain: 'isil-guzellik', template: 'yok', accent: 'red;}', info: { phone: '0532 123 45 67', city: 'İstanbul', district: 'Kadıköy', address: 'Bağdat Cad. 45', instagram: '@isilguzellik', hacker: '<x>', aboutNotes: 'Butik bir merkez.' } });
  sina('kaydet: geçersiz şablon/renk varsayılana, bilinmeyen alan atılır', [r.statusCode, r.body.site.template, r.body.site.accent, 'hacker' in r.body.site.info, r.body.site.info.instagram], [200, 'nebula', '#fbbf24', false, 'isilguzellik']);

  /* ---- Görseller ---- */
  r = await post({ action: 'upload', kind: 'photo', data: JPG, alt: 'Salon' });
  sina('yükle: fotoğraf kurum klasörüne, doğru tür', [r.statusCode, storageCalls[0].method, /^0{8}-0{4}-4000-a000-0{11}a\/photo-[0-9a-f]{12}\.jpg$/.test(storageCalls[0].path), storageCalls[0].type], [200, 'POST', true, 'image/jpeg']);
  r = await post({ action: 'upload', kind: 'photo', data: 'data:image/svg+xml;base64,PHN2Zz4=' });
  sina('yükle: SVG → 400', [r.statusCode, r.body.error.code], [400, 'image_format']);
  r = await post({ action: 'upload', kind: 'logo', data: PNG });
  sina('yükle: logo PNG', [r.statusCode, /\/logo-[0-9a-f]{12}\.png$/.test(r.body.site.logo.path)], [200, true]);
  const photoPath = mine().photos[0].path;
  r = await post({ action: 'removePhoto', path: photoPath });
  sina('fotoğraf kaldır: kovadan da silinir', [r.statusCode, mine().photos.length, storageCalls.some(function (c) { return c.method === 'DELETE' && c.path === photoPath; })], [200, 0, true]);

  /* ---- Metin: yapay zekâ uydurursa ---- */
  aiReplies.push(JSON.stringify({
    heroTitle: 'Kadıköy\'ün en iyi güzellik merkezi', heroSubtitle: 'Sonuç garantili bakımlar.', about: 'Butik bir merkez.', ctaLabel: 'Randevu alın', metaDescription: 'Kadıköy güzellik.',
    services: [{ name: 'lazer epilasyon', description: 'Düzenli seanslarla uygulanır. Sadece 999 TL!' }, { name: 'Uydurma Botoks', description: 'yok' }]
  }));
  r = await post({ action: 'generate' });
  const ct = mine().content;
  sina('metin: üretildi (ai)', [r.statusCode, r.body.source], [200, 'ai']);
  sina('metin: hizmetler YALNIZ veritabanından (uydurma atıldı, adlar aynen)', ct.services.map(function (s) { return s.name; }).sort(), ['Cilt Bakımı', 'Lazer Epilasyon']);
  sina('metin: sağlık iddiaları işaretlendi', mine().content_issues.map(function (i) { return i.id; }).sort(), ['garanti', 'ustunluk']);
  r = await post({ action: 'publish', approve: true });
  sina('yayın: denetim bulgusu varken engellenir', [r.statusCode, r.body.error.code], [400, 'compliance']);

  /* ---- Klinik düzenler, onaysız / onaylı yayın ---- */
  const edited = Object.assign({}, ct, { heroTitle: 'Işıltınızı yeniden keşfedin', heroSubtitle: 'Kadıköy’de özenli bir güzellik deneyimi.' });
  r = await post({ action: 'saveContent', content: edited });
  sina('düzenle: bulgular temizlendi', [r.statusCode, r.body.site.issues.length], [200, 0]);
  r = await post({ action: 'publish' });
  sina('yayın: onaysız → 400', r.body.error.code, 'approval_required');
  r = await post({ action: 'publish', approve: true });
  const pub = mine();
  sina('yayın: onaylı → yayında, onaylayan kayıtlı', [r.statusCode, pub.status, pub.approved_by, !!pub.approved_at], [200, 'published', U_OWNER, true]);
  sina('yayın HTML: fiyat veritabanından, modelin "999 TL"si değil', [pub.published_html.includes('₺2.500'), pub.published_html.includes('₺1.500')], [true, true]);
  sina('yayın HTML: bağlı Telegram botu ve WhatsApp bağlantısı', [pub.published_html.includes('https://t.me/isil_klinik_bot'), pub.published_html.includes('https://wa.me/905321234567')], [true, true]);
  sina('yayın HTML: pasif hizmet yok', pub.published_html.includes('Eski Hizmet'), false);

  r = await post({ action: 'save', subdomain: 'yeni-adres' });
  sina('yayındayken adres değişmez → 409', r.body.error.code, 'unpublish_first');

  /* ---- Sunum ucu ---- */
  r = await call(siteRender, { method: 'GET', query: { sub: 'isil-guzellik' } });
  sina('sunum: /s/ yolu → 200, onaylanan HTML birebir (+ base href)', [r.statusCode, r.body === pub.published_html.replace(/<head>/i, '<head><base href="/s/' + pub.subdomain + '/">')], [200, true]);
  sina('sunum: CSP betik yok + noindex (yol adresi)', [/default-src 'none'/.test(r.headers['content-security-policy']), !/script-src/.test(r.headers['content-security-policy']), r.headers['x-robots-tag']], [true, true, 'noindex']);
  r = await call(siteRender, { method: 'GET', query: { sub: 'isil-guzellik' }, headers: { 'x-atlas-site-host': 'isil-guzellik.atlasasistan.com' } });
  sina('sunum: alt alan adından → indekslenebilir', r.headers['x-robots-tag'], undefined);
  r = await call(siteRender, { method: 'GET', query: { sub: 'yok-boyle' } });
  sina('sunum: yayında olmayan → 404', r.statusCode, 404);
  r = await call(siteRender, { method: 'GET', query: { sub: '../etc' } });
  sina('sunum: geçersiz ad → 404', r.statusCode, 404);
  r = await post({ action: 'unpublish' });
  r = await call(siteRender, { method: 'GET', query: { sub: 'isil-guzellik' } });
  sina('yayından kaldır → sunum 404', r.statusCode, 404);

  /* ---- Sınırlar ---- */
  mine().generations_day = new Date().toISOString().slice(0, 10); mine().generations_count = 10;
  r = await post({ action: 'generate' });
  sina('metin: günlük sınır → 429', r.statusCode, 429);
  mine().generations_count = 0;
  T.services.forEach(function (s) { s.is_active = false; });
  r = await post({ action: 'generate' });
  sina('metin: aktif hizmet yoksa → no_services', r.body.error.code, 'no_services');

  console.log(hata ? '\n' + hata + ' sınama BAŞARISIZ' : '\nTümü geçti');
  process.exit(hata ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
