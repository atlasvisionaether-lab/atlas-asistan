'use strict';

/**
 * "Puan dışı" etiketleri ve not çevirileri — AĞ GEREKTİRMEZ.
 *
 *   node tools/skiplabel-test.js
 *
 * NEDEN VAR
 *
 * İki gerçek kusurdan doğdu:
 *
 *   1. Bir müşteri raporunda kullanıcıya HAM ANAHTAR göründü:
 *      "scan_note_not_implemented". Motor `not_implemented` notunu üretiyordu
 *      ama sözlükte karşılığı yoktu ve t() eksik çeviride anahtarın kendisini
 *      döndürüyor. Motora not eklemek KOLAY, sözlüğü güncellemeyi unutmak da
 *      o kadar kolay — bu yüzden artık sınanıyor.
 *
 *   2. Atlanan kontrollerin etiketi iki yerde türetiliyor: arayüzde
 *      (index.html) ve PDF'te (api/_lib/report.js). İkisi ayrışırsa aynı
 *      tarama iki farklı şey söyler. Listeler burada karşılaştırılıyor.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

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

const KOK = path.join(__dirname, '..');
const SAYFA = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
const RAPOR = fs.readFileSync(path.join(KOK, 'api', '_lib', 'report.js'), 'utf8');
const MOTOR = fs.readFileSync(path.join(KOK, 'api', '_lib', 'scanner.js'), 'utf8');

/** `['a', 'b']` biçimindeki bir dizi değişmezini okur. */
function diziOku(kaynak, ad) {
  const re = new RegExp(ad + '\\s*=\\s*\\[([^\\]]*)\\]');
  const m = re.exec(kaynak);
  assert.ok(m, ad + ' bulunamadı');
  return (m[1].match(/'([^']+)'/g) || []).map(function (x) { return x.slice(1, -1); });
}

process.stdout.write(KALIN + 'Motorun ürettiği her not çevrilmiş mi' + SIFIRLA + '\n');

/* Motorun GERÇEKTEN ürettiği notlar kaynaktan okunuyor; elle tutulan bir liste
   ile karşılaştırmak, listeyi güncellemeyi unutmak demek olurdu. */
const NOTLAR = Array.from(new Set(
  (MOTOR.match(/note:\s*'([a-z_]+)'/g) || []).map(function (x) {
    return /'([a-z_]+)'/.exec(x)[1];
  })
));

dene('motor en az beş farklı not üretiyor (okuma doğru çalışıyor)', function () {
  assert.ok(NOTLAR.length >= 5, 'yalnızca ' + NOTLAR.length + ' not okundu: ' + NOTLAR.join(', '));
});

['tr', 'en'].forEach(function (dil) {
  /* Sözlükteki `note: { ... }` bloğu. İki dil için iki blok var; sırayla
     `tr` ve `en` — dosyadaki sıra da bu. */
  const bloklar = SAYFA.split(/note:\s*\{/).slice(1);
  const blok = dil === 'tr' ? bloklar[0] : bloklar[1];

  NOTLAR.forEach(function (not) {
    dene(dil.toUpperCase() + ' sözlüğünde "' + not + '" karşılığı var', function () {
      assert.ok(blok, dil + ' not bloğu bulunamadı');
      const govde = blok.slice(0, blok.indexOf('},'));
      assert.ok(new RegExp('(^|\\s)' + not + '\\s*:').test(govde),
        'çeviri yok — kullanıcı arayüzde ham anahtarı görür');
    });
  });
});

process.stdout.write(KALIN + 'Arayüz ile PDF aynı ayrımı yapıyor' + SIFIRLA + '\n');

const SAYFA_NA = diziOku(SAYFA, 'SKIP_NA');
const SAYFA_NI = diziOku(SAYFA, 'SKIP_NI');
const RAPOR_NA = diziOku(RAPOR, 'SKIP_NA');
const RAPOR_NI = diziOku(RAPOR, 'SKIP_NI');

dene('"uygulanabilir değil" listeleri birebir aynı', function () {
  assert.deepStrictEqual(SAYFA_NA.slice().sort(), RAPOR_NA.slice().sort());
});

dene('"uygulanmamış" listeleri birebir aynı', function () {
  assert.deepStrictEqual(SAYFA_NI.slice().sort(), RAPOR_NI.slice().sort());
});

dene('iki liste kesişmiyor (bir not tek bir anlama gelir)', function () {
  const kesisim = SAYFA_NA.filter(function (x) { return SAYFA_NI.indexOf(x) !== -1; });
  assert.deepStrictEqual(kesisim, []);
});

dene('listelenen her not motorda gerçekten üretiliyor', function () {
  SAYFA_NA.concat(SAYFA_NI).forEach(function (not) {
    assert.ok(NOTLAR.indexOf(not) !== -1,
      '"' + not + '" motorda üretilmiyor — ölü kural');
  });
});

dene('sınıflandırılmamış notlar "ölçülemedi" olarak kalıyor', function () {
  /* not_measured BİLEREK sınıflandırılmıyor: TLS el sıkışması denendi ve
     başarısız oldu; bu gerçekten bir ölçüm başarısızlığı, nötr bir "uygulanabilir
     değil" değil. Kural bozulursa etiket yalan söyler. */
  assert.ok(SAYFA_NA.indexOf('not_measured') === -1 && SAYFA_NI.indexOf('not_measured') === -1,
    'not_measured sınıflandırılmış — gerçek ölçüm başarısızlığı gizleniyor');
});

process.stdout.write(KALIN + 'Etiketler iki dilde de tanımlı' + SIFIRLA + '\n');

['skippedNa', 'skippedNi'].forEach(function (anahtar) {
  dene('arayüz sözlüğünde ' + anahtar + ' iki dilde var', function () {
    const sayi = (SAYFA.match(new RegExp(anahtar + ':', 'g')) || []).length;
    assert.ok(sayi >= 2, 'yalnızca ' + sayi + ' tanım bulundu (TR ve EN gerekli)');
  });
  dene('PDF sözlüğünde ' + anahtar + ' iki dilde var', function () {
    const sayi = (RAPOR.match(new RegExp(anahtar + ':', 'g')) || []).length;
    assert.ok(sayi >= 2, 'yalnızca ' + sayi + ' tanım bulundu (TR ve EN gerekli)');
  });
});

dene('PDF durum etiketi notu dikkate alıyor', function () {
  assert.ok(/L\.states\[stateKey\(item\)\]/.test(RAPOR),
    'PDF hâlâ yalnızca item.status ile etiket seçiyor');
});

dene('skor hesabı DEĞİŞMEDİ (etiket ayrımı puanı etkilemez)', function () {
  /* Bu değişiklik yalnızca ETİKET. Atlanan kontrollerin skora girmemesi
     kuralına dokunulmadığı burada kilitleniyor. */
  assert.ok(/status === 'pass' \|\| c\.status === 'fail'/.test(MOTOR),
    'scoreOf artık yalnızca ölçülen kontrollere bakmıyor');
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
