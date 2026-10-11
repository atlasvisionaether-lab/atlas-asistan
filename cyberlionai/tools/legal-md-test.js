'use strict';
/**
 * legal/*.md → kök yasal sayfalar tutarlılığı. Ağdan bağımsız.
 *
 *   node tools/legal-md-test.js
 *
 * Sınananlar: üretilen HTML md ile güncel; her sayfada başlık, açıklama, h1,
 * güncelleme tarihi ve legal-data.js'ten gelen şirket kimliği var; satır içi
 * betik yok (CSP hash listesi değişmesin); eski/yanlış ifadeler (5 ücretsiz
 * tarama, "Ünvan: Cyber Lion AI", "yurt dışına aktarılmaz") geri gelmemiş;
 * adresler yönlendirmeyle gölgelenmiyor ve sitemap'te.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const { SAYFALAR, parse, render } = require('./render-legal-md.js');
const { isletme } = require('../legal-data.js');
const { FREE_SCAN_LIMIT } = require('../api/_lib/limits.js');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen) + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const kaynaklar = vercel.redirects.map(function (r) { return r.source; });

console.log('Yasal sayfalar (legal/*.md)');
SAYFALAR.forEach(function (p) {
  const md = fs.readFileSync(path.join(ROOT, 'legal', p.slug + '.md'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, p.slug + '.html'), 'utf8');
  sina(p.slug + ': HTML md ile güncel', html === render(p, parse(md)), true);
  sina(p.slug + ': <title>', html.indexOf('<title>' + p.title + ' | Cyber Lion AI</title>') !== -1, true);
  sina(p.slug + ': meta description', /<meta name="description" content="[^"]{50,}"/.test(html), true);
  sina(p.slug + ': tek h1', (html.match(/<h1>/g) || []).length, 1);
  sina(p.slug + ': güncelleme tarihi', html.indexOf('Son güncelleme:</strong> 05.10.2026') !== -1, true);
  sina(p.slug + ': ünvan legal-data.js\'ten', html.indexOf(isletme.unvan + ' – ' + isletme.isletmeTuru) !== -1, true);
  sina(p.slug + ': adres ve VKN', html.indexOf(isletme.adresKisa) !== -1 && html.indexOf('VKN ' + isletme.vkn) !== -1, true);
  sina(p.slug + ': satır içi betik yok', /<script(?![^>]*\ssrc=)/.test(html), false);
  sina(p.slug + ': yönlendirmeyle gölgelenmiyor', kaynaklar.indexOf('/' + p.slug), -1);
  sina(p.slug + ': sitemap\'te', sitemap.indexOf('https://www.cyberlionai.com/' + p.slug + '</loc>') !== -1, true);

  const metin = md + html;
  sina(p.slug + ': "Ünvan: Cyber Lion AI" yok', /Ünvan: Cyber Lion AI\s*$/m.test(md), false);
  sina(p.slug + ': "yurt dışına aktarılmaz" yok', /yurt dışına aktarılmaz/i.test(metin), false);
  const sayilar = (metin.match(/Free (?:[Pp]lan)?:? ?(\d+) tarama|Free plan (\d+) tarama/g) || [])
    .map(function (m) { return (m.match(/\d+/) || [''])[0]; });
  sina(p.slug + ': Free tarama sayısı ' + FREE_SCAN_LIMIT, sayilar.every(function (x) { return x === String(FREE_SCAN_LIMIT); }), true);
});

console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
process.exit(hata === 0 ? 0 : 1);
