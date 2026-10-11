'use strict';

/**
 * Elle yazılmış yasal sayfalar + altbilgi — iyzico canlı onayı için. Ağsız.
 *
 *   node tools/legal-identity-test.js
 *
 * NEDEN VAR
 *
 * `legal/*.md` → kök HTML hattı `tools/legal-md-test.js` ile kilitli: kimlik
 * `legal-data.js`'ten geliyor, bayatlarsa sınama kalıyor. AMA iki yasal sayfa
 * o hattın DIŞINDA, elle yazılmış ve altbilgiden bağlanıyor:
 *
 *   pages/on-bilgilendirme-formu.html   (Mesafeli Sözleşmeler Yönetmeliği m.5)
 *   pages/cerez-politikasi.html
 *
 * Yani bugün `legal-data.js`'teki adres ya da telefon değişse, iyzico'nun
 * istediği bu iki belge SESSİZCE eski kalır ve hiçbir sınama düşmez. Aynı
 * şekilde fiyat `api/_lib/plans.js`'te değişse, SÖZLEŞME METNİ eski fiyatı
 * yazmaya devam eder — kozmetik bir sapma değil, bağlayıcı bir belgede yanlış
 * fiyat.
 *
 * Bu sınama o boşluğu kapatıyor. Sayfaları ÜRETİLMİŞ hâle çevirmek daha
 * temiz olurdu; bugünün kararı küçük olanı yapmak: sapmayı yakalamak.
 *
 * Ayrıca iyzico'nun altbilgi listesi burada kilitli: unvan + adres + telefon
 * + e-posta. Bir arayüz düzenlemesi bunlardan birini sessizce düşürürse
 * başvuru reddedilir; o yüzden sınama bunu da tutuyor.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const KOK = path.join(__dirname, '..');
const { isletme } = require(path.join(KOK, 'legal-data.js'));
const { PLANS } = require(path.join(KOK, 'api', '_lib', 'plans.js'));

let gecti = 0;
let kalan = 0;
function dene(ad, fn) {
  try {
    fn();
    gecti++;
    process.stdout.write('  ' + YESIL + 'GEÇTİ' + SIFIRLA + '  ' + ad + '\n');
  } catch (e) {
    kalan++;
    process.stdout.write('  ' + KIRMIZI + 'KALDI' + SIFIRLA + '  ' + ad + ' — ' + e.message + '\n');
  }
}

const oku = function (p) { return fs.readFileSync(path.join(KOK, p), 'utf8'); };

/* --------------------------------------------- Elle yazılmış yasal sayfalar */
process.stdout.write(KALIN + 'Elle yazılmış sayfalarda kimlik legal-data.js ile aynı' + SIFIRLA + '\n');

const ELLE = ['pages/on-bilgilendirme-formu.html', 'pages/cerez-politikasi.html'];

/* `legal-data.js`'in SATICI kimliği alanları. Bir alan eklenirse burası da
   büyür: amaç listeyi elle güncellemek değil, nesneden okumak. */
const KIMLIK = ['unvan', 'telefonGoruntu', 'vkn', 'vergiDairesi', 'epostaInfo'];

ELLE.forEach(function (dosya) {
  const html = oku(dosya);
  KIMLIK.forEach(function (alan) {
    dene(dosya + ': ' + alan, function () {
      const deger = isletme[alan];
      assert.ok(deger, 'legal-data.js içinde ' + alan + ' boş');
      assert.ok(html.indexOf(deger) !== -1,
        'sayfada yok: "' + deger + '" — legal-data.js değişti, sayfa bayat kaldı');
    });
  });

  /* Adres iki biçimde yazılıyor: sayfalar uzun hâli (`adres`), altbilgi kısa
     hâli (`adresKisa`) kullanıyor. İkisi de legal-data.js'ten; sınama birini
     şart koşmamalı — ilk sürüm `adresKisa` arayıp bu iki sayfayı haksız yere
     "bayat" gösterdi. */
  dene(dosya + ': adres (uzun ya da kısa biçim)', function () {
    assert.ok(html.indexOf(isletme.adres) !== -1 || html.indexOf(isletme.adresKisa) !== -1,
      'iki adres biçiminden hiçbiri yok — legal-data.js değişti, sayfa bayat kaldı');
  });

  dene(dosya + ': ESKİ unvan geri gelmemiş', function () {
    assert.ok(!/Ünvan:\s*Cyber Lion AI/.test(html), 'bir kez düzeltilen yanlış unvan geri gelmiş');
  });
});

