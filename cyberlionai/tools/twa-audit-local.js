'use strict';

/**
 * atlas109'daki TWA proje dosyalarını denetler (ağ YOK).
 *
 *   node tools/twa-audit-local.js /home/aliatlaskotan/cyberlion-app
 *
 * Bu betik, derlenmiş AAB ile yapılandırmanın AYNI şeyi söylediğini ölçüyor.
 * Telefondaki "Tekrar deneyin" hatasının en sık sebebi, APK'ya GÖMÜLÜ açılış
 * adresinin elle Chrome'da açılan adresten farklı olması: Chrome çalışır,
 * uygulama çalışmaz ve yapılandırma dosyasına bakınca her şey doğru görünür.
 * Tek kanıt, AAB'nin içindeki AndroidManifest.xml'dir.
 *
 * AAB okuması için bundletool veya aapt2 gerekiyor; yoksa o bölüm
 * ÖLÇÜLEMEDİ der ve komutu yazar — tahmin etmez.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const DIZIN = process.argv[2];
if (!DIZIN) {
  console.error('Kullanım: node tools/twa-audit-local.js <TWA proje dizini>');
  process.exit(2);
}

let kaldi = 0;
const yapilacak = [];
function ok(a, e) { console.log('  ✓ ' + a + (e ? ' — ' + e : '')); }
function hata(a, e) { kaldi++; console.log('  ✗ ' + a + (e ? ' — ' + e : '')); }
function bilgi(a, e) { console.log('  · ' + a + (e ? ' — ' + e : '')); }
function olculemedi(a, e) { console.log('  ? ' + a + ' — ÖLÇÜLEMEDİ' + (e ? ': ' + e : '')); }
/* Not yalnızca BAŞARISIZLIKTA yazılıyor: geçen bir denetimin yanına
   "X ≠ Y" basmak satırı kendi kendini yalanlar hâle getiriyordu. */
function bekle(k, a, e) { k ? ok(a) : hata(a, e); }

function oku(ad) {
  const p = path.join(DIZIN, ad);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { __hata: e.message }; }
}

