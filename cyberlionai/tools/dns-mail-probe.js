'use strict';

/**
 * E-posta kimlik doğrulama kayıtlarını (SPF / DMARC / DKIM) ÖLÇER.
 *
 *   node cyberlionai/tools/dns-mail-probe.js [alanadi ...]
 *
 * NEDEN VAR
 *
 * Bu depoda parser yazmadan önce ölçmek kural: alan adını tahmin edip
 * ayrıştırıcı yazmak daha önce iki kez hataya yol açtı. SPF/DMARC/DKIM
 * kontrollerini eklemeden önce cevaplanması gereken sorular:
 *
 *   1. Çözücü "alan adı yok" ile "TXT kaydı yok" durumlarını nasıl ayırıyor?
 *      (ENOTFOUND / ENODATA — ikisini karıştırmak yanlış rapor üretir.)
 *   2. TXT kayıtları parçalı geliyor mu? (255 baytlık dizgi sınırı yüzünden
 *      resolveTxt string DİZİLERİ döndürür; birleştirmezsek kayıt bozulur.)
 *   3. Birden fazla SPF kaydı olan alan adları var mı? (RFC 7208'e göre bu
 *      bir HATA ve gönderen sunucular kaydı tümden geçersiz sayar.)
 *   4. DKIM seçicileri DNS'ten SAYILABİLİYOR mu? (Sayılamıyorsa "DKIM yok"
 *      demek ölçüm değil tahmindir — o zaman kontrol dürüstçe atlanmalı.)
 *   5. Sorgular ne kadar sürüyor? (Tarama süresine ekleniyor.)
 *
 * Salt-okunur: yalnızca kamuya açık DNS kayıtlarını okur.
 */

const dns = require('dns');

const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

/* Çözücü AÇIKÇA seçiliyor. Koşucunun varsayılan çözücüsü (Actions'ta
   169.254.169.253, geliştirme kutusunda başka bir şey) ölçümü sessizce
   değiştirebilir; hangi çözücüye sorduğumuzu bilmeden gelen "kayıt yok"
   yanıtı yorumlanamaz. */
const COZUCU = (process.env.RESOLVER || '1.1.1.1').split(',');
const cozucu = new dns.promises.Resolver({ timeout: 5000, tries: 2 });
cozucu.setServers(COZUCU);

/* Yaygın DKIM seçicileri. BU LİSTE BİR KANIT DEĞİL: DNS'te bir alan adının
   seçicilerini listeleyen bir sorgu YOKTUR (_domainkey altı numaralandırılamaz).
   Liste yalnızca "bulursak kesin var" demeye yarar; bulamamak "yok" demek
   değildir ve ölçümün amacı tam olarak bunu göstermek. */
const SECICILER = [
  'google',                  // Google Workspace
  'selector1', 'selector2',  // Microsoft 365
  'k1', 'k2',                // Mailchimp / Mandrill
  's1', 's2',                // Amazon SES ve birçok panel
  'default', 'dkim', 'mail', 'smtp',
  'zoho', 'protonmail', 'sendgrid', 'mandrill',
  'turbify', 'yandex', 'dkim1'
];

async function txt(ad) {
  const t0 = Date.now();
  try {
    const kayitlar = await cozucu.resolveTxt(ad);
    /* Parçaları BİRLEŞTİR: resolveTxt her kayıt için string dizisi döndürür,
       çünkü DNS tek bir dizgiyi 255 bayttan uzun taşıyamaz. Birleştirmeyen
       bir ayrıştırıcı uzun SPF kayıtlarını ortadan keser. */
    return { ok: true, ms: Date.now() - t0, kayitlar: kayitlar.map(function (p) { return p.join(''); }) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, kod: e.code };
  }
}

async function kayit(yontem, ad) {
  try { return { ok: true, deger: await cozucu[yontem](ad) }; }
  catch (e) { return { ok: false, kod: e.code }; }
}

function yaz(etiket, deger) {
  process.stdout.write('   ' + String(etiket).padEnd(22) + String(deger) + '\n');
}

