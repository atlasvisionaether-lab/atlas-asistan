'use strict';

/**
 * Şirket/işletme kimliği — TEK KAYNAK.
 *
 * Bu depoda derleme adımı (bundler, TypeScript) yok: sayfalar düz HTML,
 * uçlar düz Node/CommonJS. Bu yüzden `.ts` değil `.js`; aksi hâlde bu
 * dosyayı hiçbir yer gerçekten okuyamazdı. Aynı sebeple statik sayfalar bu
 * dosyayı TARAYICIDA import ETMEZ (modül sistemi yok, CSP script-src
 * hash'leri satır içi script'leri sabitliyor) — bunun yerine
 * `tools/render-legal-pages.js` bu nesneyi Node'da okuyup değerleri
 * `pages/*.html` ve `index.html` içindeki işaretli bloklara yazar. Bu
 * dosyayı değiştirdikten sonra o script TEKRAR ÇALIŞTIRILMALI, yoksa
 * sayfalar eski değerlerle kalır (bkz. o scriptin kendi `--check` modu).
 */

const isletme = {
  unvan: 'Ali Kotan',
  isletmeTuru: 'Şahıs İşletmesi',
  yetkili: 'Ali Kotan',
  adres: 'Ritim AVM, Cevizli Mahallesi, Zuhal Caddesi No: 46, İç Kapı No: 50, Maltepe / İstanbul',
  adresKisa: 'Ritim AVM, Cevizli Mah. Zuhal Cad. No:46/50 Maltepe/İstanbul',
  telefonGoruntu: '0534 468 27 69',
  telefonHref: 'tel:+905344682769',
  telefonUluslararasi: '+90 534 468 27 69',
  vkn: '5810910912',
  vergiDairesi: 'Kartal Vergi Dairesi',
  mersis: null, // Şahıs işletmesi — MERSİS yok, VKN kullanılır.
  epostaInfo: 'info@cyberlionai.com',
  epostaDestek: 'destek@cyberlionai.com',
  web: 'www.cyberlionai.com',
  calismaSaatleri: 'Hafta içi 09:00 – 18:00 (TSİ)',
  telifYili: 2026
};

module.exports = { isletme };
