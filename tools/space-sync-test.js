'use strict';
/**
 * Uzay teması: site ile panel kopyaları aynı mı, sayfalar doğru bağlanmış mı?
 *
 *   node tools/space-sync-test.js
 *
 * space/ TEK KAYNAK; panel ayrı Vercel projesi (kök: panel/) olduğu için
 * panel/space/ birebir kopya. Kopya ayrışırsa site ile panel farklı görünür.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['space.js', 'space-ui.js', 'space.css'];
const PAGES = [
  { file: 'index.html', base: '/space/' },
  { file: 'checkout.html', base: '/space/' },
  { file: 'panel/index.html', base: 'space/' }
];

let hata = 0;
function sina(ad, ok, ek) {
  if (!ok) hata++;
  console.log((ok ? 'ok   ' : 'HATA ') + ad + (ok || !ek ? '' : ' — ' + ek));
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

FILES.forEach(function (f) {
  sina('panel/space/' + f + ' = space/' + f, read('space/' + f) === read('panel/space/' + f),
    'kopyala: cp space/' + f + ' panel/space/' + f);
});

const imports = read('space/space.js').match(/from\s+"([^"]+)"/g).map(function (m) { return m.replace(/from\s+"|"/g, ''); });
sina('space.js yalnız three / three/addons içe aktarır', imports.every(function (i) { return i === 'three' || i.indexOf('three/addons/') === 0; }), imports.join(', '));

const versions = [];
PAGES.forEach(function (pg) {
  const html = read(pg.file);
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  sina(pg.file + ': importmap var', !!map);
  if (!map) return;
  const im = JSON.parse(map[1]).imports;
  const v = /three@(\d+\.\d+\.\d+)\/build\/three\.module\.js$/.exec(im.three || '');
  const va = /three@(\d+\.\d+\.\d+)\/examples\/jsm\/$/.exec(im['three/addons/'] || '');
  sina(pg.file + ': three ve addons aynı sabit sürüm', !!v && !!va && v[1] === va[1]);
  if (v) versions.push(v[1]);
  sina(pg.file + ': importmap modülden önce', html.indexOf('type="importmap"') < html.indexOf('src="' + pg.base + 'space.js"'));
  sina(pg.file + ': <canvas id="space3d">', /<canvas id="space3d" data-space="(hero|panel)" aria-hidden="true">/.test(html));
  ['space.css', 'space-ui.js', 'space.js'].forEach(function (f) {
    sina(pg.file + ': ' + pg.base + f + ' bağlı', html.indexOf('"' + pg.base + f + '"') !== -1);
  });
});
sina('tüm sayfalar aynı three sürümü', versions.length === PAGES.length && versions.every(function (v) { return v === versions[0]; }), versions.join(' / '));

const vercel = JSON.parse(read('vercel.json'));
sina('kök vercel.json /space/* yönlendirmiyor', !(vercel.redirects || []).some(function (r) { return /^\/space(\/|$)/.test(r.source); }));

console.log(hata ? '\n' + hata + ' sınama BAŞARISIZ' : '\nTümü geçti');
process.exit(hata ? 1 : 0);
