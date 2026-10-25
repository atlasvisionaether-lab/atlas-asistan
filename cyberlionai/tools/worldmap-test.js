'use strict';

/**
 * Tarama haritası sınamaları (api/_lib/feeds.js, api/_lib/ownmap.js,
 * api/worldmap.js). Ağa ÇIKMAZ.
 *
 *   node tools/worldmap-test.js
 *
 * Sabitlenen:
 *   - Tek dış kaynak Tor (abuse.ch / PhishTank kaldırıldı: 410/404 ve ticari
 *     kullanım koşulu). Tor SAYAÇ: haritada işaret değil (anonimlik ağı).
 *   - İşaretler kendi taramalarımızdan: site başına EN YENİ tarama bir kez;
 *     yalnızca ağırlıklı (critical/high/medium) başarısız bulgular sayılır.
 *   - Gizlilik: yanıtta host yok; eşik altı ülkede bulgu dağılımı yok ve o
 *     ülkenin bulguları genel listeye de karışmıyor.
 *   - Zaman pencereleri scanned_at'ten; gelecekteki/bozuk damga sayılmaz.
 *   - Bölüm, eşik aşılana kadar gizli (summary=1 → ready:false).
 *   - Veritabanı düşerse harita yine çizilir; sebep yazılır.
 */

const path = require('node:path');
const Module = require('node:module');
const API = path.join(__dirname, '..', 'api');
const feeds = require(path.join(API, '_lib', 'feeds.js'));
const ownmap = require(path.join(API, '_lib', 'ownmap.js'));

let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (b === e) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }
function sapla(rel, govde) { const tam = require.resolve(path.join(API, rel)); const m = new Module(tam, null); m.filename = tam; m.loaded = true; m.exports = govde; require.cache[tam] = m; }

/* --- Kaynaklar --- */
esit('tek dış kaynak Tor', feeds.SOURCES.map(function (s) { return s.id; }).join(), 'torexit');
esit('Tor haritada işaret değil', feeds.findSource('torexit').geo, false);
const tor = feeds.findSource('torexit').parse('171.25.193.25\n80.67.167.81\n\n# yorum\n198.98.51.189\n');
esit('Tor: yorum ve boş satır sayılmaz', tor.total, 3);

/* --- Kendi taramalarımız --- */
const NOW = Date.parse('2026-10-25T12:00:00Z');
const H = 3600e3;
function satir(host, cc, onceMs, bulgular) {
  return { host: host, country: cc, scanned_at: new Date(NOW - onceMs).toISOString(), findings: bulgular || [] };
}
const HSTS = { id: 'hsts', severity: 'high', status: 'fail' };
const CSP = { id: 'csp', severity: 'critical', status: 'fail' };
const SPF = { id: 'spf', severity: 'info', status: 'fail' };
const GECTI = { id: 'hsts', severity: 'high', status: 'pass' };

const a = ownmap.aggregate([
  satir('A.com', 'US', 0.5 * H, [HSTS, SPF]),
  satir('a.com', 'US', 400 * H, [CSP]),              // aynı site, eski tarama: sayılmaz
  satir('b.com', 'US', 10 * H, [GECTI]),
  satir('c.com', 'US', 100 * H, [HSTS, CSP]),
  satir('d.de', 'DE', 0.5 * H, [CSP]),               // eşik altı ülke
  satir('e.com', 'XX1', 1, [HSTS]),                  // bozuk ülke kodu
  satir('f.com', 'TR', -5 * H, []),                  // gelecekteki damga
  { host: 'g.com', country: 'TR', scanned_at: 'bozuk', findings: [] }
], NOW);
const us = a.countries.find(function (c) { return c.country === 'US'; });
const de = a.countries.find(function (c) { return c.country === 'DE'; });
esit('site başına bir kez (büyük/küçük harf aynı)', a.total, 6);
esit('bozuk ülke kodu atlanır', a.countries.some(function (c) { return c.country === 'XX1'; }), false);
esit('US site sayısı', us.count, 3);
esit('pencere 1s', us.windows.h1, 1);
esit('pencere 24s', us.windows.h24, 2);
esit('pencere 7g', us.windows.d7, 3);
esit('sorunlu site sayısı', us.withIssues, 2);
esit('info bulgu sayılmaz, eski tarama sayılmaz', JSON.stringify(us.threats), JSON.stringify([{ name: 'Strict-Transport-Security', count: 2 }, { name: 'Content-Security-Policy', count: 1 }]));
esit('eşik altı ülkede bulgu yok', de.threats, undefined);
esit('eşik altı ülkede sorunlu sayısı yok', de.withIssues, undefined);
esit('eşik altı ülke genel listeye karışmaz (CSP yalnız 1)', a.threats.find(function (t) { return t.name === 'Content-Security-Policy'; }).count, 1);
const tr = a.countries.find(function (c) { return c.country === 'TR'; });
esit('gelecek/bozuk damga pencereye girmez', tr.windows.d7, 0);
esit('yanıtta host yok', /\b[a-g]\.(com|de)\b/i.test(JSON.stringify(a)), false);

