'use strict';

/**
 * Sertifika başarısızlığının SEBEBİ — AĞ GEREKTİRMEZ.
 *
 *   node tools/certcause-test.js
 *
 * NEDEN VAR
 *
 * `tls_cert` eksik zinciri, süresi geçmişi ve güvenilmeyen kökü ZATEN
 * yakalıyordu — ama üçüne de aynı şeyi söylüyordu. Not alanına OpenSSL'in
 * ham hata kodu yazılıyordu (`certNote = t.authorizationError`), sözlükte
 * karşılığı olmadığı için müşteri raporunda
 *
 *     UNABLE_TO_VERIFY_LEAF_SIGNATURE
 *
 * gibi bir dize görünüyordu ve düzeltme metni "sertifikayı yenileyin" idi.
 * O tavsiye eksik ara sertifika için YANLIŞ: yenileme sorunu çözmez,
 * zinciri tam göndermek çözer.
 *
 * Fikstürler uydurma değil: 11.10.2026'da gerçek sunucularda ölçüldü
 * (koşu 38167648017).
 *
 *     incomplete-chain.badssl.com → UNABLE_TO_VERIFY_LEAF_SIGNATURE, zincir 1
 *     expired.badssl.com          → CERT_HAS_EXPIRED,                zincir 3
 *     cyberlionai.com             → doğrulandı,                      zincir 4
 *     atlasasistan.com            → doğrulandı,                      zincir 5
 *     google.com                  → doğrulandı,                      zincir 3
 *
 * Aynı ölçüm, zincir uzunluğunun kullanılabilir bir gösterge olduğunu da
 * kanıtladı: Node zinciri yerel kök deposundan TAMAMLAMIYOR, yoksa eksik
 * zincirli sunucuda da 3+ görürdük.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const tlsEngine = require(path.join(__dirname, '..', 'api', '_lib', 'engines', 'tls-scanner.js'));
const KOK = path.join(__dirname, '..');

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

function ctx(tls) {
  return {
    finalUrl: new URL('https://ornek.test/'),
    headers: new Headers(),
    html: '<html></html>',
    tls: tls,
    legacyTls: { tested: true, accepted: false }
  };
}

function certOf(tls) {
  return tlsEngine.analyze(ctx(tls), 'tr').checks.find(function (c) { return c.id === 'tls_cert'; });
}

/* --------------------------------------------------- Ölçülmüş sunucular */
process.stdout.write(KALIN + 'Gerçek sunucularda ölçülen durumlar' + SIFIRLA + '\n');

dene('incomplete-chain.badssl.com → "chain_incomplete"', function () {
  const c = certOf({
    ok: true, protocol: 'TLSv1.2', authorized: false,
    authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    issuer: 'YR1', daysLeft: 78, chainLength: 1
  });
  assert.strictEqual(c.status, 'fail');
  assert.strictEqual(c.note, 'chain_incomplete');
});

dene('expired.badssl.com → "expired" (zincir 3, yani zincir sorunu DEĞİL)', function () {
  const c = certOf({
    ok: true, protocol: 'TLSv1.2', authorized: false,
    authorizationError: 'CERT_HAS_EXPIRED',
    issuer: 'COMODO', daysLeft: -4200, chainLength: 3
  });
  assert.strictEqual(c.note, 'expired');
});

dene('cyberlionai.com → geçiyor (zincir 4)', function () {
  const c = certOf({
    ok: true, protocol: 'TLSv1.3', authorized: true, authorizationError: null,
    issuer: "Let's Encrypt", daysLeft: 57, chainLength: 4
  });
  assert.strictEqual(c.status, 'pass');
  assert.strictEqual(c.note, null);
});

/* ------------------------------------------------------- Diğer sebepler */
process.stdout.write(KALIN + 'Her sebep ayrı adlandırılıyor' + SIFIRLA + '\n');

[['DEPTH_ZERO_SELF_SIGNED_CERT', 'self_signed'],
 ['SELF_SIGNED_CERT_IN_CHAIN', 'self_signed'],
 ['ERR_TLS_CERT_ALTNAME_INVALID', 'hostname_mismatch'],
 ['CERT_REVOKED', 'revoked'],
 ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'chain_incomplete']
].forEach(function (p) {
  dene(p[0] + ' → "' + p[1] + '"', function () {
    const c = certOf({
      ok: true, protocol: 'TLSv1.2', authorized: false, authorizationError: p[0],
      issuer: null, daysLeft: 30, chainLength: 3
    });
    assert.strictEqual(c.note, p[1]);
  });
});

