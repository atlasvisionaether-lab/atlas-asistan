'use strict';
/**
 * 3B yıldız haritası: fare paralaksı gecikmesi + FPS ölçümü (Playwright, Chromium).
 *
 *   NODE_PATH=$(npm root -g) node tools/space-perf-test.js
 *
 * Panel önbelleksiz yerel sunucudan açılır; space.js'in ?sxdebug kancası
 * (window.__sx) okunur. Fare dairesel hareket ettirilir (FPS), sonra merkezden
 * sağ kenara sıçratılır: kameranın hedefin %90'ına varma süresi = gecikme.
 *
 * Ölçüler iki kipte: uyarlanır kalite AÇIK (gerçek davranış) ve tam kalite
 * (?sxfull: kalite düşürme kapalı, saf render maliyeti).
 *
 * DİKKAT: GPU'suz ortamda Chromium yazılım WebGL'i (SwiftShader) kullanır —
 * mutlak FPS gerçek ekran kartının çok altındadır; eşik yalnız GECİKME
 * içindir (kare hızından bağımsız olmalı). CI'da koşmuyor (tarayıcı + CDN).
 *
 * Eşik: paralaks %90 < 500 ms (eski kare başı 0,04 yumuşatma 7,4 FPS'te 7,8 sn ölçüldü).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', 'panel');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const LATENCY_LIMIT_MS = 500;

const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://x');
  const p = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});

/* Sayfada çalışan ölçüm: FPS (4 sn dairesel fare) + paralaks %90 süresi. */
function measure() {
  return new Promise(function (res) {
    const W = innerWidth, H = innerHeight;
    const move = function (x, y) { window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse' })); };
    const run = function () {
      const times = []; let last = performance.now(); const t0 = last;
      function tick(now) {
        times.push(now - last); last = now;
        const a = (now - t0) / 400;
        move(W / 2 + Math.cos(a) * W * 0.35, H / 2 + Math.sin(a) * H * 0.33);
        if (now - t0 < 4000) return requestAnimationFrame(tick);
        const ft = times.slice(5).sort(function (x, y) { return x - y; });
        const avg = ft.reduce(function (s, x) { return s + x; }, 0) / ft.length;
        move(W / 2, H / 2);
        const settle = function () {
          if (Math.abs(window.__sx.parallax().mx) > 0.005) return requestAnimationFrame(settle);
          const tStart = performance.now(); move(W * 0.95, H / 2);
          const target = window.__sx.parallax().tx;
          const watch = function () {
            if (window.__sx.parallax().mx >= 0.9 * target || performance.now() - tStart > 15000) {
              return res({ fps: +(1000 / avg).toFixed(1), p95ms: Math.round(ft[Math.floor(ft.length * 0.95)]), parallax90ms: Math.round(performance.now() - tStart), qualityLevel: window.__sx.level() });
            }
            requestAnimationFrame(watch);
          };
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(settle);
      }
      requestAnimationFrame(tick);
    };
    const go = function () { setTimeout(run, 2500); };
    if (window.__space3d) go(); else addEventListener('space:ready', go);
  });
}

(async function () {
  await new Promise(function (ok) { server.listen(0, '127.0.0.1', ok); });
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  let hata = 0;
  try {
    for (const kip of [{ ad: 'uyarlanır kalite (gerçek davranış)', q: '?sxdebug=1' }, { ad: 'tam kalite (?sxfull)', q: '?sxdebug=1&sxfull=1' }]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(base + kip.q);
      const r = await page.evaluate(measure);
      const ok = r.parallax90ms < LATENCY_LIMIT_MS;
      if (!ok) hata++;
      console.log((ok ? 'ok   ' : 'HATA ') + kip.ad + ': ' + JSON.stringify(r));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(hata ? '\nParalaks gecikmesi eşiği (' + LATENCY_LIMIT_MS + ' ms) aşıldı' : '\nTümü geçti (paralaks %90 < ' + LATENCY_LIMIT_MS + ' ms)');
  process.exit(hata ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