function komutVar(ad) {
  try { execSync('command -v ' + ad, { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

console.log('TWA yerel denetimi: ' + DIZIN);
console.log('');

/* ---- 1. twa-manifest.json ---- */
console.log('1. twa-manifest.json');
const t = oku('twa-manifest.json');
let paket = null;
let acilis = null;
if (!t) {
  hata('dosya yok', path.join(DIZIN, 'twa-manifest.json'));
} else if (t.__hata) {
  hata('JSON ayrıştırılamadı', t.__hata);
} else {
  paket = t.packageId;
  bilgi('packageId', String(paket));
  bilgi('host', String(t.host));
  bilgi('startUrl', String(t.startUrl));
  bilgi('webManifestUrl', String(t.webManifestUrl));

  /* host ŞEMASIZ olmalı: bubblewrap şemayı kendisi ekliyor, "https://" yazılırsa
     açılış adresi https://https://… olur ve telefonda ağ hatası görünür. */
  bekle(typeof t.host === 'string' && !/^https?:\/\//i.test(t.host),
    'host şema içermiyor', 'host="' + t.host + '" → açılış adresi bozulur');
  bekle(typeof t.host === 'string' && !/\/$/.test(t.host), 'host sonunda / yok');
  bekle(typeof t.startUrl === 'string' && t.startUrl.charAt(0) === '/',
    'startUrl kökten göreli', 'startUrl="' + t.startUrl + '"');

  if (typeof t.host === 'string' && typeof t.startUrl === 'string') {
    acilis = 'https://' + t.host.replace(/^https?:\/\//, '').replace(/\/$/, '') + t.startUrl;
    bilgi('hesaplanan açılış adresi', acilis);
  }

  /* webManifestUrl aynı ana makinede olmalı; başka alan adı gösteriyorsa
     uygulama bir sitenin kabuğuyla başka sitenin manifest'ini taşır. */
  if (t.webManifestUrl && t.host) {
    let ayni = false;
    try { ayni = new URL(t.webManifestUrl).host === t.host.replace(/^https?:\/\//, '').replace(/\/$/, ''); } catch (e) {}
    bekle(ayni, 'webManifestUrl host ile aynı alan adında', String(t.webManifestUrl));
  }

  bekle(t.enableNotifications === true, 'enableNotifications true (Android 13+ POST_NOTIFICATIONS)');
  bekle(t.fallbackType === 'customtabs' || !t.fallbackType,
    'fallbackType customtabs', String(t.fallbackType));
  if (t.signingKey) bilgi('imza anahtarı', t.signingKey.path + ' (alias: ' + t.signingKey.alias + ')');
  bilgi('sürüm', String(t.appVersionName) + ' / versionCode ' + String(t.appVersionCode));
}

/* ---- 2. assetlinks.json (yerel kopya) ---- */
console.log('');
console.log('2. assetlinks.json (yerel kopya varsa)');
const alYollar = ['assetlinks.json', 'public/.well-known/assetlinks.json', '.well-known/assetlinks.json'];
const alYol = alYollar.filter(function (p) { return fs.existsSync(path.join(DIZIN, p)); })[0];
if (!alYol) {
  olculemedi('yerel assetlinks.json', 'bu dizinde yok (yayındaki kopya twa-verify.js ile ölçülüyor)');
} else {
  const al = oku(alYol);
  bilgi('dosya', alYol);
  if (!Array.isArray(al)) {
    hata('kök öğe dizi değil', 'Android bir DİZİ bekler, nesne kabul etmez');
  } else {
    ok('dizi', al.length + ' kayıt');
    al.forEach(function (k, i) {
      const r = (k.relation || []);
      bekle(r.indexOf('delegate_permission/common.handle_all_urls') !== -1,
        '[' + i + '] relation handle_all_urls', JSON.stringify(r));
      const tg = k.target || {};
      bekle(tg.namespace === 'android_app', '[' + i + '] namespace android_app', String(tg.namespace));
      if (paket) {
        bekle(tg.package_name === paket, '[' + i + '] paket adı twa-manifest ile aynı',
          String(tg.package_name) + ' ≠ ' + paket);
      }
      const fp = tg.sha256_cert_fingerprints || [];
      bekle(fp.length > 0, '[' + i + '] parmak izi var');
      fp.forEach(function (f) {
        bekle(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(String(f).toUpperCase()),
          '[' + i + '] parmak izi biçimi', String(f).slice(0, 20) + '…');
      });
      if (fp.length === 1) {
        yapilacak.push('assetlinks\'te tek parmak izi var. Play App Signing açıksa Play, '
          + 'uygulamayı KENDİ anahtarıyla yeniden imzalar: Play\'den inen sürümün parmak izi '
          + 'yerelde imzaladığınızdan farklıdır. Play Console → Uygulama bütünlüğü → '
          + 'Uygulama imzalama ekranındaki İKİ parmak izini de (uygulama imzalama + yükleme) '
          + 'listeye ekleyin.');
      }
    });
  }
}

/* ---- 3. AAB içindeki gerçek açılış adresi ---- */
console.log('');
console.log('3. AAB içindeki gerçek değerler (tek kanıt)');
const aabYol = ['app-release-bundle.aab', 'build/app-release-bundle.aab']
  .map(function (p) { return path.join(DIZIN, p); })
  .filter(function (p) { return fs.existsSync(p); })[0];

if (!aabYol) {
  olculemedi('AAB', 'app-release-bundle.aab bu dizinde yok');
} else {
  const kb = (fs.statSync(aabYol).size / 1048576).toFixed(1);
  bilgi('AAB', aabYol + ' (' + kb + ' MB)');
  let dump = null;
  if (komutVar('bundletool')) {
    try { dump = execFileSync('bundletool', ['dump', 'manifest', '--bundle', aabYol], { encoding: 'utf8' }); }
    catch (e) { olculemedi('bundletool dump', String(e.message).split('\n')[0]); }
  } else if (komutVar('aapt2')) {
    olculemedi('aapt2 ile AAB okunamaz', 'AAB için bundletool gerekiyor');
  } else {
    olculemedi('bundletool yok',
      'kurulum: https://github.com/google/bundletool/releases — sonra: '
      + 'bundletool dump manifest --bundle ' + aabYol);
  }
  if (dump) {
    /* Bubblewrap açılış adresini meta-data olarak gömüyor; TWA'nın açtığı
       adres BUDUR, twa-manifest.json değil (o yalnızca üretim girdisi). */
    const paketEsle = /package="([^"]+)"/.exec(dump);
    const surumEsle = /versionCode="([^"]+)"/.exec(dump);
    const urlEsle = /android\.support\.customtabs\.trusted\.DEFAULT_URL[\s\S]{0,200}?android:value="([^"]+)"/.exec(dump)
      || /DEFAULT_URL"[\s\S]{0,200}?value="([^"]+)"/.exec(dump);
    const ifadeEsle = /asset_statements[\s\S]{0,400}?android:(?:value|resource)="([^"]+)"/.exec(dump);

    if (paketEsle) {
      bilgi('AAB paket adı', paketEsle[1]);
      if (paket) bekle(paketEsle[1] === paket, 'AAB paketi twa-manifest ile aynı',
        paketEsle[1] + ' ≠ ' + paket);
    }
    if (surumEsle) bilgi('AAB versionCode', surumEsle[1]);
    if (urlEsle) {
      bilgi('AAB açılış adresi', urlEsle[1]);
      bekle(/^https:\/\//i.test(urlEsle[1]), 'açılış adresi https',
        'http:// ise Android 9+ temiz metni engeller → ağ hatası sayfası');
      if (acilis) {
        bekle(urlEsle[1].replace(/\/$/, '') === acilis.replace(/\/$/, ''),
          'AAB açılış adresi yapılandırmayla aynı',
          'AAB: ' + urlEsle[1] + ' | yapılandırma: ' + acilis);
      }
    } else {
      olculemedi('AAB açılış adresi', 'manifest dökümünde DEFAULT_URL bulunamadı');
    }
    if (ifadeEsle) bilgi('asset_statements', ifadeEsle[1].slice(0, 120));
    else hata('asset_statements yok', 'TWA doğrulaması hiç denenmez, adres çubuğu kalır');
    bekle(/android\.permission\.INTERNET/.test(dump), 'INTERNET izni var',
      'yoksa her istek ağ hatası verir');
    if (/POST_NOTIFICATIONS/.test(dump)) ok('POST_NOTIFICATIONS izni var (Android 13+)');
    else hata('POST_NOTIFICATIONS izni yok', 'enableNotifications true ile yeniden derleyin');
  }
}

/* ---- 4. İmza anahtarı ---- */
console.log('');
console.log('4. İmza anahtarı');
const ks = ['android.keystore', 'android.jks'].map(function (p) { return path.join(DIZIN, p); })
  .filter(function (p) { return fs.existsSync(p); })[0];
if (!ks) {
  olculemedi('keystore', 'bu dizinde yok');
} else {
  ok('keystore var', ks);
  console.log('    Parmak izini okumak için (parola sorar, burada çalıştırılmadı):');
  console.log('      keytool -list -v -keystore ' + ks + ' -alias '
    + ((t && t.signingKey && t.signingKey.alias) || 'cyberlion') + ' | grep SHA256');
  yapilacak.push('Yerel keystore parmak izi, Play\'den inen sürümün parmak izi DEĞİLDİR '
    + '(Play App Signing yeniden imzalar). assetlinks\'e Play Console\'daki '
    + 'UYGULAMA İMZALAMA parmak izi girilmeli; yerel olan YÜKLEME anahtarıdır.');
}

console.log('');
if (yapilacak.length) {
  console.log('NOTLAR');
  yapilacak.forEach(function (n, i) { console.log('  ' + (i + 1) + ') ' + n.replace(/\s+/g, ' ')); });
  console.log('');
}
if (kaldi) { console.log('KALDI: ' + kaldi); process.exit(1); }
console.log('TAMAM');