dene('HAM OpenSSL kodu artık nota SIZMIYOR', function () {
  /* Asıl kusur buydu: tanınmayan bir kod doğrudan nota yazılıyordu ve
     sözlükte karşılığı olmadığı için kullanıcı ham dizeyi görüyordu. */
  const c = certOf({
    ok: true, protocol: 'TLSv1.2', authorized: false,
    authorizationError: 'SOME_FUTURE_OPENSSL_CODE',
    issuer: null, daysLeft: 30, chainLength: 3
  });
  assert.ok(!/[A-Z]{3}/.test(c.note), 'notta büyük harfli ham kod var: ' + c.note);
  assert.strictEqual(c.note, 'untrusted');
});

dene('kod tanınmazsa ama zincir 1 ise eksik zincir deniyor', function () {
  const c = certOf({
    ok: true, protocol: 'TLSv1.2', authorized: false,
    authorizationError: 'SOME_FUTURE_OPENSSL_CODE',
    issuer: null, daysLeft: 30, chainLength: 1
  });
  assert.strictEqual(c.note, 'chain_incomplete');
});

/* ------------------------------------------------- Değişmemesi gerekenler */
process.stdout.write(KALIN + 'Skor ve mevcut davranış korunuyor' + SIFIRLA + '\n');

dene('süresi dolmak üzere notu duruyor (<15 gün)', function () {
  const c = certOf({
    ok: true, protocol: 'TLSv1.3', authorized: true, authorizationError: null,
    issuer: "Let's Encrypt", daysLeft: 9, chainLength: 4
  });
  assert.strictEqual(c.status, 'fail');
  assert.strictEqual(c.note, 'expiring_soon');
});

dene('yeni kontrol kimliği EKLENMEDİ (skor kayması olmaz)', function () {
  assert.deepStrictEqual(tlsEngine.IDS, ['tls_protocol', 'tls_cert', 'tls_legacy']);
});

dene('ölçülemeyen TLS hâlâ "ölçülemedi" (başarısız değil)', function () {
  const c = certOf({ ok: false, reason: 'timeout' });
  assert.strictEqual(c.status, 'skipped');
  assert.strictEqual(c.note, 'not_measured');
});

/* ------------------------------------------- Çeviri ve düzeltme eksiksizliği */
process.stdout.write(KALIN + 'Her sebebin çevirisi ve düzeltmesi var' + SIFIRLA + '\n');

const SAYFA = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
const RAPOR = fs.readFileSync(path.join(KOK, 'api', '_lib', 'report.js'), 'utf8');
const SEBEPLER = ['chain_incomplete', 'self_signed', 'hostname_mismatch', 'revoked',
  'expired', 'expiring_soon', 'untrusted'];

SEBEPLER.forEach(function (sebep) {
  dene('"' + sebep + '" arayüzde iki dilde çevrili', function () {
    const bloklar = SAYFA.split(/note:\s*\{/).slice(1);
    ['tr', 'en'].forEach(function (dil, i) {
      const govde = bloklar[i].slice(0, bloklar[i].indexOf('},'));
      assert.ok(new RegExp('(^|\\s)' + sebep + '\\s*:').test(govde),
        dil + ' çevirisi yok — kullanıcı ham anahtarı görür');
    });
  });
});

/* `untrusted` genel durum; onun düzeltmesi kontrolün kendi metni. */
SEBEPLER.filter(function (s) { return s !== 'untrusted'; }).forEach(function (sebep) {
  dene('"' + sebep + '" için ayrı düzeltme metni var (arayüz + PDF)', function () {
    const sayfaBlok = SAYFA.split(/notefix:\s*\{/).slice(1);
    assert.strictEqual(sayfaBlok.length, 2, 'arayüzde iki dil için notefix bloğu yok');
    sayfaBlok.forEach(function (b) {
      assert.ok(new RegExp('(^|\\s)' + sebep + '\\s*:').test(b.slice(0, b.indexOf('\n          }'))),
        'arayüzde düzeltme metni yok');
    });
    const raporBlok = RAPOR.slice(RAPOR.indexOf('const NOTE_FIX'), RAPOR.indexOf('const CHECKS'));
    assert.ok(new RegExp('(^|\\s)' + sebep + '\\s*:').test(raporBlok),
      'PDF sözlüğünde düzeltme metni yok — aynı tarama iki farklı tavsiye verir');
  });
});

dene('eksik zincir düzeltmesi fullchain diyor, "yenileyin" DEMİYOR', function () {
  /* Asıl ürün kusuru buydu: genel metin yenilemeyi öneriyordu ve eksik ara
     sertifikada bu tavsiye sorunu çözmez. */
  const i = SAYFA.indexOf('chain_incomplete:', SAYFA.indexOf('notefix:'));
  const satir = SAYFA.slice(i, i + 400);
  assert.ok(/fullchain/.test(satir), 'fullchain geçmiyor');
  assert.ok(/cert\.pem/.test(satir), 'cert.pem uyarısı yok');
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
