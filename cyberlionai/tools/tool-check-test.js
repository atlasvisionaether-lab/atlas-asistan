'use strict';

/**
 * Ücretsiz araç sınaması (api/_lib/toolcheck.js + api/tool-check.js). Ağ yok.
 * Sabitlenen (headers): yalnız başlık kontrolleri döner; en fazla 3 bulgu, önem
 * sırasıyla; kalan bulgu sayısı ayrıca verilir; fiyat fixpricing'den gelir;
 * SSRF hatası 400; IP sınırı ana kotadan ayrı ve 10'da keser; önbellek
 * hedefe yeniden gitmez.
 * Sabitlenen (email): SPF + DMARC mail.js ile aynı kararı verir; ham kayıt
 * döner; sorgu tamamlanmadıysa "yok" değil "ölçülemedi"; IP ve var olmayan
 * alan adı 400; ayrı önbellek anahtarı.
 */
const path = require('node:path');
const Module = require('node:module');
const API = path.join(__dirname, '..', 'api');
let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (b === e) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }
function sapla(rel, govde) { const tam = require.resolve(path.join(API, rel)); const m = new Module(tam, null); m.filename = tam; m.loaded = true; m.exports = govde; require.cache[tam] = m; }

function yanit(basliklar, url) {
  return async function () {
    return { response: { headers: new Headers(basliklar), body: null }, finalUrl: new URL(url || 'https://ornek.com/'), chain: [] };
  };
}

const toolcheck = require(path.join(API, '_lib', 'toolcheck.js'));

const KESIN = { ok: true, kesin: true, kod: null };
function posta(spf, dmarc, ek) {
  return async function (host) {
    return Object.assign({ ok: true, alan: String(host).replace(/^www\./, ''), spf: spf, dmarc: dmarc,
      dmarcAd: '_dmarc.ornek.com', spfSorgu: KESIN, dmarcSorgu: KESIN }, ek || {});
  };
}
const POSTA_SAGLAM = posta(['google-site-verification=x', 'v=spf1 include:_spf.google.com -all'], ['v=DMARC1; p=reject']);

const CIPLAK = yanit({ server: 'nginx/1.18.0' });
const SAGLAM = yanit({
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=()',
  server: 'Vercel'
});

