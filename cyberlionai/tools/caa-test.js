'use strict';

/**
 * CAA değerlendiricisi — AĞ GEREKTİRMEZ.
 *
 *   node tools/caa-test.js
 *
 * NEDEN VAR
 *
 * Örnekler uydurma değil: 12 Eylül 2026'da gerçek alan adlarından ölçüldü
 * (koşu 34712747409). İki tuzağı kilitliyor:
 *
 *   1. `iodef` yetki sayılmamalı. cloudflare.com kaydında bir iodef (ihlal
 *      bildirim adresi) var; tek başına hiçbir makamı sınırlamaz. Onu yetki
 *      sayan bir kod, korumasız bir alan adına "CAA var" derdi.
 *
 *   2. Makam adı parametreli gelebiliyor: "digicert.com; cansignhttpexchanges=yes".
 *      Noktalı virgülden sonrasını kesmeyen bir kod raporda parametreyi
 *      makam adıymış gibi gösterir.
 *
 * Ayrıca: CAA ile DNSSEC aynı kayıtlı alan adı kuralını kullanıyor
 * (_lib/dnssec.js registrableDomain). İki ayrı kural iki ayrı cevap verirdi.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const caa = require(path.join(__dirname, '..', 'api', '_lib', 'caa.js'));
const dnsEngine = require(path.join(__dirname, '..', 'api', '_lib', 'engines', 'dns-scanner.js'));

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

/* ------------------------------------------------------------- Ayrıştırma */
process.stdout.write(KALIN + 'CAA kayıtlarının okunması' + SIFIRLA + '\n');

dene('kayıt yoksa "none"', function () {
  assert.strictEqual(caa.caaDegerlendir([]).durum, 'none');
  assert.strictEqual(caa.caaDegerlendir(null).durum, 'none');
});

dene('google.com: tek makam okunuyor', function () {
  const r = caa.caaDegerlendir([{ critical: 0, issue: 'pki.goog' }]);
  assert.strictEqual(r.durum, 'pass');
  assert.strictEqual(r.detay, 'pki.goog');
});

dene('parametreli makam adı temizleniyor', function () {
  const r = caa.caaDegerlendir([{ critical: 0, issue: 'digicert.com; cansignhttpexchanges=yes' }]);
  assert.strictEqual(r.detay, 'digicert.com');
});

dene('cloudflare.com: iodef tek başına yetki sayılmıyor', function () {
  const r = caa.caaDegerlendir([{ critical: 0, iodef: 'mailto:tls-abuse@cloudflare.com' }]);
  assert.strictEqual(r.durum, 'none');
});

dene('issuewild de yetki sayılıyor', function () {
  assert.strictEqual(caa.caaDegerlendir([{ critical: 0, issuewild: 'sectigo.com' }]).durum, 'pass');
});

dene('trendyol.com: 16 kayıt kısaltılarak özetleniyor', function () {
  const ham = ['comodoca.com', 'digicert.com; cansignhttpexchanges=yes', 'globalsign.com',
    'godaddy.com', 'letsencrypt.org', 'pki.goog; cansignhttpexchanges=yes',
    'sectigo.com', 'ssl.com'];
  const kayitlar = ham.map(function (x) { return { critical: 0, issue: x }; })
    .concat(ham.map(function (x) { return { critical: 0, issuewild: x }; }));
  const r = caa.caaDegerlendir(kayitlar);
  assert.strictEqual(r.durum, 'pass');
  assert.ok(/\+5$/.test(r.detay), 'kısaltma yok: ' + r.detay);
  assert.ok(r.detay.length < 60, 'satır çok uzun: ' + r.detay);
});

/* ------------------------------------------------------------ Motor davranışı */
process.stdout.write(KALIN + 'DNS motorunda CAA' + SIFIRLA + '\n');

function ctx(o) {
  const h = new Headers();
  return Object.assign({ finalUrl: new URL('https://ornek.test/'), headers: h, html: '<html></html>' }, o);
}

dene('bağlamda CAA yoksa kontrol HİÇ eklenmiyor', function () {
  /* Kalibrasyon sınaması buildChecks'i CAA'sız çağırıyor; kontrol oradan
     "ölçülemedi" olarak sızsaydı beyan edilen kontrol sayısı kayardı. */
  const c = dnsEngine.analyze(ctx({})).checks;
  assert.strictEqual(c.filter(function (x) { return x.id === 'caa'; }).length, 0);
});

dene('kayıt varsa geçiyor ve makam detaya yazılıyor', function () {
  const c = dnsEngine.analyze(ctx({ caa: { ok: true, kayitlar: [{ critical: 0, issue: 'letsencrypt.org' }] } })).checks;
  const x = c.find(function (y) { return y.id === 'caa'; });
  assert.strictEqual(x.status, 'pass');
  assert.strictEqual(x.detail, 'letsencrypt.org');
  assert.strictEqual(x.severity, 'info');
});

dene('kayıt yoksa "uygulanmamış" (BAŞARISIZ değil)', function () {
  /* SPF/DMARC'tan bilinçli ayrım: orada yokluk bugün herkesin yapabileceği
     somut bir açık; burada saldırı için bir sertifika makamının ihlali de
     gerekir. COOP/COEP kararıyla aynı çizgi. */
  const c = dnsEngine.analyze(ctx({ caa: { ok: true, kayitlar: [] } })).checks;
  const x = c.find(function (y) { return y.id === 'caa'; });
  assert.strictEqual(x.status, 'skipped');
  assert.strictEqual(x.note, 'not_implemented');
});

dene('sorgu düştüyse "ölçülemedi" deniyor, "yok" değil', function () {
  const c = dnsEngine.analyze(ctx({ caa: { ok: false, sebep: 'not_measured' } })).checks;
  const x = c.find(function (y) { return y.id === 'caa'; });
  assert.strictEqual(x.status, 'skipped');
  assert.strictEqual(x.note, 'not_measured');
});

dene('motor kimlik listesinde caa var (sıralama için)', function () {
  assert.ok(dnsEngine.IDS.indexOf('caa') !== -1, 'IDS içinde caa yok — rapor sırası kayar');
});

/* ------------------------------------------------------- Paylaşılan kurallar */
process.stdout.write(KALIN + 'Kayıtlı alan adı ve gizlilik' + SIFIRLA + '\n');

dene('kayıtlı alan adı kuralı DNSSEC ile paylaşılıyor', function () {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'caa.js'), 'utf8');
  assert.ok(/require\('\.\/dnssec\.js'\)/.test(kaynak),
    'kendi alan adı kuralını yazıyor — iki kural iki ayrı cevap verir');
});

dene('sorgu üçüncü taraf bir çözücüye gitmiyor', function () {
  /* Taranan adresi dışarıya bildirmemek bu projenin açık kararı (_lib/geo.js).
     DNSSEC tarafı DoH ile Cloudflare'a çıkıyor; CAA sistem çözümleyicisini
     kullanıyor ve burada sabit bir adres belirirse sınama kalır. */
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'caa.js'), 'utf8');
  assert.ok(!/['"]1\.1\.1\.1['"]|['"]8\.8\.8\.8['"]|dns-query/.test(kaynak),
    'kodda sabit bir üçüncü taraf çözücü adresi var');
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