/* --------------------------------------------------------- Bağlayıcı fiyat */
process.stdout.write(KALIN + 'Sözleşme metinlerindeki fiyat plans.js ile aynı' + SIFIRLA + '\n');

/* Yönetmelik m.5/1-c "tüm vergiler dâhil toplam fiyat" istiyor. Ön
   Bilgilendirme Formu'nun 3. bölümünün BAŞLIĞI bunu söylüyordu ama GÖVDESİ
   yalnızca "+ KDV" yazıp brüt tutarı ödeme adımına bırakıyordu; bu sınama
   eklendiğinde durum tam olarak buydu. */
const BELGELER = ['pages/on-bilgilendirme-formu.html', 'legal/mesafeli-satis-sozlesmesi.md'];

BELGELER.forEach(function (dosya) {
  const metin = oku(dosya);
  ['pro', 'enterprise'].forEach(function (id) {
    const p = PLANS[id];
    dene(dosya + ': ' + id + ' net fiyat (' + p.priceTry + ')', function () {
      /* Markdown "299 TL", HTML "₺299" yazıyor; ikisi de aynı sayı. */
      const sayi = p.tr.price.replace(/[^0-9.]/g, '').replace(/\/.*$/, '');
      assert.ok(metin.indexOf(sayi) !== -1, 'net fiyat yok: ' + sayi);
    });
    dene(dosya + ': ' + id + ' KDV DAHİL tutar (' + p.tr.gross + ')', function () {
      const brut = p.tr.gross.replace('₺', '');
      assert.ok(metin.indexOf(brut) !== -1,
        'brüt tutar yok: ' + brut + ' — yönetmelik "vergiler dâhil toplam fiyat" istiyor');
    });
  });
});

/* ------------------------------------------------------- iyzico altbilgisi */
process.stdout.write(KALIN + 'Altbilgi iyzico listesini karşılıyor' + SIFIRLA + '\n');

const INDEX = oku('index.html');
const ALT = INDEX.slice(INDEX.lastIndexOf('<footer'));

[['unvan', isletme.unvan],
 ['adres', isletme.adresKisa],
 ['telefon', isletme.telefonGoruntu],
 ['e-posta', isletme.epostaInfo]
].forEach(function (p) {
  dene('altbilgide ' + p[0], function () {
    assert.ok(ALT.indexOf(p[1]) !== -1,
      'altbilgide yok: "' + p[1] + '" — iyzico başvurusu bunu şart koşuyor');
  });
});

/* ------------------------------------- Altbilgideki yasal bağlantılar canlı */
process.stdout.write(KALIN + 'Altbilgideki her yasal bağlantı bir dosyaya çıkıyor' + SIFIRLA + '\n');

const vercel = JSON.parse(oku('vercel.json'));
const YON = {};
(vercel.redirects || []).forEach(function (r) { YON[r.source] = r.destination; });

const BAGLAR = Array.from(new Set(
  (ALT.match(/href="(\/[a-z0-9\-/]*)"/g) || [])
    .map(function (x) { return /href="([^"]+)"/.exec(x)[1]; })
)).filter(function (x) { return x !== '/' && x !== ''; });

dene('altbilgide en az sekiz yasal bağlantı var (okuma doğru çalışıyor)', function () {
  assert.ok(BAGLAR.length >= 8, 'yalnızca ' + BAGLAR.length + ' bağlantı okundu');
});

BAGLAR.forEach(function (yol) {
  dene('bağlantı çözülüyor: ' + yol, function () {
    const hedef = YON[yol] || yol;
    const dosya = /\.html$/.test(hedef) ? hedef : hedef + '.html';
    assert.ok(fs.existsSync(path.join(KOK, dosya.replace(/^\//, ''))),
      'dosya yok: ' + dosya + ' — altbilgideki yasal bağlantı 404 veriyor');
  });
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