async function olc(alan) {
  process.stdout.write('\n' + KALIN + '== ' + alan + SIFIRLA + '\n');

  /* 1. Alan adı gerçekten var mı? SPF/DMARC yokluğunu raporlamadan önce
        alan adının ÇÖZÜLDÜĞÜNÜ bilmek gerekiyor. */
  const kok = await txt(alan);
  yaz('apex TXT', kok.ok ? kok.kayitlar.length + ' kayıt (' + kok.ms + 'ms)'
                         : kok.kod + ' (' + kok.ms + 'ms)');
  if (kok.ok) {
    kok.kayitlar.forEach(function (k) {
      yaz('  ', (k.length > 110 ? k.slice(0, 110) + '...' : k) + '  [' + k.length + ' bayt]');
    });
  }

  const spf = kok.ok ? kok.kayitlar.filter(function (k) { return /^v=spf1(\s|$)/i.test(k); }) : [];
  yaz('SPF kaydı', spf.length === 0 ? 'YOK'
    : spf.length + ' adet' + (spf.length > 1 ? '  <-- RFC 7208 HATASI' : ''));
  if (spf.length === 1) {
    const m = /(?:^|\s)([+\-~?]?)all(?:\s|$)/i.exec(spf[0]);
    yaz('  all mekanizması', m ? (m[1] || '+') + 'all' : 'YOK (kayıt eksik biter)');
    yaz('  arama sayısı~', (spf[0].match(/\b(include|a|mx|ptr|exists|redirect)[:=]/gi) || []).length + ' (sınır 10)');
  }

  /* 2. DMARC ayrı bir isimde: _dmarc.<alan>. */
  const dmarc = await txt('_dmarc.' + alan);
  const dk = dmarc.ok ? dmarc.kayitlar.filter(function (k) { return /^v=DMARC1\s*;/i.test(k); }) : [];
  yaz('DMARC', dmarc.ok
    ? (dk.length ? dk.length + ' kayıt' : 'TXT var ama DMARC değil') + ' (' + dmarc.ms + 'ms)'
    : dmarc.kod + ' (' + dmarc.ms + 'ms)');
  dk.forEach(function (k) {
    yaz('  ', k.length > 110 ? k.slice(0, 110) + '...' : k);
    const p = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(k);
    const sp = /(?:^|;)\s*sp\s*=\s*(none|quarantine|reject)/i.exec(k);
    const pct = /(?:^|;)\s*pct\s*=\s*(\d+)/i.exec(k);
    const rua = /(?:^|;)\s*rua\s*=/i.test(k);
    yaz('  p=', p ? p[1].toLowerCase() : 'YOK (kayıt geçersiz)');
    yaz('  sp=', sp ? sp[1].toLowerCase() : '(yok - p devralınır)');
    yaz('  pct=', pct ? pct[1] : '(yok - 100 varsayılır)');
    yaz('  rua', rua ? 'var (rapor toplanıyor)' : 'YOK');
  });

  /* 0. Alan adı ÇÖZÜLÜYOR mu ve posta alıyor mu? TXT sorgusundan dönen
        ENOTFOUND'u yorumlayabilmek için gerekiyor: alan adı hiç yoksa
        "SPF yok" demek anlamsız olur. */
  const a = await kayit('resolve4', alan);
  const mx = await kayit('resolveMx', alan);
  yaz('A kaydı', a.ok ? a.deger.slice(0, 3).join(', ') : a.kod);
  yaz('MX kaydı', mx.ok ? mx.deger.map(function (m) { return m.exchange; }).slice(0, 3).join(', ') : mx.kod);

  /* 3. DKIM: numaralandırılamıyor. Yaygın seçiciler taranıyor ki "bulursak
        kesin var, bulamazsak bilmiyoruz" ayrımı ÖLÇÜMLE gösterilsin.
        İLK KOŞU (34709370416) beklenmedik bir sonuç verdi: example.com'da
        18 seçicinin 18'i de "bulundu" göründü. Bu yüzden artık EŞLEŞEN KAYDIN
        KENDİSİ yazdırılıyor — neyin eşleştiğini görmeden "bulundu" demek
        ölçüm değil. */
  const t0 = Date.now();
  const sonuc = await Promise.all(SECICILER.map(async function (s) {
    const r = await txt(s + '._domainkey.' + alan);
    if (!r.ok) return null;
    const esleyen = r.kayitlar.filter(function (k) { return /(^|;)\s*(v=DKIM1|k=|p=)/i.test(k); });
    return esleyen.length ? { secici: s, kayit: esleyen[0] } : null;
  }));
  const bulunan = sonuc.filter(Boolean);
  yaz('DKIM seçicileri', (bulunan.length ? bulunan.map(function (b) { return b.secici; }).join(', ')
    : 'yaygın seçicilerde bulunamadı') + '  (' + SECICILER.length + ' sorgu, ' + (Date.now() - t0) + 'ms)');
  bulunan.slice(0, 3).forEach(function (b) {
    yaz('  ' + b.secici, (b.kayit.length > 90 ? b.kayit.slice(0, 90) + '...' : b.kayit) +
      '  [' + b.kayit.length + ' bayt]');
  });
  /* Var olmayan bir seçici de soruluyor: joker (wildcard) TXT kaydı olan bir
     alan adında HER isim yanıt döner ve seçici taraması yalan söyler. */
  const uydurma = await txt('cyberlion-olmayan-secici-9182._domainkey.' + alan);
  yaz('uydurma seçici', uydurma.ok
    ? 'YANIT DÖNDÜ (joker kayıt!) -> ' + uydurma.kayitlar[0].slice(0, 60)
    : uydurma.kod + ' (beklenen)');

  /* 4. www. önekiyle de bakılıyor: kullanıcı "www.x.com" tarattığında
        kaydı hangi isimde arayacağımızı ölçüm belirlesin. */
  if (!/^www\./i.test(alan)) {
    const w = await txt('www.' + alan);
    yaz('www.<alan> TXT', w.ok ? w.kayitlar.length + ' kayıt' : w.kod);
    const wspf = w.ok ? w.kayitlar.filter(function (k) { return /^v=spf1/i.test(k); }) : [];
    yaz('  www SPF', wspf.length ? wspf.length + ' adet' : 'YOK');
    const wd = await txt('_dmarc.www.' + alan);
    yaz('  _dmarc.www', wd.ok ? wd.kayitlar.length + ' kayıt' : wd.kod);
  }
}

