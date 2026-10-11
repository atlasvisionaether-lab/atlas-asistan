'use strict';
/**
 * Canlı güven rozeti sınaması (api/badge.js). Ağ yok.
 * Sabitlenen: skor yalnızca doğrulanmış + Pro/Enterprise + taranmış alan
 * adında; DNS ile doğrulanan üst alan alt alanı kapsar, dosya kapsamaz;
 * <80 gri; "%100 güvenli" iddiası yok; SVG metni kaçışlı; önbellek 1 saat.
 */
const path = require('node:path');
const Module = require('node:module');
const API = path.join(__dirname, '..', 'api');
let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (b === e) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }
function dogru(ad, k) { if (k) { gecti += 1; return; } hatalar.push(ad); }
function sapla(rel, govde) { const tam = require.resolve(path.join(API, rel)); const m = new Module(tam, null); m.filename = tam; m.loaded = true; m.exports = govde; require.cache[tam] = m; }

const VD = [
  { user_id: 'u1', domain: 'ornek.com', method: 'dns', status: 'verified' },
  { user_id: 'u2', domain: 'dosya.com', method: 'file', status: 'verified' },
  { user_id: 'u3', domain: 'bedava.com', method: 'dns', status: 'verified' }
];
const SUBS = [{ user_id: 'u1' }, { user_id: 'u2' }];
const JOBS = { 'ornek.com': 92, 'api.ornek.com': 64, 'dosya.com': 85, 'www.dosya.com': 99, 'bedava.com': 100 };
function inList(q, key) { const m = new RegExp(key + '=in\\.\\(([^)]*)\\)').exec(q); return m ? m[1].split(',').map(decodeURIComponent) : []; }
sapla('_lib/db.js', {
  isConfigured: function () { return true; },
  request: async function (q) {
    if (q.indexOf('verified_domains') === 0) { const ds = inList(q, 'domain'); return VD.filter(function (r) { return ds.indexOf(r.domain) !== -1; }); }
    if (q.indexOf('cl_subscriptions') === 0) { const us = inList(q, 'user_id'); return SUBS.filter(function (r) { return us.indexOf(r.user_id) !== -1; }); }
    if (q.indexOf('scan_jobs') === 0) { const d = decodeURIComponent(/domain=eq\.([^&]+)/.exec(q)[1]); return JOBS[d] !== undefined ? [{ score: JOBS[d], completed_at: '2026-10-04T10:00:00Z' }] : []; }
    return [];
  }
});
const badge = require(path.join(API, 'badge.js'));
function res() { const r = { h: {}, code: 0, body: '', setHeader: function (k, v) { r.h[k] = v; }, status: function (c) { r.code = c; return r; }, send: function (b) { r.body = b; return r; }, end: function () { return r; } }; return r; }
async function al(domain) { const r = res(); await badge({ method: 'GET', query: { domain: domain } }, r); return r; }

(async function () {
  let r = await al('ornek.com.svg');
  dogru('doğrulanmış + Pro → skor', r.body.indexOf('92/100 · 04.10.2026') !== -1);
  dogru('80 üstü altın', r.body.indexOf('#d4af37') !== -1);
  esit('SVG tipi', r.h['Content-Type'], 'image/svg+xml; charset=utf-8');
  esit('önbellek 1 saat', r.h['Cache-Control'], 'public, max-age=3600, s-maxage=3600');
  dogru('"%100 güvenli" iddiası yok', !/100%|%100|güvenli(?!k)/i.test(r.body));
  r = await al('api.ornek.com');
  dogru('DNS üst alan alt alanı kapsar', r.body.indexOf('64/100') !== -1);
  dogru('80 altı gri', r.body.indexOf('fill="#a0a0b0"/>') !== -1);
  r = await al('dosya.com');
  dogru('dosya ile doğrulanan kendisi', r.body.indexOf('85/100') !== -1);
  r = await al('www.dosya.com');
  dogru('dosya doğrulaması alt alanı kapsamaz', r.body.indexOf('doğrulanmadı') !== -1);
  r = await al('bedava.com');
  dogru('ücretsiz planda skor yok', r.body.indexOf('doğrulanmadı') !== -1);
  r = await al('baskasi.com');
  dogru('doğrulanmamış → nötr', r.body.indexOf('doğrulanmadı') !== -1);
  r = await al('<script>');
  dogru('geçersiz alan adı → nötr', r.body.indexOf('doğrulanmadı') !== -1);
  dogru('SVG metni kaçışlı', badge.svg('a<b', 'c&d', '#000', 'x"y').indexOf('a&lt;b') !== -1);
  if (hatalar.length) { console.error('Rozet sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
  console.log('Rozet sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (e) { console.error('sınama çöktü:', e && e.stack || e); process.exit(1); });
