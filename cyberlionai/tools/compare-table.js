'use strict';

/**
 * Kontrol bazında mutabakat tablosu.
 *
 *   node tools/compare-table.js <bizim.json> <observatory.json> <ssllabs.json>
 *
 * NEDEN SKOR DEĞİL KONTROL
 *
 * Üç araç farklı kapsamları ölçüyor. SSL Labs yalnızca TLS yapılandırmasına
 * bakar; Observatory başlıklara ve çerezlere; biz ikisinin karışımına. Skorları
 * yan yana koymak, birbirine çevrilemeyen üç birimi toplamak olurdu.
 *
 * Cevaplanabilir soru: AYNI GERÇEĞİ Mİ ÖLÇÜYORUZ? Bir araç bir kontrolü hiç
 * test etmiyorsa "—" yazılır ve bu MUTABAKATSIZLIK SAYILMAZ — ölçmediği bir
 * şeyde anlaşmazlık olmaz.
 *
 * Eşleme tablosu aşağıda açıkça beyan ediliyor. Bir dış araç test adını
 * değiştirirse eşleme "yok" görünür ve bu, sessiz yanlış eşlemeden iyidir.
 */

const fs = require('fs');

/* Bizim kontrol -> dis araclardaki karsiligi. null = o arac bunu test ETMIYOR. */
const ESLEME = {
  https:         { obs: 'redirection',                ssl: null,        ad: 'HTTPS / yönlendirme' },
  hsts:          { obs: 'strict-transport-security',  ssl: null,        ad: 'HSTS' },
  csp:           { obs: 'content-security-policy',    ssl: null,        ad: 'CSP' },
  xframe:        { obs: 'x-frame-options',            ssl: null,        ad: 'X-Frame-Options' },
  nosniff:       { obs: 'x-content-type-options',     ssl: null,        ad: 'X-Content-Type-Options' },
  referrer:      { obs: 'referrer-policy',            ssl: null,        ad: 'Referrer-Policy' },
  cookies:       { obs: 'cookies',                    ssl: null,        ad: 'Çerez bayrakları' },
  tls_protocol:  { obs: null,                         ssl: 'protocol',  ad: 'TLS sürümü' },
  tls_cert:      { obs: null,                         ssl: 'cert',      ad: 'Sertifika' },
  tls_legacy:    { obs: null,                         ssl: 'legacy',    ad: 'Eski TLS (1.0/1.1)' },
  /* Capraz koken sertlestirmesi — Observatory de test ediyor, artik biz de.
     Ikimizde de YOKLUK kusur sayilmiyor; o durumda iki taraf da "olculemedi"
     der ve satir mutabakat sayimina girmez. */
  coop:          { obs: 'cross-origin-opener-policy',    ssl: null, ad: 'COOP' },
  coep:          { obs: 'cross-origin-embedder-policy',  ssl: null, ad: 'COEP' },
  corp:          { obs: 'cross-origin-resource-policy',  ssl: null, ad: 'CORP' },
  cors:          { obs: 'cross-origin-resource-sharing', ssl: null, ad: 'CORS' },
  sri:           { obs: 'subresource-integrity',         ssl: null, ad: 'SRI' },
  /* Bu ucunu ikisi de test etmiyor; bizim ek kapsamimiz. */
  permissions:   { obs: null, ssl: null, ad: 'Permissions-Policy' },
  disclosure:    { obs: null, ssl: null, ad: 'Sürüm ifşası' },
  mixed_content: { obs: null, ssl: null, ad: 'Karışık içerik' }
};

function oku(yol) {
  try { return JSON.parse(fs.readFileSync(yol, 'utf8')); } catch (e) { return null; }
}

/**
 * Observatory test listesini ada gore aranabilir bir haritaya cevirir.
 *
 * v2 API'nin test ucunun dizi mi nesne mi dondurdugu ONCEDEN BILINMIYOR;
 * ikisini de kabul ediyoruz. Dizi gelirse .name / .test_name alanindan
 * anahtar uretilir. Tanimadigimiz bir bicim gelirse harita bos kalir ve
 * satirlar "—" olur — sessiz yanlis eslemeden iyidir.
 */
function obsHarita(obs) {
  const ham = (obs && (obs.tests || obs.details)) || null;
  if (!ham) return {};
  if (!Array.isArray(ham)) return ham;
  const harita = {};
  ham.forEach(function (t) {
    const ad = t && (t.name || t.test_name || t.test || t.id);
    if (ad) harita[ad] = t;
  });
  return harita;
}

/**
 * Observatory testinin sonucunu pass/fail/skipped/null'a indirger.
 *
 * OLCULDU (kosu 34560332453): Observatory'de `pass` UC DEGERLI.
 *
 *   cookies: pass=null result=cookies-not-found m=0
 *   subresource-integrity: pass=null result=sri-not-implemented-but-...
 *
 * `pass: null`, "kaldi" demek DEGIL — Observatory'nin kendi ozeti ayni
 * taramada tests_failed: 0 diyor ve puan etkisi sifir (m=0). Yani test
 * uygulanamadi. Onceki surum result metnini duzenli ifadeyle okuyup bunu
 * "fail" sayiyordu ve cerez satirini yanlis kirmiziya boyuyordu.
 *
 * Kural: yalnizca mantiksal `pass` baglayicidir. null ise "olculemedi" —
 * bizim `skipped` durumumuzun tam karsiligi, mutabakata girmez.
 */
