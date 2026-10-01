'use strict';

/**
 * CAA ve DNSSEC değerlendiricileri — AĞ GEREKTİRMEZ.
 *
 *   node tools/dnszone-test.js
 *
 * NEDEN VAR
 *
 * Örnekler 12 Eylül 2026'da gerçek alan adlarından ölçüldü (koşu 34712747409).
 * İki şeyi kilitliyor:
 *
 *   1. DNSSEC ölçütü DS kaydının VARLIĞI — AD biti değil. AD, sorulan
 *      çözücünün doğrulama yapıp yapmadığına bağlı ve nic.tr ölçümünde
 *      "ad yok" yanıtıyla birlikte AD=true geldi (imzalı olumsuz yanıt).
 *      AD'yi ölçüt yapan bir kod orada "DNSSEC var" derdi.
 *
 *   2. Ölçülemeyen ile olmayan AYRI. Üretim sunucusuz bir ortam ve UDP/53'ün
 *      orada çalıştığını bilmiyoruz. Sorgu düştüğünde "DNSSEC yok" demek,
 *      ölçmediğimiz bir şeyi rapor etmek olurdu.
 */

const assert = require('assert');
const path = require('path');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const z = require(path.join(__dirname, '..', 'api', '_lib', 'dnszone.js'));

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

/* ------------------------------------------------------------------- CAA */
process.stdout.write(KALIN + 'CAA' + SIFIRLA + '\n');

dene('kayıt yoksa "none"', function () {
  assert.strictEqual(z.caaDegerlendir([]).durum, 'none');
  assert.strictEqual(z.caaDegerlendir(null).durum, 'none');
});

dene('google.com: tek makam okunuyor', function () {
  const r = z.caaDegerlendir([{ critical: 0, issue: 'pki.goog' }]);
  assert.strictEqual(r.durum, 'pass');
  assert.strictEqual(r.detay, 'pki.goog');
});

dene('parametreli makam adı temizleniyor', function () {
  /* Gerçek kayıt: "digicert.com; cansignhttpexchanges=yes". Noktalı virgülden
     sonrası bir parametre, makam adının parçası değil. */
  const r = z.caaDegerlendir([{ critical: 0, issue: 'digicert.com; cansignhttpexchanges=yes' }]);
  assert.strictEqual(r.detay, 'digicert.com');
});

dene('cloudflare.com: iodef tek başına yetki sayılmıyor', function () {
  /* iodef bir RAPORLAMA adresidir; hiçbir makamı sınırlamaz. Yalnızca iodef
     taşıyan bir alan adı, CAA korumasına sahip değildir. */
  const r = z.caaDegerlendir([{ critical: 0, iodef: 'mailto:tls-abuse@cloudflare.com' }]);
  assert.strictEqual(r.durum, 'none');
});

dene('issuewild de yetki sayılıyor', function () {
  assert.strictEqual(z.caaDegerlendir([{ critical: 0, issuewild: 'sectigo.com' }]).durum, 'pass');
});

dene('trendyol.com: 16 kayıt kısaltılarak özetleniyor', function () {
  /* Ölçülen gerçek liste: sekiz makam, issue ve issuewild olarak iki kez.
     Tekrarlar ayıklanmalı, satır da makul uzunlukta kalmalı. */
  const ham = ['comodoca.com', 'digicert.com; cansignhttpexchanges=yes', 'globalsign.com',
    'godaddy.com', 'letsencrypt.org', 'pki.goog; cansignhttpexchanges=yes',
    'sectigo.com', 'ssl.com'];
  const kayitlar = ham.map(function (x) { return { critical: 0, issue: x }; })
    .concat(ham.map(function (x) { return { critical: 0, issuewild: x }; }));
  const r = z.caaDegerlendir(kayitlar);
  assert.strictEqual(r.durum, 'pass');
  assert.ok(/\+5$/.test(r.detay), 'kısaltma yok: ' + r.detay);
  assert.ok(r.detay.length < 60, 'satır çok uzun: ' + r.detay);
});

/* ---------------------------------------------------------------- DNSSEC */
process.stdout.write(KALIN + 'DNSSEC' + SIFIRLA + '\n');

dene('cloudflare.com: DS=2 → geçiyor', function () {
  const r = z.dnssecDegerlendir({ ok: true, rcode: 0, cevap: 2, ad: true });
  assert.strictEqual(r.durum, 'pass');
  assert.ok(/doğrulandı/.test(r.detay));
});

dene('google.com: DS=0 → imzasız', function () {
  assert.strictEqual(z.dnssecDegerlendir({ ok: true, rcode: 0, cevap: 0, ad: false }).durum, 'none');
});

dene('AD=true TEK BAŞINA "imzalı" saymıyor', function () {
  /* nic.tr ölçümü: rcode=3 (ad yok) ve AD=true. İmzalı bir OLUMSUZ yanıt.
     AD'yi ölçüt yapan bir kod burada "DNSSEC var" derdi. */
  const r = z.dnssecDegerlendir({ ok: true, rcode: 3, cevap: 0, ad: true });
  assert.strictEqual(r.durum, 'unknown');
  assert.strictEqual(r.not, 'not_measured');
});

dene('AD=false, DS var → yine geçiyor', function () {
  /* Çözücü doğrulama yapmıyor olabilir; bu, bölgenin imzasız olduğu anlamına
     gelmez. Ölçüt DS kaydının varlığı. */
  assert.strictEqual(z.dnssecDegerlendir({ ok: true, rcode: 0, cevap: 1, ad: false }).durum, 'pass');
});

dene('sorgu düşerse "bilinmiyor" (yok DEĞİL)', function () {
  assert.strictEqual(z.dnssecDegerlendir({ ok: false, hata: 'timeout' }).durum, 'unknown');
  assert.strictEqual(z.dnssecDegerlendir(null).durum, 'unknown');
});

dene('sunucu hatası (rcode=2) "imzasız" sayılmıyor', function () {
  assert.strictEqual(z.dnssecDegerlendir({ ok: true, rcode: 2, cevap: 0, ad: false }).durum, 'unknown');
});

/* ------------------------------------------------------------- Çözücü */
process.stdout.write(KALIN + 'Çözücü seçimi' + SIFIRLA + '\n');

dene('sistem çözücüsü kullanılıyor (üçüncü tarafa çıkılmıyor)', function () {
  /* Bu projede taranan adresi dışarıya bildirmeme kararı var (bkz. _lib/geo.js).
     Ham DNS sorgusu 1.1.1.1 gibi sabit bir adrese gitseydi, taranan her alan
     adını o servise bildirmiş olurduk. */
  const fs = require('fs');
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'dnszone.js'), 'utf8');
  assert.ok(/dns\.getServers\(\)/.test(kaynak), 'sistem çözücüsü okunmuyor');
  assert.ok(!/['"]1\.1\.1\.1['"]|['"]8\.8\.8\.8['"]/.test(kaynak),
    'kodda sabit bir üçüncü taraf çözücü adresi var');
});

dene('bir çözücü adresi bulunuyor ya da null dönüyor', function () {
  const s = z.sistemCozucusu();
  assert.ok(s === null || /^\d+\.\d+\.\d+\.\d+$/.test(s), 'beklenmeyen değer: ' + s);
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
