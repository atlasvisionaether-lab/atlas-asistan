'use strict';

/**
 * SPF / DMARC / DKIM ayrıştırıcıları — AĞ GEREKTİRMEZ.
 *
 *   node tools/mail-test.js
 *
 * NEDEN VAR
 *
 * Örneklerin çoğu UYDURMA DEĞİL: 12 Eylül 2026'da gerçek alan adlarından
 * ölçüldüler (koşular 34709370416 ve 34709562560). Bir gün bu kayıtlar
 * değişebilir; sınama o gün ne ölçtüğümüzü sabit tutuyor, çünkü ayrıştırıcı
 * gerçek kayıtlara göre yazıldı, belgeye göre değil.
 *
 * En önemli sınama example.com'unki: `*._domainkey` joker kaydı yüzünden
 * denenen her seçici "bulundu" görünüyordu ve dönen kayıt `v=DKIM1; p=`,
 * yani BOŞ (iptal edilmiş) anahtardı. İki koruma da burada kilitleniyor.
 */

const assert = require('assert');
const path = require('path');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const mail = require(path.join(__dirname, '..', 'api', '_lib', 'mail.js'));

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

/* ------------------------------------------------------------------ SPF */
process.stdout.write(KALIN + 'SPF' + SIFIRLA + '\n');

dene('kayıt yoksa "none" (başarısız DEĞİL — karar çağırana ait)', function () {
  assert.strictEqual(mail.spfDegerlendir([]).durum, 'none');
  assert.strictEqual(mail.spfDegerlendir(['google-site-verification=abc']).durum, 'none');
});

dene('google.com: ~all geçiyor', function () {
  const r = mail.spfDegerlendir(['v=spf1 include:_spf.google.com ~all']);
  assert.strictEqual(r.durum, 'pass');
  assert.strictEqual(r.detay, '~all');
});

dene('anadolu.edu.tr: -all geçiyor', function () {
  const r = mail.spfDegerlendir([
    'v=spf1 include:spf.anadolu.edu.tr include:spf.protection.outlook.com -all'
  ]);
  assert.strictEqual(r.durum, 'pass');
  assert.strictEqual(r.detay, '-all');
});

dene('+all kalıyor (herkese açık yetki)', function () {
  const r = mail.spfDegerlendir(['v=spf1 +all']);
  assert.strictEqual(r.durum, 'fail');
  assert.strictEqual(r.not, 'spf_allows_all');
});

dene('?all kalıyor (alıcıya dayanak vermiyor)', function () {
  assert.strictEqual(mail.spfDegerlendir(['v=spf1 include:a.test ?all']).not, 'spf_neutral');
});

dene('all mekanizması hiç yoksa kalıyor', function () {
  assert.strictEqual(mail.spfDegerlendir(['v=spf1 include:a.test']).not, 'spf_no_all');
});

dene('iki SPF kaydı kalıyor (RFC 7208: kayıt tümden geçersiz sayılır)', function () {
  const r = mail.spfDegerlendir(['v=spf1 include:a.test -all', 'v=spf1 include:b.test -all']);
  assert.strictEqual(r.durum, 'fail');
  assert.strictEqual(r.not, 'spf_multiple');
});

dene('apex TXT kalabalığı SPF sanılmıyor', function () {
  /* trendyol.com'da 35 TXT kaydı ölçüldü; yalnızca biri SPF. Gevşek bir
     eşleşme burada kolayca yanlış kayda bakardı. */
  const r = mail.spfDegerlendir([
    'ZOOM_verify_jE6qnet4RQiMPThAFJsFrQ',
    'globalsign-domain-verification=6YPfN5aO7GiCPckA',
    'v=spf1 include:_u.trendyol.com._spf.dmarcla.com -all',
    'openai-domain-verification=dv-nj0nNbbabogRhMeqWXvCSbXX'
  ]);
  assert.strictEqual(r.durum, 'pass');
});

dene('"v=spf10" gibi bir dizge SPF sayılmıyor', function () {
  assert.strictEqual(mail.spfDegerlendir(['v=spf10 -all']).durum, 'none');
});

/* ---------------------------------------------------------------- DMARC */
process.stdout.write(KALIN + 'DMARC' + SIFIRLA + '\n');

dene('kayıt yoksa "none"', function () {
  assert.strictEqual(mail.dmarcDegerlendir([]).durum, 'none');
});

dene('google.com: p=reject geçiyor', function () {
  const r = mail.dmarcDegerlendir(['v=DMARC1; p=reject; rua=mailto:mailauth-reports@google.com']);
  assert.strictEqual(r.durum, 'pass');
  assert.strictEqual(r.detay, 'p=reject');
});

dene('github.com: p=quarantine geçiyor', function () {
  const r = mail.dmarcDegerlendir([
    'v=DMARC1; p=quarantine; sp=reject; pct=100; rua=mailto:dmarc@github.com; ruf=mailto:dmarc@github.com; fo=1'
  ]);
  assert.strictEqual(r.durum, 'pass');
});

