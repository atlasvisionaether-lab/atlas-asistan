#!/usr/bin/env node
'use strict';

/**
 * legal-data.js içindeki şirket kimliğini yasal sayfalara (pages/*.html) ve
 * index.html'in footer'ına yazar. tools/csp-hashes.py ile aynı fikir:
 * tek kaynaktan okuyup işaretli/bilinen alanları yeniden üretir, elle
 * düzenlemeyi gereksiz kılar.
 *
 * Idempotent: "Satıcı Bilgileri" / "Seller Information" başlığı zaten varsa
 * tekrar eklenmez, yalnızca güncellenir. Tarih her koşuda bugünün değerine
 * değil, bu dosyadaki SABİT GUNCELLEME_TARIHI'ne çekilir — "bugün" derleme
 * zamanına göre değişir ve bu araç deterministik olmalı (bkz. ana depodaki
 * Date.now() kısıtı).
 *
 *   node tools/render-legal-pages.js          # yazar
 *   node tools/render-legal-pages.js --check  # yalnızca kontrol, çıkış 1 = bayat
 */

const fs = require('fs');
const path = require('path');
const { isletme } = require('../legal-data.js');

const GUNCELLEME_TARIHI = '03.10.2026';

const ROOT = path.join(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');

/** Sadece bu append-only bloğu alan sayfalar. mesafeli-satis-sozlesmesi'in
    1. maddesi ve yeni sayfalar (on-bilgilendirme-formu, iletisim) kendi
    düzenini elle taşır; bu script onlara dokunmaz. */
const HEDEF_SAYFALAR = [
  'kvkk-aydinlatma-metni.html',
  'gizlilik-politikasi.html',
  'teslimat-ve-iade-sartlari.html',
  'kullanim-sartlari.html',
  'cerez-politikasi.html'
];

/** Aynı footer kalıbını (telif + flinks) paylaşan, HEDEF_SAYFALAR'IN DIŞINDA
    kalan dosyalar — yalnızca telif metni ve 7. link burada senkronlanır,
    SATICI/Seller bloğu eklenmez (bunlar yasal metin sayfası değil).
    checkout.html elle güncellendi (kendi onay kutusu metniyle birlikte),
    o yüzden burada yok — tekrar koşmak zararsız olurdu ama gerek yok. */
const FOOTER_PAYLASAN_DOSYALAR = [
  path.join(PAGES_DIR, 'hakkimizda.html'),
  path.join(ROOT, 'pricing.html'),
  path.join(ROOT, 'panel.html')
];

function satinBilgileriTr() {
  return '        <h2>Satıcı Bilgileri</h2>\n'
    + '        <p>\n'
    + '          <strong>Ticari Unvan:</strong> ' + isletme.unvan + '<br />\n'
    + '          <strong>İşletme Türü:</strong> ' + isletme.isletmeTuru + '<br />\n'
    + '          <strong>Yetkili:</strong> ' + isletme.yetkili + '<br />\n'
    + '          <strong>Adres:</strong> ' + isletme.adres + '<br />\n'
    + '          <strong>Telefon:</strong> <a class="inline" href="' + isletme.telefonHref + '">' + isletme.telefonGoruntu + '</a><br />\n'
    + '          <strong>Vergi Kimlik No:</strong> ' + isletme.vkn + '<br />\n'
    + '          <strong>Vergi Dairesi:</strong> ' + isletme.vergiDairesi + '<br />\n'
    + '          <strong>E-posta:</strong> <a class="inline" href="mailto:' + isletme.epostaInfo + '">' + isletme.epostaInfo + '</a><br />\n'
    + '          <strong>Web:</strong> ' + isletme.web + '\n'
    + '        </p>\n';
}

function sellerInfoEn() {
  return '        <h2>Seller Information</h2>\n'
    + '        <p>\n'
    + '          <strong>Legal Name:</strong> ' + isletme.unvan + '<br />\n'
    + '          <strong>Business Type:</strong> Sole Proprietorship (' + isletme.isletmeTuru + ')<br />\n'
    + '          <strong>Owner:</strong> ' + isletme.yetkili + '<br />\n'
    + '          <strong>Address:</strong> ' + isletme.adres + ', Türkiye<br />\n'
    + '          <strong>Phone:</strong> <a class="inline" href="' + isletme.telefonHref + '">' + isletme.telefonUluslararasi + '</a><br />\n'
    + '          <strong>Tax ID (VKN):</strong> ' + isletme.vkn + '<br />\n'
    + '          <strong>Tax Office:</strong> ' + isletme.vergiDairesi + '<br />\n'
    + '          <strong>Email:</strong> <a class="inline" href="mailto:' + isletme.epostaInfo + '">' + isletme.epostaInfo + '</a><br />\n'
    + '          <strong>Website:</strong> ' + isletme.web + '\n'
    + '        </p>\n';
}

/** N'inci `\n      </article>` kapanışının (6 boşluklu girinti) önüne,
    aynı girintiyi koruyarak bloğu ekler (yoksa). */
function blokEkle(html, baslikArama, blok, kapanisSirasi) {
  if (html.indexOf(baslikArama) !== -1) return html; // zaten var, dokunma
  const aranan = '\n      </article>';
  let index = -1;
  let bulunan = 0;
  let pos = 0;
  while (bulunan < kapanisSirasi) {
    pos = html.indexOf(aranan, pos);
    if (pos === -1) return html; // beklenen yapı yok, dokunma
    bulunan++;
    if (bulunan === kapanisSirasi) index = pos;
    else pos += aranan.length;
  }
  if (index === -1) return html;
  return html.slice(0, index + 1) + blok + html.slice(index + 1);
}

function tarihleriGuncelle(html) {
  html = html.replace(/Son güncelleme: \d{2}\.\d{2}\.\d{4}/g, 'Son güncelleme: ' + GUNCELLEME_TARIHI);
  html = html.replace(/Last updated: \d{2}\.\d{2}\.\d{4}/g, 'Last updated: ' + GUNCELLEME_TARIHI);
  return html;
}

function footerYenile(html) {
  // Telif metni
  html = html.replace(
    /data-t-tr="© 2026 Cyber Lion AI — Tüm Hakları Saklıdır\." data-t-en="© 2026 Cyber Lion AI — All Rights Reserved\."[^>]*>[^<]*</,
    'data-t-tr="© 2026 Ali Kotan - Şahıs İşletmesi" data-t-en="© 2026 Ali Kotan - Sole Proprietorship">© 2026 Ali Kotan - Şahıs İşletmesi<'
  );
  // 7. link: Ön Bilgilendirme Formu (mesafeli satış ile teslimat-iade arasına)
  if (html.indexOf('on-bilgilendirme-formu') === -1) {
    html = html.replace(
      /(<a href="\/pages\/mesafeli-satis-sozlesmesi"[^<]*<\/a>\s*\n)(\s*)(<a href="\/pages\/teslimat-ve-iade-sartlari")/,
      '$1$2<a href="/pages/on-bilgilendirme-formu" data-t-tr="Ön Bilgilendirme Formu" data-t-en="Pre-Contractual Information Form">Ön Bilgilendirme Formu</a>\n$2$3'
    );
  }
  return html;
}

function tamIsle(html) {
  html = tarihleriGuncelle(html);
  html = footerYenile(html);
  html = blokEkle(html, '<h2>Satıcı Bilgileri</h2>', satinBilgileriTr(), 1);
  html = blokEkle(html, '<h2>Seller Information</h2>', sellerInfoEn(), 2);
  return html;
}

function sadeceFooterIsle(html) {
  html = tarihleriGuncelle(html);
  html = footerYenile(html);
  return html;
}

function dosyayiIsle(dosyaAdi) {
  const tamYol = path.join(PAGES_DIR, dosyaAdi);
  if (!fs.existsSync(tamYol)) return null;
  const once = fs.readFileSync(tamYol, 'utf8');
  const html = tamIsle(once);
  if (html !== once) fs.writeFileSync(tamYol, html, 'utf8');
  return html !== once;
}

function main() {
  const check = process.argv.indexOf('--check') !== -1;
  let degisti = false;

  if (check) {
    for (const dosya of HEDEF_SAYFALAR) {
      const tamYol = path.join(PAGES_DIR, dosya);
      if (!fs.existsSync(tamYol)) continue;
      const once = fs.readFileSync(tamYol, 'utf8');
      const sonraki = tamIsle(once);
      if (sonraki !== once) {
        console.error('Bayat: ' + dosya);
        degisti = true;
      }
    }
    for (const tamYol of FOOTER_PAYLASAN_DOSYALAR) {
      if (!fs.existsSync(tamYol)) continue;
      const once = fs.readFileSync(tamYol, 'utf8');
      const sonraki = sadeceFooterIsle(once);
      if (sonraki !== once) {
        console.error('Bayat (footer): ' + path.relative(ROOT, tamYol));
        degisti = true;
      }
    }
    if (degisti) process.exit(1);
    console.log('Güncel');
    return;
  }

  for (const dosya of HEDEF_SAYFALAR) {
    const sonuc = dosyayiIsle(dosya);
    if (sonuc === null) console.log('atlandı (yok): ' + dosya);
    else console.log((sonuc ? 'güncellendi: ' : 'değişmedi: ') + dosya);
  }

  for (const tamYol of FOOTER_PAYLASAN_DOSYALAR) {
    const ad = path.relative(ROOT, tamYol);
    if (!fs.existsSync(tamYol)) { console.log('atlandı (yok): ' + ad); continue; }
    const once = fs.readFileSync(tamYol, 'utf8');
    const html = sadeceFooterIsle(once);
    if (html !== once) fs.writeFileSync(tamYol, html, 'utf8');
    console.log((html !== once ? 'güncellendi: ' : 'değişmedi: ') + ad);
  }
}

main();
