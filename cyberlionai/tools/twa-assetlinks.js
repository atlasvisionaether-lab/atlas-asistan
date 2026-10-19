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
 *   node tools/twa-assetlinks.js AB:CD:...:EF [paket.adi]
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
  const ham = String(process.argv[2] || '').trim().toUpperCase();
  const paket = String(process.argv[3] || VARSAYILAN_PAKET).trim();

  if (!ham) {
    console.error('Kullanım: node tools/twa-assetlinks.js <SHA256_PARMAK_IZI> [paket.adi]');
    console.error('Parmak izi: Play Console → Uygulama bütünlüğü → Uygulama imzalama.');
    process.exit(2);
  }
  if (!gecerliParmakIzi(ham)) {
    console.error('ÖLÇÜLEMEDİ: parmak izi biçimi tutmuyor.');
    console.error('Beklenen: 32 onaltılık bayt, iki nokta ile ayrılmış (AB:CD:…:EF).');
    process.exit(2);
  }

  const icerik = [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: paket,
      sha256_cert_fingerprints: [ham]
    }
  }];

  fs.mkdirSync(path.dirname(HEDEF), { recursive: true });
  fs.writeFileSync(HEDEF, JSON.stringify(icerik, null, 2) + '\n', 'utf8');
  console.log('Yazıldı: .well-known/assetlinks.json (' + paket + ')');
  console.log('Dağıtımdan sonra doğrulama:');
  console.log('  curl -s https://www.cyberlionai.com/.well-known/assetlinks.json');
}

main();