function obsSonuc(obs, ad) {
  if (!obs || !ad) return null;
  const tests = obsHarita(obs);
  const t = tests[ad];
  if (!t) return null;
  /* "Yoklugu gecti sayma" duzeltmesi.
     OLCULDU (kosu 34666166719): Observatory `cross-origin-resource-sharing`
     icin BASLIK YOKKEN `pass=true result=...-not-implemented` donuyor;
     `coep-not-implemented` de oyle. Biz ayni durumda `skipped` diyoruz —
     yoklugu kusur da basari da saymiyoruz. Iki taraf da "pass" harfi
     uretince tablo bunu MUTABAKAT sayiyordu; oysa ayni harf ayni gercek
     degil: bizimki "baslik var ve makul", onlarinki "baslik hic yok".
     Bu yuzden pass=true + "not-implemented" sonucu olcum YOKLUGU sayilir.
     pass=false olan yokluklar (ornegin x-frame-options) bundan etkilenmez:
     orada yokluk gercekten bir yargidir ve iki taraf da ayni sekilde
     basarisiz sayar. */
  const sonuc = String(t.result || '');
  if (t.pass === true && /not-implemented/.test(sonuc)) return 'skipped';
  if (t.pass === true) return 'pass';
  if (t.pass === false) return 'fail';
  return 'skipped';
}

/** SSL Labs yanıtından üç TLS gerçeğini çıkarır. */
function sslSonuc(ssl, tur) {
  if (!ssl || !tur) return null;
  const uc = (ssl.endpoints || [])[0];
  if (!uc || !uc.details) return null;
  const protokoller = uc.details.protocols || [];
  if (!protokoller.length && tur !== 'cert') return null;

  if (tur === 'protocol') {
    const modern = protokoller.some(function (p) { return p.version === '1.2' || p.version === '1.3'; });
    return modern ? 'pass' : 'fail';
  }
  if (tur === 'legacy') {
    const eski = protokoller.some(function (p) { return p.version === '1.0' || p.version === '1.1'; });
    return eski ? 'fail' : 'pass';
  }
  if (tur === 'cert') {
    /* Zincirde sorun yoksa ve sure gecmemsise gecerli sayilir. */
    const c = (ssl.certs || [])[0];
    if (!c) return null;
    const suresiGecmis = typeof c.notAfter === 'number' && c.notAfter < Date.now();
    const guvenilir = !c.issues || c.issues === 0;
    return (!suresiGecmis && guvenilir) ? 'pass' : 'fail';
  }
  return null;
}

function isaret(s) {
  if (s === 'pass') return '✅';
  if (s === 'fail') return '❌';
  if (s === 'skipped') return '⏸';
  return '—';
}

function main() {
  const bizim = oku(process.argv[2]);
  const obs = oku(process.argv[3]);
  const ssl = oku(process.argv[4]);

  if (!bizim || !Array.isArray(bizim.checks)) {
    process.stdout.write('Bizim tarama sonucumuz okunamadı; tablo üretilemiyor.\n');
    process.exit(1);
  }

  const bizimDurum = {};
  bizim.checks.forEach(function (c) { bizimDurum[c.id] = c.status; });

  const satirlar = [];
  let karsilastirilabilir = 0, uyusan = 0;

  Object.keys(ESLEME).forEach(function (id) {
    const e = ESLEME[id];
    const b = bizimDurum[id] || null;
    const o = obsSonuc(obs, e.obs);
    const s = sslSonuc(ssl, e.ssl);

    /* Mutabakat yalnizca IKI TARAFIN DA olctugu kontrolde anlamli. */
    let mutabakat = '—';
    const dis = o !== null ? o : s;
    /* Iki taraf da OLCMUS olmali: 'skipped' bir yargi degil, olcum yoklugu. */
    if (b && (b === 'pass' || b === 'fail') && (dis === 'pass' || dis === 'fail')) {
      karsilastirilabilir++;
      if (b === dis) { uyusan++; mutabakat = '✅'; }
      else mutabakat = '❌';
    }
    satirlar.push([e.ad, isaret(b), isaret(o), isaret(s), mutabakat]);
  });

  const basliklar = ['Kontrol', 'Bizim', 'Observatory', 'SSL Labs', 'Mutabakat'];
  const gen = basliklar.map(function (h, i) {
    return Math.max(h.length, Math.max.apply(null, satirlar.map(function (r) { return r[i].length; })));
  });
  const cizgi = function (r) {
    return '| ' + r.map(function (c, i) { return c + ' '.repeat(gen[i] - c.length); }).join(' | ') + ' |';
  };

  process.stdout.write('\n' + cizgi(basliklar) + '\n');
  process.stdout.write('|' + gen.map(function (g) { return '-'.repeat(g + 2); }).join('|') + '|\n');
  satirlar.forEach(function (r) { process.stdout.write(cizgi(r) + '\n'); });

  process.stdout.write('\n');
  process.stdout.write('Karşılaştırılabilir kontrol : ' + karsilastirilabilir + '\n');
  process.stdout.write('Uyuşan                      : ' + uyusan + '\n');
  if (karsilastirilabilir) {
    process.stdout.write('Mutabakat oranı             : %' +
      Math.round((uyusan / karsilastirilabilir) * 100) + '\n');
  }
  process.stdout.write('\n— = o araç bu kontrolü test ETMİYOR; mutabakatsızlık sayılmaz.\n');
  process.stdout.write('⏸ = ölçülemedi (skora da girmez).\n');

  if (!karsilastirilabilir) {
    process.stdout.write('\nUYARI: hiçbir kontrol karşılaştırılamadı. Dış araçların yanıtı\n');
    process.stdout.write('alınamamış ya da test adları değişmiş olabilir — eşleme tablosu\n');
    process.stdout.write('tools/compare-table.js içinde açıkça beyan ediliyor.\n');
  }
}

main();