(async function () {
  /* --- Kütüphane --- */
  const c = await toolcheck.run('headers', 'ornek.com', { fetch: CIPLAK });
  esit('çıplak site ok', c.ok, true);
  esit('yalnız başlık kontrolleri', c.summary.total, toolcheck.HEADER_IDS.length);
  esit('en fazla 3 bulgu', c.top.length, 3);
  esit('ilk bulgu kritik CSP', c.top[0].id, 'csp');
  esit('ikinci yüksek HSTS', c.top[1].id, 'hsts');
  esit('kalan bulgu sayısı', c.hiddenFailures, c.summary.fail - 3);
  esit('Türkçe ad', c.top[0].name, 'Content-Security-Policy');
  esit('düzeltme önerisi var', typeof c.top[1].fix === 'string' && c.top[1].fix.indexOf('Strict-Transport-Security') === 0, true);
  esit('HSTS düzeltme fiyatı ₺500', c.top[1].fixPrice, 500);
  esit('HTTPS geçti', c.summary.pass >= 1, true);

  const s = await toolcheck.run('headers', 'https://ornek.com', { fetch: SAGLAM });
  esit('sağlam site bulgu yok', s.top.length, 0);
  esit('sağlam site 100 puan', s.score, 100);
  esit('çıplak site puanı düşük', c.score < 50, true);

  esit('bilinmeyen tür', (await toolcheck.run('ssl', 'ornek.com', { fetch: SAGLAM })).code, 'invalid_type');
  esit('boş adres', (await toolcheck.run('headers', '', { fetch: SAGLAM })).code, 'empty');
  esit('özel IP kapıda', (await toolcheck.run('headers', 'http://127.0.0.1', { fetch: SAGLAM })).code, 'blocked_target');
  const dusen = await toolcheck.run('headers', 'ornek.com', { fetch: async function () { throw new Error('blocked_target'); } });
  esit('DNS ile özel IP → blocked_target', dusen.code, 'blocked_target');
  const kopan = await toolcheck.run('headers', 'ornek.com', { fetch: async function () { throw new Error('ECONNRESET'); } });
  esit('bilinmeyen hata → unreachable', kopan.code, 'unreachable');

  /* --- E-posta --- */
  const e1 = await toolcheck.run('email', 'https://www.ornek.com/yol', { mail: POSTA_SAGLAM });
  esit('e-posta ok', e1.ok, true);
  esit('e-posta www soyuldu', e1.host, 'ornek.com');
  esit('iki kontrol', e1.checks.map(function (c) { return c.id; }).join(','), 'spf,dmarc');
  esit('sağlam: ikisi geçti', e1.summary.pass, 2);
  esit('yalnız SPF kaydı gösterilir', e1.checks[0].records.join('|'), 'v=spf1 include:_spf.google.com -all');
  esit('geçen kontrolde fiyat yok', e1.checks[0].fixPrice, null);

  const e2 = await toolcheck.run('email', 'ornek.com', { mail: posta([], []) });
  esit('SPF yok → fail', e2.checks[0].status, 'fail');
  esit('SPF yok notu', e2.checks[0].note, 'spf_missing');
  esit('DMARC yok notu', e2.checks[1].note, 'dmarc_missing');
  esit('DMARC düzeltme önerisi', e2.checks[1].fix.indexOf('v=DMARC1') !== -1, true);
  esit('DNS düzeltme fiyatı ₺1.000', e2.checks[0].fixPrice, 1000);

  const e3 = await toolcheck.run('email', 'ornek.com', { mail: posta(['v=spf1 +all'], ['v=DMARC1; p=none']) });
  esit('+all → nota özel düzeltme', e3.checks[0].fix.indexOf('+all') !== -1, true);
  esit('p=none → izleme notu', e3.checks[1].note, 'dmarc_monitor_only');

  const e4 = await toolcheck.run('email', 'ornek.com', { mail: posta([], [], {
    spfSorgu: { ok: false, kesin: false, kod: 'ETIMEOUT' }, dmarcSorgu: { ok: false, kesin: false, kod: 'ESERVFAIL' } }) });
  esit('zaman aşımı "yok" değil', e4.checks[0].status, 'skipped');
  esit('zaman aşımı notu', e4.checks[1].note, 'not_measured');
  esit('ölçülemeyen başarısız sayılmaz', e4.summary.fail, 0);
  esit('ölçülemeyende fiyat yok', e4.checks[0].fixPrice, null);

  esit('IP → bad_domain', (await toolcheck.run('email', '1.2.3.4', { mail: POSTA_SAGLAM })).code, 'bad_domain');
  esit('IPv6 → bad_domain', (await toolcheck.run('email', 'http://[2001:db8::1]/', { mail: POSTA_SAGLAM })).code, 'bad_domain');
  esit('alan yok', (await toolcheck.run('email', 'yok.com', { mail: async function () { return { ok: false, sebep: 'domain_not_found' }; } })).code, 'domain_not_found');
  esit('çözücü çöktü → dns_failed', (await toolcheck.run('email', 'ornek.com', { mail: async function () { throw new Error('x'); } })).code, 'dns_failed');

  /* --- Uç nokta --- */
  const sayac = {}; const onbellek = {}; let hedefeGidis = 0; let gunluk = 0;
  sapla('_lib/store.js', {
    isConfigured: function () { return true; },
    hitRateLimit: async function (k) { sayac[k] = (sayac[k] || 0) + 1; return { count: sayac[k], ttl: 100 }; },
    cacheGet: async function (k) { return onbellek[k] ? JSON.parse(onbellek[k]) : null; },
    cacheSet: async function (k, v) { onbellek[k] = JSON.stringify(v); }
  });
  sapla('_lib/ownership.js', { logScan: async function () { gunluk += 1; return true; } });
  sapla('_lib/toolcheck.js', {
    TYPES: toolcheck.TYPES,
    run: async function (t, u) { hedefeGidis += 1; return toolcheck.run(t, u, { fetch: CIPLAK, mail: POSTA_SAGLAM }); }
  });
  const handler = require(path.join(API, 'tool-check.js'));

  function istek(govde, ip, method) {
    const req = { method: method || 'POST', body: govde, headers: { 'x-vercel-forwarded-for': ip || '1.2.3.4' } };
    const res = { statusCode: 0, headers: {}, body: null,
      setHeader: function (k, v) { this.headers[k] = v; },
      status: function (n) { this.statusCode = n; return this; },
      json: function (b) { this.body = b; return this; } };
    return handler(req, res).then(function () { return res; });
  }

  esit('GET → 405', (await istek(null, null, 'GET')).statusCode, 405);
  esit('tür yok → 400', (await istek({ url: 'ornek.com' })).statusCode, 400);
  const ozel = await istek({ type: 'headers', url: 'http://10.0.0.1' });
  esit('özel IP → 400 blocked_target', ozel.body.error.code, 'blocked_target');

  const r1 = await istek({ type: 'headers', url: 'ornek.com' });
  esit('ilk istek 200', r1.statusCode, 200);
  esit('ilk istek önbellekten değil', r1.body.cached, undefined);
  esit('günlüğe yazıldı', gunluk, 1);
  const r2 = await istek({ type: 'headers', url: 'https://ornek.com/' });
  esit('ikinci istek önbellekten', r2.body.cached, true);
  esit('hedefe tek gidiş', hedefeGidis, 1);

  const p1 = await istek({ type: 'email', url: 'ornek.com' });
  esit('e-posta 200', p1.statusCode, 200);
  esit('e-posta ayrı önbellek', p1.body.cached, undefined);
  esit('e-posta IP → 400', (await istek({ type: 'email', url: '1.2.3.4' })).statusCode, 400);

  let son;
  for (let i = 0; i < handler.DAILY_MAX + 2; i++) son = await istek({ type: 'headers', url: 'ornek.com' }, '9.9.9.9');
  esit('günlük sınır aşılınca 429', son.statusCode, 429);
  esit('başka IP etkilenmez', (await istek({ type: 'headers', url: 'ornek.com' }, '8.8.8.8')).statusCode, 200);
  esit('ayrı anahtar (ana kota değil)', Object.keys(sayac).every(function (k) { return k.indexOf('cl:rl:tool:') === 0; }), true);

  if (hatalar.length) { console.error('Araç sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
  console.log('Araç sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (e) { console.error('sınama çöktü:', e && e.stack || e); process.exit(1); });