dene('trendyol.com: p=none kalıyor (yalnızca izleme)', function () {
  /* Ölçülen gerçek kayıt. p=none sahte e-postayı ENGELLEMEZ; kaydı yazmış ama
     uygulamaya geçmemiş olmak "korumalı" değildir. */
  const r = mail.dmarcDegerlendir(['v=DMARC1; p=none;']);
  assert.strictEqual(r.durum, 'fail');
  assert.strictEqual(r.not, 'dmarc_monitor_only');
});

dene('example.com: boşluksuz yazım da okunuyor', function () {
  /* Gerçek kayıt: noktalı virgülden sonra boşluk YOK. Boşluk bekleyen bir
     düzenli ifade bu kaydı kaçırırdı. */
  const r = mail.dmarcDegerlendir(['v=DMARC1;p=reject;sp=reject;adkim=s;aspf=s']);
  assert.strictEqual(r.durum, 'pass');
  assert.strictEqual(r.detay, 'p=reject');
});

dene('pct<100 kalıyor (politika kısmen uygulanıyor)', function () {
  const r = mail.dmarcDegerlendir(['v=DMARC1; p=reject; pct=20']);
  assert.strictEqual(r.durum, 'fail');
  assert.strictEqual(r.not, 'dmarc_partial');
});

dene('p yoksa kayıt geçersiz sayılıyor', function () {
  assert.strictEqual(mail.dmarcDegerlendir(['v=DMARC1; rua=mailto:a@b.test']).not, 'dmarc_no_policy');
});

dene('DMARC olmayan TXT kayıtları ayıklanıyor', function () {
  assert.strictEqual(mail.dmarcDegerlendir(['some-verification=xyz']).durum, 'none');
});

/* ----------------------------------------------------------------- DKIM */
process.stdout.write(KALIN + 'DKIM' + SIFIRLA + '\n');

dene('gerçek anahtar tanınıyor (github.com/google seçicisi)', function () {
  assert.ok(mail.dkimAnahtarMi(
    'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj6T5sl/RwdSqGoYWaWaFbS2UAeyP'));
});

dene('v= olmadan k= ile başlayan kayıt da tanınıyor (trendyol s1)', function () {
  assert.ok(mail.dkimAnahtarMi(
    'k=rsa; t=s; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5lktZw8YgoiVubkAZDjJ'));
});

dene('BOŞ p= anahtar sayılmıyor (example.com joker kaydı)', function () {
  /* Ölçümdeki asıl tuzak: `v=DKIM1; p=` RFC 6376'ya göre İPTAL EDİLMİŞ
     anahtardır. "DKIM var" demek yanlış olurdu. */
  assert.strictEqual(mail.dkimAnahtarMi('v=DKIM1; p='), false);
});

dene('DKIM olmayan TXT anahtar sanılmıyor', function () {
  assert.strictEqual(mail.dkimAnahtarMi('v=spf1 -all'), false);
  assert.strictEqual(mail.dkimAnahtarMi('google-site-verification=abc'), false);
});

dene('seçici listesi ölçümde bulunanların tamamını kapsıyor', function () {
  /* Ölçümde bulunan seçiciler: github -> google, selector1, k1;
     trendyol -> google, selector1, s1, s2; anadolu -> selector2. */
  ['google', 'selector1', 'selector2', 'k1', 's1', 's2'].forEach(function (s) {
    assert.ok(mail.SECICILER.indexOf(s) !== -1, s + ' listede yok');
  });
});

/* ---------------------------------------------------------- Alan adı seçimi */
process.stdout.write(KALIN + 'Hangi alan adına sorulacak' + SIFIRLA + '\n');

dene('www soyuluyor', function () {
  assert.strictEqual(mail.alanAdi('www.ornek.com'), 'ornek.com');
  assert.strictEqual(mail.alanAdi('WWW.Ornek.COM'), 'ornek.com');
});

dene('www dışındaki alt alan adı soyulmuyor', function () {
  /* SPF üst alan adına DÜŞMEZ: alıcı sunucu "blog.ornek.com" için yalnızca o
     ismin kaydına bakar. Soymak, ölçmediğimiz bir kaydı raporlamak olurdu. */
  assert.strictEqual(mail.alanAdi('blog.ornek.com'), 'blog.ornek.com');
});

dene('DMARC bir üst alan adına düşebiliyor', function () {
  assert.strictEqual(mail.ustAlan('blog.ornek.com'), 'ornek.com');
});

dene('üst alan adı TLD ise düşülmüyor', function () {
  assert.strictEqual(mail.ustAlan('ornek.com'), null);
});

dene('çok etiketli kamu son ekine düşülmüyor', function () {
  /* "sirket.com.tr" için bir üst ad "com.tr" olur; oraya sormak anlamsız ve
     yanıltıcıdır. Liste eksikse sonuç "bilmiyorum" olur, YANLIŞ olmaz. */
  assert.strictEqual(mail.ustAlan('sirket.com.tr'), null);
  assert.strictEqual(mail.ustAlan('sirket.co.uk'), null);
});

dene('gerçek çok seviyeli alan adı korunuyor (anadolu.edu.tr)', function () {
  /* Ölçüldü: kayıtlar tam olarak bu isimde duruyor. */
  assert.strictEqual(mail.alanAdi('www.anadolu.edu.tr'), 'anadolu.edu.tr');
  assert.strictEqual(mail.ustAlan('anadolu.edu.tr'), null);
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);