/* --- Hazırlık eşiği --- */
esit('az veri → hazır değil', ownmap.ready(a), false);
const cok = [];
for (let i = 0; i < ownmap.HAZIR_SITE; i++) cok.push(satir('s' + i + '.com', 'C' + String.fromCharCode(65 + (i % ownmap.HAZIR_ULKE)), H, []));
esit('eşik aşıldı → hazır', ownmap.ready(ownmap.aggregate(cok, NOW)), true);
const tekUlke = cok.map(function (r) { return Object.assign({}, r, { country: 'US' }); });
esit('çok site ama tek ülke → hazır değil', ownmap.ready(ownmap.aggregate(tekUlke, NOW)), false);

/* --- Uç: summary, gizlilik, dayanıklılık --- */
(async function () {
  const onbellek = {};
  let dbSatirlar = [satir('a.com', 'US', H, [HSTS]), satir('b.com', 'US', H, [HSTS]), satir('c.com', 'US', H, [])];
  let dbDusuk = false;
  sapla('_lib/store.js', {
    isConfigured: function () { return true; },
    hitRateLimit: async function () { return { count: 1, ttl: 60 }; },
    cacheGet: async function (k) { return onbellek[k] ? JSON.parse(onbellek[k]) : null; },
    cacheSet: async function (k, v) { onbellek[k] = JSON.stringify(v); }
  });
  sapla('_lib/db.js', {
    isConfigured: function () { return true; },
    recentScansForMap: async function () { if (dbDusuk) throw new Error('db'); return dbSatirlar; }
  });
  sapla('_lib/feeds.js', Object.assign({}, feeds, {
    SOURCES: feeds.SOURCES,
    loadSource: async function (s) { return { id: s.id, label: s.label, attribution: s.attribution, geo: s.geo, ok: true, fetchedAt: 'x', data: tor }; }
  }));
  const handler = require(path.join(API, 'worldmap.js'));
  function istek(query) {
    const req = { method: 'GET', query: query || {}, headers: { 'x-vercel-forwarded-for': '1.2.3.4' } };
    const res = { statusCode: 0, headers: {}, body: null,
      setHeader: function (k, v) { this.headers[k] = v; },
      status: function (n) { this.statusCode = n; return this; },
      json: function (b) { this.body = b; return this; } };
    return handler(req, res).then(function () { return res; });
  }

  const ozet = await istek({ summary: '1' });
  esit('özet 200', ozet.statusCode, 200);
  esit('özet: hazır değil', ozet.body.ready, false);
  esit('özet: site sayısı', ozet.body.sites, 3);
  esit('özet: besleme alanı yok', ozet.body.markers, undefined);

  const tam = await istek({});
  esit('harita 200', tam.statusCode, 200);
  esit('işaretler kendi verimizden', tam.body.markers.map(function (m) { return m.country; }).join(), 'US');
  esit('Tor işaretlere karışmıyor', tam.body.markers[0].sources.map(function (s) { return s.id; }).join(), 'cyberlion');
  esit('Tor sayaç olarak kaynaklarda', tam.body.sources.some(function (s) { return s.id === 'torexit' && s.ok && s.geo === false; }), true);
  esit('zaman filtresi kendi verimizi kapsıyor', tam.body.sources.find(function (s) { return s.id === 'cyberlion'; }).supportsWindows, true);
  esit('bulgu filtresi dolu', tam.body.threatTypes[0].name, 'Strict-Transport-Security');
  esit('ayrı eski katman kapalı', tam.body.ownActivity.available, false);
  esit('harita yanıtında host yok', /\b[abc]\.com\b/.test(JSON.stringify(tam.body)), false);

  /* Veritabanı düşerse: önbellek boşaltılıp yeniden sorulur */
  Object.keys(onbellek).forEach(function (k) { delete onbellek[k]; });
  dbDusuk = true;
  const dusuk = await istek({});
  esit('db düşerse harita yine 200', dusuk.statusCode, 200);
  esit('db düşerse sebep yazılır', dusuk.body.sources.find(function (s) { return s.id === 'cyberlion'; }).error, 'query_failed');
  esit('db düşerse işaret yok ama Tor var', dusuk.body.markers.length === 0 && dusuk.body.sources.some(function (s) { return s.id === 'torexit' && s.ok; }), true);
  const dusukOzet = await istek({ summary: '1' });
  esit('db düşerse bölüm gizli kalır', dusukOzet.body.ready, false);

  if (hatalar.length) { console.error('Harita sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
  console.log('Harita sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (e) { console.error('sınama çöktü:', e && e.stack || e); process.exit(1); });