(async function () {
  const alanlar = process.argv.slice(2);
  const liste = alanlar.length ? alanlar : [
    'cyberlionai.com',           // kendi alan adımız
    'astekstudio.com',           // müşteri sorusunun geldiği alan adı
    'atlasasistan.com',          // kendi ikinci alan adımız
    'google.com',                // p=reject, DKIM 'google' seçicisi
    'github.com',
    'anadolu.edu.tr',            // çok seviyeli TLD (.edu.tr)
    'trendyol.com',              // TR ticari
    'example.com',               // IANA - SPF'siz olması beklenir
    'bu-alan-adi-yok-12345.com'  // NXDOMAIN referansı
  ];

  process.stdout.write(KALIN + 'E-posta kimlik kayıtları ölçümü' + SIFIRLA + '\n');
  process.stdout.write('Çözücü: ' + COZUCU.join(', ') + '\n');
  process.stdout.write('Zaman : ' + new Date().toISOString() + '\n');

  const t0 = Date.now();
  for (const a of liste) {
    try { await olc(a); } catch (e) { process.stdout.write('   HATA ' + e.message + '\n'); }
  }
  process.stdout.write('\n' + KALIN + 'Toplam süre' + SIFIRLA + ': ' + (Date.now() - t0) + 'ms / ' +
    liste.length + ' alan adı\n');
  process.stdout.write('Not: bu betik yalnızca ölçüm yapar; hiçbir dosyayı değiştirmez.\n');
})();
