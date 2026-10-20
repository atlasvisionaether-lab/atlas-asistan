'use strict';

/**
 * /.well-known/assetlinks.json üretir (Digital Asset Links).
 *
 * TWA (Trusted Web Activity) açılışta bu dosyayı okur: imza parmak izi
 * tutmazsa uygulama üstte adres çubuğuyla açılır — yani Chrome sekmesi gibi
 * görünür ve Play incelemesinde "sadece web sitesi" diye reddedilir.
 *
 * Parmak izi DEPODA TUTULMAZ diye bir kural yok (gizli değil, imzanın genel
 * özeti), ama UYDURULAMAZ: Play App Signing kullanılıyorsa parmak izi Play
 * Console'da üretilir. Bu yüzden dosya elle yazılmıyor, buradan üretiliyor.
 *
 *   node tools/twa-assetlinks.js AB:CD:...:EF [IKINCI_PARMAK_IZI ...] [--paket=ad]
 *
 * BİRDEN FAZLA parmak izi verilebilir ve Play App Signing kullanılıyorsa
 * GEREKİR: Play, yüklediğiniz paketi KENDİ anahtarıyla yeniden imzalar, yani
 * mağazadan inen sürümün parmak izi yerelde imzaladığınızdan farklıdır.
 * Yalnızca birini listelerseniz iki durumdan biri çalışır, öteki çalışmaz
 * ("yerelde kurunca oluyor, Play'den inince olmuyor" tam bu).
 *
 * Parmak izi: Play Console → Uygulama bütünlüğü → Uygulama imzalama →
 * "SHA-256 sertifika parmak izi" (yükleme anahtarınınki DEĞİL, uygulama
 * imzalama anahtarınınki; ikisi farklıdır ve yanlışı sessizce başarısız olur).
 */

const fs = require('fs');
const path = require('path');

const VARSAYILAN_PAKET = 'com.cyberlionai.app';
const HEDEF = path.join(__dirname, '..', '.well-known', 'assetlinks.json');

function gecerliParmakIzi(s) {
  /* 32 bayt, iki haneli onaltılık, iki nokta ile ayrılmış. */
  return /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(s);
}

function main() {
  const argv = process.argv.slice(2);
  const paketBayrak = argv.filter(function (a) { return /^--paket=/.test(a); })[0];
  const paket = (paketBayrak ? paketBayrak.split('=')[1] : VARSAYILAN_PAKET).trim();
  const izler = argv.filter(function (a) { return !/^--/.test(a); })
    .map(function (a) { return a.trim().toUpperCase(); });

  if (!izler.length) {
    console.error('Kullanım: node tools/twa-assetlinks.js <SHA256_PARMAK_IZI> [İKİNCİ …] [--paket=ad]');
    console.error('Parmak izi: Play Console → Uygulama bütünlüğü → Uygulama imzalama.');
    console.error('Play App Signing açıksa HEM uygulama imzalama HEM yükleme parmak izini verin.');
    process.exit(2);
  }
  const bozuk = izler.filter(function (f) { return !gecerliParmakIzi(f); });
  if (bozuk.length) {
    console.error('ÖLÇÜLEMEDİ: parmak izi biçimi tutmuyor: ' + bozuk.join(', '));
    console.error('Beklenen: 32 onaltılık bayt, iki nokta ile ayrılmış (AB:CD:…:EF).');
    process.exit(2);
  }
  /* Aynı izi iki kez yazmak Android tarafında sorun çıkarmıyor ama dosyayı
     okuyan insanı yanıltıyor: tekilleştiriliyor. */
  const tekil = izler.filter(function (f, i) { return izler.indexOf(f) === i; });

  const icerik = [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: paket,
      sha256_cert_fingerprints: tekil
    }
  }];

  fs.mkdirSync(path.dirname(HEDEF), { recursive: true });
  fs.writeFileSync(HEDEF, JSON.stringify(icerik, null, 2) + '\n', 'utf8');
  console.log('Yazıldı: .well-known/assetlinks.json (' + paket + ', '
    + tekil.length + ' parmak izi)');
  if (tekil.length === 1) {
    console.log('UYARI: tek parmak izi. Play App Signing açıksa mağazadan inen sürüm');
    console.log('       BAŞKA bir anahtarla imzalıdır ve doğrulama onda başarısız olur.');
  }
  console.log('Dağıtımdan sonra doğrulama:');
  console.log('  curl -s https://www.cyberlionai.com/.well-known/assetlinks.json');
}

main();
