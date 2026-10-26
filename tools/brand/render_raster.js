'use strict';
const fs = require('node:fs'); const path = require('node:path');
const { chromium } = require('playwright');
const LOGO = process.argv[2], OUT = process.argv[3];
const svg = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(LOGO, f)).toString('base64');
const jobs = [
  { file: 'icon-512.png', w: 512, h: 512, transparent: true, html: `<img src="${svg('atlas-favicon.svg')}" style="width:512px;height:512px">` },
  { file: 'apple-180.png', w: 180, h: 180, html: `<div style="width:180px;height:180px;background:#07041a;display:grid;place-items:center"><img src="${svg('atlas-mark.svg')}" style="width:150px;height:150px"></div>` },
  ...[16, 32, 48].map((s) => ({ file: 'fav-' + s + '.png', w: s, h: s, transparent: true, html: `<img src="${svg('atlas-favicon.svg')}" style="width:${s}px;height:${s}px">` })),
  { file: 'og.png', w: 1200, h: 630, html: `<div style="width:1200px;height:630px;box-sizing:border-box;padding:0 96px;display:flex;flex-direction:column;justify-content:center;gap:34px;
      background:radial-gradient(800px 520px at 82% -10%,rgba(109,40,217,.55),transparent 62%),radial-gradient(700px 500px at -8% 112%,rgba(14,116,144,.45),transparent 60%),#05030f;font-family:Georgia,serif;color:#f5f2ff">
      <img src="${svg('atlas-logo.svg')}" style="height:150px;width:auto;align-self:flex-start;filter:drop-shadow(0 0 30px rgba(251,191,36,.35))">
      <div style="font-size:44px;line-height:1.25;max-width:900px">Kliniğiniz kapalıyken bile <span style="color:#fbbf24">randevu defterinizi dolduran</span> yapay zekâ asistanı.</div>
      <div style="font-family:system-ui,sans-serif;font-size:24px;letter-spacing:.18em;text-transform:uppercase;color:#67e8f9">WhatsApp · Instagram · Telegram · 7/24</div></div>` }
];
(async () => {
  const b = await chromium.launch();
  for (const j of jobs) {
    const p = await b.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
    await p.setContent(`<html><body style="margin:0;background:${j.transparent ? 'transparent' : '#05030f'}">${j.html}</body></html>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, j.file), omitBackground: !!j.transparent, clip: { x: 0, y: 0, width: j.w, height: j.h } });
    await p.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
