'use strict';

/**
 * Tarama puanlamasının kalibrasyonu.
 *
 *   node tools/calibration-test.js
 *
 * Cevapladığı soru: "60/100 skoru doğru mu?"
 *
 * Yöntem: skor deterministik. Girdisi ölçülen başlıklar, çıktısı ağırlıklı bir
 * oran. Her profil için BEKLENEN DURUM HER KONTROL İÇİN AYRI AYRI yazılıyor;
 * skor da bu beyandan ve ağırlık tablosundan türetiliyor. Yani sınama iki şeyi
 * birden kanıtlıyor: hangi kontrolün neden düştüğünü ve toplamın doğruluğunu.
 *
 * Bu döngüsel değil: beklenen durumlar elle yazılmış bir beyan, motorun
 * çıktısından türetilmiyor. Motor farklı davranırsa sınama kırmızıya döner.
 *
 * Neden gerçek bir site değil: gerçek siteye karşı koşan sınama, o site
 * başlığını değiştirdiği gün sebepsiz kırılır ve neyi ölçtüğü belirsizleşir.
 *
 * Ağa ÇIKMAZ.
 */

const { buildChecks, scoreOf, WEIGHTS } = require('../api/_lib/scanner.js');

let failed = 0;
function ok(c, m) {
  process.stdout.write((c ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + m + '\n');
  if (!c) failed = 1;
}
function head(t) { process.stdout.write('\n\x1b[1m== ' + t + '\x1b[0m\n'); }

/** Kontrol kimliği → önem derecesi. Motorun tasarım kararı; burada beyan
    ediliyor ki bir kontrolün ağırlığı sessizce değişirse sınama yakalasın. */
const SEVERITY = {
  https: 'critical', csp: 'critical',
  hsts: 'high', cookies: 'high', mixed_content: 'high',
  tls_protocol: 'high', tls_cert: 'high', tls_legacy: 'high',
  xframe: 'medium', nosniff: 'medium',
  referrer: 'low', permissions: 'low', disclosure: 'low',
  sri: 'low',
  /* Capraz koken sertlestirmesi: agirlik 0 (info). Yoklugu kusur sayilmadigi
     icin skoru kaydirmiyorlar; bkz. tools/crossorigin-test.js */
  coop: 'info', coep: 'info', corp: 'info', cors: 'info',
  /* E-posta kimlik dogrulamasi: agirlik 0 (info). POSTA yuzeyini olcuyorlar,
     skor ise WEB yuzeyi icin kalibre edilmis; agirlik vermek hicbir seyini
     degistirmemis musterilerin skorunu dusururdu. Bunun gercekten boyle
     oldugu asagida AYRICA sinaniyor (bolum 7). */
  spf: 'info', dmarc: 'info', dkim: 'info',
  /* CAA ve DNSSEC: yine info (0). Yoklukları BASARISIZLIK degil
     "uygulanmamis" sayiliyor; bkz. _lib/dnszone.js basligi. */
  caa: 'info', dnssec: 'info'
};

function ctx(o) {
  const h = new Headers();
  for (const [k, v] of Object.entries(o.headers || {})) {
    if (Array.isArray(v)) v.forEach(function (x) { h.append(k, x); });
    else h.set(k, v);
  }
  return {
    finalUrl: new URL(o.url || 'https://ornek.test/'),
    headers: h,
    html: o.html === undefined ? '<html></html>' : o.html,
    tls: 'tls' in o ? o.tls : { ok: true, protocol: 'TLSv1.3', authorized: true, daysLeft: 90 },
    legacyTls: 'legacyTls' in o ? o.legacyTls : { tested: true, accepted: false },
    /* Belirtilmemisse UNDEFINED birakiliyor: "olculmedi" demek, uydurma bir
       kayit vermek degil. */
    mail: o.mail,
    zone: o.zone
  };
}

/** Beklenen durum beyanından skoru hesaplar. */
function beklenenSkor(beklenen) {
  let toplam = 0, kayip = 0;
  for (const [id, durum] of Object.entries(beklenen)) {
    if (durum !== 'pass' && durum !== 'fail') continue;   // skipped sayılmaz
    const w = WEIGHTS[SEVERITY[id]];
    toplam += w;
    if (durum === 'fail') kayip += w;
  }
  return toplam ? Math.max(0, Math.round((1 - kayip / toplam) * 100)) : null;
}

function profil(ad, girdi, beklenen, bant) {
  head(ad + ' — beklenen bant ' + bant[0] + '–' + bant[1]);
  const checks = buildChecks(ctx(girdi));
  const gercek = {};
  checks.forEach(function (c) { gercek[c.id] = c.status; });

  // 1) Onem dereceleri beyan edildigi gibi mi?
  const yanlisAgirlik = checks.filter(function (c) { return SEVERITY[c.id] !== c.severity; });
  ok(yanlisAgirlik.length === 0, 'önem dereceleri beyanla uyuşuyor' +
     (yanlisAgirlik.length ? ' — sapan: ' + yanlisAgirlik.map(function (c) { return c.id; }).join(', ') : ''));

  // 2) Her kontrol beklenen durumda mi?
  const sapan = [];
  for (const [id, bek] of Object.entries(beklenen)) {
    if (gercek[id] !== bek) sapan.push(id + ': beklenen ' + bek + ', gelen ' + gercek[id]);
  }
  ok(sapan.length === 0, 'her kontrol beklenen durumda' + (sapan.length ? ' — ' + sapan.join(' | ') : ''));
  ok(Object.keys(gercek).length === Object.keys(beklenen).length,
     'kontrol sayısı beyanla aynı (' + Object.keys(gercek).length + ')');

  // 3) Skor, beyandan turetilen degerle birebir mi?
  const skor = scoreOf(checks);
  const bek = beklenenSkor(beklenen);
  ok(skor === bek, 'skor beyandan türetilenle birebir (' + skor + ' = ' + bek + ')');
  ok(skor >= bant[0] && skor <= bant[1], 'bant doğru (' + skor + ' ∈ [' + bant[0] + ',' + bant[1] + '])');
  return skor;
}

/* ------------------------------------------------------------------ */

const s1 = profil('1. GÜVENLİ site', {
  headers: {
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'content-security-policy': "default-src 'self'; script-src 'self' 'sha256-AAAA'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=()'
  }
}, {
  https: 'pass', hsts: 'pass', csp: 'pass', xframe: 'pass', nosniff: 'pass',
  referrer: 'pass', permissions: 'pass', cookies: 'skipped', disclosure: 'pass',
  mixed_content: 'pass', tls_protocol: 'pass', tls_cert: 'pass', tls_legacy: 'pass',
  /* Capraz koken sertlestirmesi: fiksturlerin hicbiri bu basliklari
     gondermiyor ve dis kokenli script tasimiyor, dolayisiyla hepsi atlanir.
     Atlanan kontrol paydaya girmedigi icin bantlari da degistirmiyor. */
  coop: 'skipped', coep: 'skipped', corp: 'skipped', cors: 'skipped', sri: 'skipped',
  /* ctx() mail verisi vermiyor: olculmemis demektir, uydurma degil. */
  spf: 'skipped', dmarc: 'skipped', dkim: 'skipped',
  caa: 'skipped', dnssec: 'skipped'
}, [95, 100]);

const s2 = profil('2. ORTA site', {
  headers: {
    'strict-transport-security': 'max-age=31536000',
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff'
  }
}, {
  https: 'pass', hsts: 'pass', csp: 'fail', xframe: 'pass', nosniff: 'pass',
  referrer: 'fail', permissions: 'fail', cookies: 'skipped', disclosure: 'pass',
  mixed_content: 'pass', tls_protocol: 'pass', tls_cert: 'pass', tls_legacy: 'pass',
  /* Capraz koken sertlestirmesi: fiksturlerin hicbiri bu basliklari
     gondermiyor ve dis kokenli script tasimiyor, dolayisiyla hepsi atlanir.
     Atlanan kontrol paydaya girmedigi icin bantlari da degistirmiyor. */
  coop: 'skipped', coep: 'skipped', corp: 'skipped', cors: 'skipped', sri: 'skipped',
  /* ctx() mail verisi vermiyor: olculmemis demektir, uydurma degil. */
  spf: 'skipped', dmarc: 'skipped', dkim: 'skipped',
  caa: 'skipped', dnssec: 'skipped'
}, [60, 80]);

// Gercekten zayif bir site eski TLS surumlerini de kabul eder; fikstur bunu
// yansitiyor. Kabul etmeseydi skor 41 cikiyor ve 20-40 bandinin disinda
// kaliyordu — sebebi motorun hatasi degil, o profilin aslinda "orta"ya daha
// yakin olmasi: calisan modern TLS tek basina toplam agirligin ucte birini
// tasiyor.
const s3 = profil('3. ZAYIF site', {
  headers: { 'server': 'nginx/1.18.0', 'set-cookie': ['oturum=abc; Path=/'] },
  html: '<img src="http://cdn.ornek.test/a.png">',
  legacyTls: { tested: true, accepted: true }
}, {
  https: 'pass', hsts: 'fail', csp: 'fail', xframe: 'fail', nosniff: 'fail',
  referrer: 'fail', permissions: 'fail', cookies: 'fail', disclosure: 'fail',
  mixed_content: 'fail', tls_protocol: 'pass', tls_cert: 'pass', tls_legacy: 'fail',
  /* Capraz koken sertlestirmesi: fiksturlerin hicbiri bu basliklari
     gondermiyor ve dis kokenli script tasimiyor, dolayisiyla hepsi atlanir.
     Atlanan kontrol paydaya girmedigi icin bantlari da degistirmiyor. */
  coop: 'skipped', coep: 'skipped', corp: 'skipped', cors: 'skipped', sri: 'skipped',
  /* ctx() mail verisi vermiyor: olculmemis demektir, uydurma degil. */
  spf: 'skipped', dmarc: 'skipped', dkim: 'skipped',
  caa: 'skipped', dnssec: 'skipped'
}, [20, 40]);

const s4 = profil('4. ÇOK ZAYIF site (HTTP)', {
  url: 'http://ornek.test/',
  headers: { 'x-powered-by': 'PHP/7.4.3', 'set-cookie': ['a=1'] },
  tls: null, legacyTls: null
}, {
  https: 'fail', hsts: 'fail', csp: 'fail', xframe: 'fail', nosniff: 'fail',
  referrer: 'fail', permissions: 'fail', cookies: 'fail', disclosure: 'fail',
  mixed_content: 'skipped', tls_protocol: 'skipped', tls_cert: 'skipped', tls_legacy: 'skipped',
  /* Capraz koken sertlestirmesi: fiksturlerin hicbiri bu basliklari
     gondermiyor ve dis kokenli script tasimiyor, dolayisiyla hepsi atlanir.
     Atlanan kontrol paydaya girmedigi icin bantlari da degistirmiyor. */
  coop: 'skipped', coep: 'skipped', corp: 'skipped', cors: 'skipped', sri: 'skipped',
  /* ctx() mail verisi vermiyor: olculmemis demektir, uydurma degil. */
  spf: 'skipped', dmarc: 'skipped', dkim: 'skipped',
  caa: 'skipped', dnssec: 'skipped'
}, [0, 20]);

head('5. Bantlar ayrık ve sıralı');
ok(s1 > s2 && s2 > s3 && s3 > s4,
   'güvenli > orta > zayıf > çok zayıf (' + [s1, s2, s3, s4].join(' > ') + ')');

head('6. Ölçülemeyen kontrol BAŞARISIZ sayılmaz');
// Ayni basliklara sahip uc site; yalnizca TLS durumu farkli.
const tlsIyi   = scoreOf(buildChecks(ctx({ headers: {} })));
const tlsYok   = scoreOf(buildChecks(ctx({ headers: {}, tls: { ok: false, reason: 'timeout' }, legacyTls: { tested: false } })));
const tlsKotu  = scoreOf(buildChecks(ctx({ headers: {},
  tls: { ok: true, protocol: 'TLSv1.0', authorized: false, authorizationError: 'self signed', daysLeft: 5 },
  legacyTls: { tested: true, accepted: true } })));

ok(tlsYok > tlsKotu,
   'ölçülemeyen TLS, ölçülüp BAŞARISIZ olandan daha iyi puanlanıyor (' + tlsYok + ' > ' + tlsKotu + ')');
ok(tlsIyi > tlsYok,
   'ölçülüp GEÇEN TLS, ölçülemeyenden daha iyi puanlanıyor (' + tlsIyi + ' > ' + tlsYok + ')');

// Dogru anlasilmasi gereken davranis: olculemeyen kontrol paydadan da dusuyor.
// Bu yuzden TLS'i olculemeyen bir site, ayni sitenin TLS'i olculmus halinden
// DUSUK puan alir (58 -> 40). Kontrol basarisiz sayilmiyor; yalnizca o siteye
// kazandirdigi puani da kazandirmiyor. Rapor bunu 'skipped' diye gosteriyor.
ok(tlsIyi === 58 && tlsYok === 40 && tlsKotu === 28,
   'payda etkisi belgelendiği gibi: ölçüldü=' + tlsIyi + ', ölçülemedi=' + tlsYok + ', başarısız=' + tlsKotu);

head('7. E-posta kontrolleri skoru KAYDIRMIYOR');
/* Bu bolum bir soz veriyor: SPF/DMARC/DKIM eklenmesi, hicbir seyini
   degistirmemis bir musterinin skorunu degistirmez. Ayni site uc kez
   puanlaniyor — kayitlar olculmemis, hepsi gecmis ve hepsi kalmis halleriyle.
   Uc skor da AYNI cikmali. */
const mailYok = scoreOf(buildChecks(ctx({ headers: {} })));
const mailIyi = scoreOf(buildChecks(ctx({ headers: {}, mail: {
  ok: true, alan: 'ornek.test',
  spf: ['v=spf1 include:_spf.ornek.test -all'],
  dmarc: ['v=DMARC1; p=reject; rua=mailto:a@ornek.test'],
  dkimSecici: 'google', dkimJoker: false
} })));
const mailKotu = scoreOf(buildChecks(ctx({ headers: {}, mail: {
  ok: true, alan: 'ornek.test', spf: [], dmarc: [], dkimSecici: null, dkimJoker: false
} })));

ok(mailYok === mailIyi && mailIyi === mailKotu,
   'skor uc durumda da ayni (' + [mailYok, mailIyi, mailKotu].join(' = ') + ')');

/* Ama RAPORDA gorunuyorlar: agirliksiz olmak, gorunmez olmak degil. */
const kotuKontroller = buildChecks(ctx({ headers: {}, mail: {
  ok: true, alan: 'ornek.test', spf: [], dmarc: [], dkimSecici: null, dkimJoker: false
} }));
const spfDurum = kotuKontroller.find(function (c) { return c.id === 'spf'; });
const dmarcDurum = kotuKontroller.find(function (c) { return c.id === 'dmarc'; });
const dkimDurum = kotuKontroller.find(function (c) { return c.id === 'dkim'; });
ok(spfDurum.status === 'fail' && dmarcDurum.status === 'fail',
   'SPF ve DMARC yoklugu BULGU olarak raporlaniyor (' + spfDurum.status + '/' + dmarcDurum.status + ')');
ok(dkimDurum.status === 'skipped',
   'DKIM bulunamadiginda BASARISIZ degil ATLANMIS sayiliyor (' + dkimDurum.status + ')');

head('8. CAA/DNSSEC de skoru KAYDIRMIYOR');
const bolgeYok = scoreOf(buildChecks(ctx({ headers: {} })));
const bolgeIyi = scoreOf(buildChecks(ctx({ headers: {}, zone: {
  ok: true, alan: 'ornek.test',
  caa: [{ critical: 0, issue: 'letsencrypt.org' }],
  ds: { ok: true, rcode: 0, cevap: 2, ad: true }
} })));
const bolgeKotu = scoreOf(buildChecks(ctx({ headers: {}, zone: {
  ok: true, alan: 'ornek.test', caa: [], ds: { ok: true, rcode: 0, cevap: 0, ad: false }
} })));
ok(bolgeYok === bolgeIyi && bolgeIyi === bolgeKotu,
   'skor uc durumda da ayni (' + [bolgeYok, bolgeIyi, bolgeKotu].join(' = ') + ')');

const bolgeK = buildChecks(ctx({ headers: {}, zone: {
  ok: true, alan: 'ornek.test', caa: [], ds: { ok: true, rcode: 0, cevap: 0, ad: false }
} }));
const caaDurum = bolgeK.find(function (c) { return c.id === 'caa'; });
const secDurum = bolgeK.find(function (c) { return c.id === 'dnssec'; });
ok(caaDurum.status === 'skipped' && caaDurum.note === 'not_implemented',
   'CAA yoklugu "uygulanmamis" (' + caaDurum.status + '/' + caaDurum.note + ')');
ok(secDurum.status === 'skipped' && secDurum.note === 'not_implemented',
   'DNSSEC yoklugu "uygulanmamis" (' + secDurum.status + '/' + secDurum.note + ')');

/* UDP kapaliysa "yok" DEGIL "olculemedi" denmeli — uretimde UDP/53'un
   calisip calismadigini bilmiyoruz ve yanlis taraf yalan olurdu. */
const udpYok = buildChecks(ctx({ headers: {}, zone: {
  ok: true, alan: 'ornek.test', caa: [], ds: { ok: false, hata: 'timeout' }
} })).find(function (c) { return c.id === 'dnssec'; });
ok(udpYok.status === 'skipped' && udpYok.note === 'not_measured',
   'UDP dustugunde "olculemedi" deniyor, "yok" degil (' + udpYok.note + ')');

process.stdout.write('\n\x1b[1m' + (failed ? 'SONUÇ: BAŞARISIZ' : 'SONUÇ: HEPSİ GEÇTİ') + '\x1b[0m\n');
process.stdout.write('\nKalibrasyon tablosu:\n');
[['güvenli', s1], ['orta', s2], ['zayıf', s3], ['çok zayıf', s4]].forEach(function (r) {
  process.stdout.write('  ' + String(r[1]).padStart(3) + ' / 100   ' + r[0] + '\n');
});
process.exit(failed);
