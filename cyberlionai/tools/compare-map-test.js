'use strict';

/**
 * compare-table.js eşleme sınaması — AĞ GEREKTİRMEZ.
 *
 *   node tools/compare-map-test.js
 *
 * NEDEN VAR
 *
 * Tabloda iki araç aynı "pass" harfini FARKLI GERÇEKLER için üretebiliyor.
 * Ölçüldü (koşu 34666166719): Observatory `cross-origin-resource-sharing`
 * testinde başlık HİÇ YOKKEN `pass=true result=...-not-implemented` diyor.
 * Biz aynı durumda `skipped` diyoruz. İki taraf da "geçti" harfi üretince
 * tablo bunu mutabakat sayıyordu — oysa biri "başlık var ve makul", diğeri
 * "başlık hiç yok" diyordu. Bu sınama o yanlış mutabakatın geri gelmesini
 * engelliyor.
 *
 * Aynı ölçüde önemli olan ters yön: `pass=false` ile gelen yokluklar
 * (x-frame-options gibi) GERÇEK bir yargıdır ve mutabakata girmeye devam
 * etmeli. Düzeltmenin onları da yutmadığı burada sınanıyor.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BETIK = path.join(__dirname, 'compare-table.js');
const YESIL = '[32m';
const KIRMIZI = '[31m';
const KALIN = '[1m';
const SIFIRLA = '[0m';

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'));

function calistir(bizimChecks, obsTests) {
  const b = path.join(gecici, 'bizim.json');
  const o = path.join(gecici, 'obs.json');
  const s = path.join(gecici, 'ssl.json');
  fs.writeFileSync(b, JSON.stringify({
    score: 100,
    checks: Object.keys(bizimChecks).map(function (id) {
      return { id: id, status: bizimChecks[id], severity: 'info' };
    })
  }));
  fs.writeFileSync(o, JSON.stringify({ grade: 'A', score: 100, tests: obsTests }));
  fs.writeFileSync(s, JSON.stringify({ status: 'READY', endpoints: [] }));
  return execFileSync('node', [BETIK, b, o, s], { encoding: 'utf8' });
}

/** Tablodan bir satırın hücrelerini çeker. */
function satir(cikti, ad) {
  const bulunan = cikti.split('\n').filter(function (l) {
    return l.indexOf('| ' + ad + ' ') === 0;
  })[0];
  assert.ok(bulunan, ad + ' satırı tabloda yok');
  const h = bulunan.split('|').map(function (c) { return c.trim(); });
  return { bizim: h[2], obs: h[3], mutabakat: h[5] };
}

function sayi(cikti, etiket) {
  const m = new RegExp(etiket + '\\s*:\\s*%?(\\d+)').exec(cikti);
  return m ? Number(m[1]) : null;
}

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

process.stdout.write(KALIN + 'Yokluk "geçti" sayılmamalı' + SIFIRLA + '\n');

dene('CORS: başlık bizde VAR, Observatory "not-implemented" → mutabakat sayılmaz', function () {
  const c = calistir(
    { cors: 'pass' },
    { 'cross-origin-resource-sharing': { pass: true, result: 'cross-origin-resource-sharing-not-implemented', score_modifier: 0 } }
  );
  const r = satir(c, 'CORS');
  assert.strictEqual(r.obs, '⏸', 'Observatory hücresi ⏸ olmalı, ' + r.obs + ' geldi');
  assert.strictEqual(r.mutabakat, '—', 'satır mutabakata girmemeli');
});

dene('COEP: iki taraf da ölçmedi → karşılaştırılabilir 0', function () {
  const c = calistir(
    { coep: 'skipped' },
    { 'cross-origin-embedder-policy': { pass: true, result: 'coep-not-implemented', score_modifier: 0 } }
  );
  assert.strictEqual(satir(c, 'COEP').mutabakat, '—');
  assert.strictEqual(sayi(c, 'Karşılaştırılabilir kontrol'), 0);
});

process.stdout.write(KALIN + 'Gerçek yargılar korunmalı' + SIFIRLA + '\n');

dene('X-Frame-Options yokluğu pass=false ile geliyorsa mutabakat SAYILIR', function () {
  const c = calistir(
    { xframe: 'fail' },
    { 'x-frame-options': { pass: false, result: 'x-frame-options-not-implemented', score_modifier: -20 } }
  );
  const r = satir(c, 'X-Frame-Options');
  assert.strictEqual(r.obs, '❌');
  assert.strictEqual(r.mutabakat, '✅');
  assert.strictEqual(sayi(c, 'Uyuşan'), 1);
});

dene('COOP uygulanmışsa iki taraf da geçti → mutabakat', function () {
  const c = calistir(
    { coop: 'pass' },
    { 'cross-origin-opener-policy': { pass: true, result: 'coop-implemented-with-same-origin', score_modifier: 10 } }
  );
  assert.strictEqual(satir(c, 'COOP').mutabakat, '✅');
});

dene('pass=null (çerez bulunamadı) hâlâ ölçülemedi sayılıyor', function () {
  const c = calistir(
    { cookies: 'skipped' },
    { cookies: { pass: null, result: 'cookies-not-found', score_modifier: 0 } }
  );
  assert.strictEqual(satir(c, 'Çerez bayrakları').obs, '⏸');
});

dene('gerçek anlaşmazlık ❌ olarak görünür', function () {
  const c = calistir(
    { csp: 'pass' },
    { 'content-security-policy': { pass: false, result: 'csp-not-implemented', score_modifier: -25 } }
  );
  const r = satir(c, 'CSP');
  assert.strictEqual(r.mutabakat, '❌');
  assert.strictEqual(sayi(c, 'Uyuşan'), 0);
  assert.strictEqual(sayi(c, 'Karşılaştırılabilir kontrol'), 1);
});

fs.rmSync(gecici, { recursive: true, force: true });
process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
