'use strict';

/**
 * PWA manifest + TWA yapılandırmasının ağsız sınaması.
 *
 * Manifest Play Store'daki uygulamanın kaynağı: adı, ikonu, açılış ekranı ve
 * başlangıç adresi oradan geliyor. Bir satır sessizce bozulursa uygulama
 * yeniden derlenene kadar yanlış ad/ikonla yayında kalır — o yüzden kilitli.
 *
 * Ağ YOK: dosyalar ve PNG başlıkları okunuyor.
 */

const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const DEPO = path.join(KOK, '..');
const M = JSON.parse(fs.readFileSync(path.join(KOK, 'manifest.json'), 'utf8'));
const TWA = JSON.parse(fs.readFileSync(path.join(DEPO, 'android-twa', 'twa-manifest.json'), 'utf8'));

let kaldi = 0;
function ok(ad) { console.log('  ✓ ' + ad); }
function hata(ad, a) { kaldi++; console.log('  ✗ ' + ad + (a ? ' — ' + a : '')); }
function bekle(k, ad, a) { k ? ok(ad) : hata(ad, a); }

/** PNG başlığından gerçek boyut: manifest'teki sizes yalan söylemesin. */
function pngBoyut(dosya) {
  const b = fs.readFileSync(dosya);
  if (b.length < 24 || b.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
}

console.log('PWA manifest');

bekle(M.name && M.short_name, 'name ve short_name var');
bekle(M.short_name.length <= 12, 'short_name 12 karakteri aşmıyor (Android başlatıcı kırpar)');
bekle(M.start_url === '/' && M.scope === '/', 'start_url ve scope kök');
bekle(M.display === 'standalone', 'display standalone (TWA bunu şart koşuyor)');
bekle(/^#[0-9a-f]{6}$/i.test(M.theme_color) && /^#[0-9a-f]{6}$/i.test(M.background_color),
  'theme_color ve background_color altı haneli onaltılık');
bekle(M.lang === 'tr', 'lang tr');

/* Chrome kurulabilirlik eşiği: en az bir 192 ve bir 512 ikon. Play'de ayrıca
   maskable olmayan ikon kırpılır, o yüzden ikisi de aranıyor. */
const boyutlar = M.icons.map(function (i) { return i.sizes + ':' + (i.purpose || 'any'); });
bekle(boyutlar.indexOf('192x192:any') !== -1 && boyutlar.indexOf('512x512:any') !== -1,
  '192 ve 512 "any" ikon var');
bekle(boyutlar.indexOf('192x192:maskable') !== -1 && boyutlar.indexOf('512x512:maskable') !== -1,
  '192 ve 512 "maskable" ikon var');

M.icons.concat(M.screenshots).forEach(function (i) {
  const p = path.join(KOK, i.src.replace(/^\//, ''));
  if (!fs.existsSync(p)) return hata('dosya var: ' + i.src, 'bulunamadı');
  const gercek = pngBoyut(p);
  bekle(gercek === i.sizes, i.src + ' gerçekten ' + i.sizes, 'dosya ' + gercek);
});

/* Maskable ikonun kenar boşluğu: logo %80'den büyükse Android'in daire/kare
   maskesi logoyu keser. Dosyanın kendisi ölçülemez ama üretildiği komut
   (410/512 ≈ %80) belgede kilitli; burada en azından ayrı dosya olduğu. */
bekle(M.icons.filter(function (i) { return i.purpose === 'maskable'; })
  .every(function (i) { return i.src.indexOf('maskable') !== -1; }),
  'maskable ikonlar ayrı dosya (normal ikonun kopyası değil)');

bekle(Array.isArray(M.shortcuts) && M.shortcuts.length >= 1, 'kısayol tanımlı');
M.shortcuts.forEach(function (s) {
  bekle(typeof s.url === 'string' && s.url.charAt(0) === '/', 'kısayol yolu göreli: ' + s.url);
});

console.log('');
console.log('Sayfalardaki bağlantı');

const sayfalar = fs.readdirSync(KOK).filter(function (f) { return /\.html$/.test(f); });
const eksik = sayfalar.filter(function (f) {
  return fs.readFileSync(path.join(KOK, f), 'utf8').indexOf('rel="manifest"') === -1;
});
bekle(eksik.length === 0, 'tüm HTML sayfalarında <link rel="manifest">', eksik.join(', '));
bekle(fs.readFileSync(path.join(KOK, 'tools', 'render-legal-md.js'), 'utf8')
  .indexOf('rel="manifest"') !== -1,
  'yasal sayfa şablonunda da var (yeniden üretim bağlantıyı silmesin)');

/* Vercel manifest'i uzun ömürlü önbelleğe koymamalı: yüklü uygulamalar eski
   adı/ikonu taşır. İkon kuralı .json'u yakalamıyor, ayrı başlık gerekiyor. */
const vercel = JSON.parse(fs.readFileSync(path.join(KOK, 'vercel.json'), 'utf8'));
const mh = vercel.headers.filter(function (h) { return h.source === '/manifest.json'; })[0];
bekle(!!mh, 'vercel.json manifest için başlık tanımlıyor');
if (mh) {
  const ct = mh.headers.filter(function (h) { return h.key === 'Content-Type'; })[0];
  const cc = mh.headers.filter(function (h) { return h.key === 'Cache-Control'; })[0];
  bekle(ct && /application\/manifest\+json/.test(ct.value), 'Content-Type application/manifest+json');
  bekle(cc && !/immutable/.test(cc.value), 'manifest kalıcı önbelleğe alınmıyor');
}
bekle(vercel.headers.some(function (h) { return h.source === '/.well-known/assetlinks.json'; }),
  'assetlinks.json için başlık tanımlı');

console.log('');
console.log('TWA yapılandırması');

bekle(TWA.packageId === 'com.cyberlionai.app', 'paket adı com.cyberlionai.app');
bekle(TWA.host === 'www.cyberlionai.com' && /^https:\/\/www\.cyberlionai\.com\//.test(TWA.fullScopeUrl),
  'ana makine www.cyberlionai.com');
bekle(TWA.webManifestUrl === 'https://www.cyberlionai.com/manifest.json',
  'TWA aynı manifest\'i gösteriyor');
bekle(TWA.themeColor === M.theme_color && TWA.backgroundColor === M.background_color,
  'renkler manifest ile aynı', 'açılış ekranı ile sayfa arasında renk sıçraması olur');
bekle(TWA.name === 'Cyber Lion AI', 'uygulama adı');
bekle(TWA.launcherName.length <= 12, 'başlatıcı adı 12 karakteri aşmıyor');

/* Android 13+ bildirim izni: bubblewrap bu bayrağı görünce POST_NOTIFICATIONS
   iznini ve izin isteyen köprüyü üretiyor. Kapalıysa uygulama bildirim
   gönderemez ve bunu derleme sırasında kimse fark etmez. */
bekle(TWA.enableNotifications === true,
  'bildirim yetkisi açık (Android 13+ POST_NOTIFICATIONS)');
bekle(TWA.minSdkVersion >= 23, 'minSdkVersion en az 23');
bekle(TWA.fallbackType === 'customtabs', 'TWA desteklenmeyen cihazda Custom Tabs\'a düşüyor');

/* İkon adresleri canlı siteyi göstermeli: bubblewrap derleme anında indiriyor. */
[TWA.iconUrl, TWA.maskableIconUrl].forEach(function (u) {
  const yol = path.join(KOK, u.replace('https://www.cyberlionai.com/', ''));
  bekle(fs.existsSync(yol), 'TWA ikonu depoda var: ' + u);
});

/* İmza anahtarı asla depoya girmemeli. */
const gi = fs.readFileSync(path.join(DEPO, 'android-twa', '.gitignore'), 'utf8');
bekle(/\*\.keystore/.test(gi) && /\*\.jks/.test(gi), '.gitignore imza anahtarlarını dışlıyor');
const izlenen = require('child_process').execSync('git -C ' + JSON.stringify(DEPO) + ' ls-files', { encoding: 'utf8' });
bekle(!/\.(keystore|jks|aab|apk)$/m.test(izlenen), 'depoda izlenen imza anahtarı/paket dosyası yok');

bekle(fs.existsSync(path.join(KOK, 'tools', 'twa-assetlinks.js')),
  'assetlinks üretici betiği var');
bekle(!fs.existsSync(path.join(KOK, '.well-known', 'assetlinks.json')),
  'uydurma parmak izli assetlinks.json depoda yok',
  'parmak izi Play Console\'dan gelir, elle yazılamaz');

console.log('');
if (kaldi) { console.log('KALDI: ' + kaldi); process.exit(1); }
console.log('TAMAM');
