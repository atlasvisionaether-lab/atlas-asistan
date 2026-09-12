'use strict';

/**
 * E-posta kimlik doğrulama kayıtları: SPF, DMARC, DKIM.
 *
 * NEDEN BU KONTROLLER VAR
 *
 * Motorun diğer kontrolleri ziyaretçiyi korur; bunlar alan adının KENDİSİNİ
 * korur. SPF ve DMARC yoksa üçüncü bir kişi "fatura@sirketiniz.com" adresinden
 * e-posta gönderebilir ve alıcının posta sunucusunun bunu eleyecek bir dayanağı
 * olmaz. Web başlıklarından farklı olarak bu, sitede bir açık değil; alan adının
 * itibarında bir açıktır ve müşteriye somut bir cümle kurdurur.
 *
 * ÖLÇÜMLE KARARLAŞTIRILANLAR (koşular 34709370416 ve 34709562560)
 *
 *   1. Çözücü "alan adı yok" (ENOTFOUND) ile "kayıt yok" (ENODATA) durumlarını
 *      AYIRIYOR. Ayrım korunuyor: alan adı çözülmüyorsa kontrol atlanır, çünkü
 *      "SPF yok" demek orada yanlış olur.
 *
 *   2. TXT kayıtları parça dizisi hâlinde geliyor (255 baytlık DNS sınırı).
 *      github.com'un SPF kaydı 320 bayt; birleştirmeyen bir ayrıştırıcı onu
 *      ortadan keserdi.
 *
 *   3. DKIM seçicileri DNS'ten NUMARALANDIRILAMIYOR ve seçici taraması tek
 *      başına YALAN SÖYLEYEBİLİYOR: example.com'da `*._domainkey` joker kaydı
 *      var ve denenen 18 seçicinin 18'i de "bulundu" göründü. Dönen kayıt
 *      `v=DKIM1; p=` idi — yani BOŞ anahtar, RFC 6376'ya göre iptal edilmiş
 *      kayıt. Bu yüzden iki koruma eklendi: (a) var olmayan bir seçici de
 *      sorulur, yanıt dönerse joker vardır ve tarama geçersizdir, (b) `p=`
 *      boşsa anahtar sayılmaz. Buna rağmen "bulunamadı" ASLA başarısızlık
 *      sayılmaz — yalnızca bilinmiyordur.
 *
 * PUANLAMA
 *
 * Üçü de `info` ağırlığında (0). Sebep bilinçli: bu kontroller POSTA yüzeyini
 * ölçüyor, motorun skoru ise WEB yüzeyi için kalibre edilmiş. Ağırlık vermek
 * hiçbir şeyini değiştirmemiş müşterilerin skorunu bir gecede düşürürdü.
 * Bulgu olarak görünüyorlar, düzeltmesi raporda yazıyor, skor sabit kalıyor.
 * Ağırlık vermek ayrı ve bilinçli bir karar olmalı (ve kalibrasyon sınamasını
 * güncellemeyi gerektirir).
 */

const dns = require('dns');

/* Zaman aşımı kısa tutuluyor: tarama süresine ekleniyor ve ölçülen gecikmeler
   16–330 ms aralığındaydı. Yavaş bir çözücü taramayı geciktirmemeli; sorgu
   düşerse kontrol "ölçülemedi" olur, tarama düşmez. */
const ZAMAN_ASIMI = 3000;

/* Yaygın DKIM seçicileri. Bu liste bir KANIT DEĞİL, yalnızca bir arama listesi.
   İlk ölçümde 18 seçici denenmişti; üretimde 8'e indirildi çünkü her seçici bir
   DNS sorgusu demek ve ölçümde bulunanların tamamı bu sekizin içindeydi
   (github: google/selector1/k1, trendyol: google/selector1/s1, anadolu:
   selector2). */
const SECICILER = ['google', 'selector1', 'selector2', 'k1', 's1', 's2', 'default', 'dkim'];

/* Joker kayıt denetimi için sorulan, var olmayan seçici. Adın kendisi önemsiz;
   önemli olan HİÇBİR alan adında gerçekten tanımlı olmaması. */
const SAHTE_SECICI = 'cl-wildcard-control-9182';

/* Birden fazla etiketten oluşan kamu son ekleri. DMARC bir üst alan adına
   düşebildiği için gerekiyor: "sirket.com.tr" için bir üst ad "com.tr" olur ve
   oraya sormak anlamsızdır. Liste kısa ve açık; tam bir Public Suffix List
   taşımıyoruz — kapsamadığı bir durumda ÜSTE ÇIKMIYORUZ, yani liste eksikse
   sonuç "bilmiyorum" olur, yanlış olmaz. */
const COK_ETIKETLI_SONEK = [
  'com.tr', 'net.tr', 'org.tr', 'edu.tr', 'gov.tr', 'k12.tr', 'av.tr', 'bel.tr',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'co.jp', 'or.jp', 'co.nz', 'co.za',
  'com.br', 'com.cn', 'com.mx', 'co.in', 'com.ar', 'com.sa', 'com.eg'
];

function cozucuYap() {
  const r = new dns.promises.Resolver({ timeout: ZAMAN_ASIMI, tries: 1 });
  return r;
}

/**
 * TXT kaydını okur. Dönüş: { ok, kayitlar } ya da { ok: false, kod }.
 * Parçalar BİRLEŞTİRİLİR — tek bir DNS dizgisi 255 baytı aşamaz.
 */
async function txtOku(cozucu, ad) {
  try {
    const ham = await cozucu.resolveTxt(ad);
    return { ok: true, kayitlar: ham.map(function (p) { return p.join(''); }) };
  } catch (e) {
    return { ok: false, kod: e.code || 'error' };
  }
}

/** Taranan hosttan sorgulanacak alan adını çıkarır. */
function alanAdi(host) {
  /* Yalnızca "www." soyuluyor. Ölçüm: www.<alan> isminde ne SPF ne DMARC
     bulunuyor (github.com'da www'de SPF vardı ama _dmarc.www yoktu); kayıtlar
     alan adının kendisinde duruyor. */
  return String(host || '').replace(/^www\./i, '').toLowerCase();
}

/** Bir üst alan adı — güvenli değilse null. */
function ustAlan(alan) {
  const parca = alan.split('.');
  if (parca.length < 3) return null;               // zaten en üstteyiz
  const ust = parca.slice(1).join('.');
  if (ust.split('.').length < 2) return null;      // TLD'ye çıkmayalım
  if (COK_ETIKETLI_SONEK.indexOf(ust) !== -1) return null;  // "com.tr" gibi
  return ust;
}

/* ============================================================
   Ayrıştırıcılar — ağ gerektirmez, doğrudan sınanabilir
   ============================================================ */

/**
 * SPF kayıtlarını değerlendirir.
 * Dönüş: { durum: 'pass'|'fail'|'none', detay, not }
 */
function spfDegerlendir(kayitlar) {
  const spf = (kayitlar || []).filter(function (k) { return /^v=spf1(\s|$)/i.test(k); });

  if (spf.length === 0) return { durum: 'none' };

  /* Birden fazla SPF kaydı RFC 7208'de HATA: alıcı sunucu kaydı tümden
     geçersiz sayar, yani "iki kayıt" tek kayıttan da kötüdür. */
  if (spf.length > 1) {
    return { durum: 'fail', detay: spf.length + ' adet SPF kaydı', not: 'spf_multiple' };
  }

  const kayit = spf[0];
  const m = /(?:^|\s)([+\-~?]?)all(?:\s|$)/i.exec(kayit);
  if (!m) return { durum: 'fail', detay: kayit, not: 'spf_no_all' };

  const mekanizma = (m[1] || '+') + 'all';
  /* "+all" herkesin bu alan adı adına posta göndermesine izin verir; kaydın
     olmamasından bile kötüdür çünkü açıkça yetki verir. */
  if (mekanizma === '+all') return { durum: 'fail', detay: kayit, not: 'spf_allows_all' };

  /* "?all" (neutral) hiçbir şey söylemiyor; alıcıya dayanak vermiyor. */
  if (mekanizma === '?all') return { durum: 'fail', detay: kayit, not: 'spf_neutral' };

  return { durum: 'pass', detay: mekanizma };
}

/**
 * DMARC kaydını değerlendirir.
 * Dönüş: { durum: 'pass'|'fail'|'none', detay, not }
 */
function dmarcDegerlendir(kayitlar) {
  const dmarc = (kayitlar || []).filter(function (k) { return /^v=DMARC1\s*;/i.test(k); });
  if (dmarc.length === 0) return { durum: 'none' };
  if (dmarc.length > 1) {
    return { durum: 'fail', detay: dmarc.length + ' adet DMARC kaydı', not: 'dmarc_multiple' };
  }

  const kayit = dmarc[0];
  const p = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(kayit);
  if (!p) return { durum: 'fail', detay: kayit, not: 'dmarc_no_policy' };

  const politika = p[1].toLowerCase();
  /* p=none yalnızca RAPORLAMA modudur: sahte e-posta yine teslim edilir.
     Ölçümde trendyol.com bu durumdaydı (üstelik rua olmadan, yani rapor bile
     toplanmıyor). Doğru adım, kaydı yazmış ama uygulamaya geçmemiş olmak. */
  if (politika === 'none') return { durum: 'fail', detay: 'p=none', not: 'dmarc_monitor_only' };

  const pct = /(?:^|;)\s*pct\s*=\s*(\d+)/i.exec(kayit);
  if (pct && Number(pct[1]) < 100) {
    return { durum: 'fail', detay: 'p=' + politika + '; pct=' + pct[1], not: 'dmarc_partial' };
  }

  return { durum: 'pass', detay: 'p=' + politika };
}

/** Bir TXT kaydı GEÇERLİ bir DKIM anahtarı mı taşıyor? */
function dkimAnahtarMi(kayit) {
  if (!/(^|;)\s*(v=DKIM1|k=)/i.test(kayit)) return false;
  const p = /(?:^|;)\s*p\s*=\s*([A-Za-z0-9+/=]*)/i.exec(kayit);
  /* `p=` BOŞ ise anahtar iptal edilmiştir (RFC 6376 §3.6.1) — "DKIM var"
     demek yanlış olur. example.com'un joker kaydı tam olarak böyleydi. */
  return !!(p && p[1] && p[1].length > 0);
}

/* ============================================================
   Ölçüm
   ============================================================ */

/**
 * Bir host için e-posta kimlik kayıtlarını ölçer.
 * Ağ hatası TARAMAYI DÜŞÜRMEZ: sonuç `{ ok: false, sebep }` olur.
 */
async function mailKayitlari(host) {
  const alan = alanAdi(host);
  if (!alan || alan.indexOf('.') === -1) return { ok: false, sebep: 'not_a_domain' };

  const cozucu = cozucuYap();

  /* Önce alan adının VAR olduğunu doğrula: NXDOMAIN dönen bir isimde "SPF yok"
     demek anlamsız. Herhangi bir kayıt türü yeter. */
  const apex = await txtOku(cozucu, alan);
  if (!apex.ok && apex.kod === 'ENOTFOUND') {
    const a = await cozucu.resolve4(alan).then(function () { return true; })
      .catch(function () { return false; });
    if (!a) return { ok: false, sebep: 'domain_not_found', alan: alan };
  }

  const spfKayitlari = apex.ok ? apex.kayitlar : [];

  /* DMARC: önce alan adının kendisi. Bulunamazsa RFC 7489'a göre kuruluş alan
     adına düşülür — ama yalnızca GÜVENLİ olduğunda (bkz. ustAlan). */
  let dmarcAd = '_dmarc.' + alan;
  let dmarc = await txtOku(cozucu, dmarcAd);
  let dmarcKayitlari = dmarc.ok ? dmarc.kayitlar.filter(function (k) { return /^v=DMARC1\s*;/i.test(k); }) : [];
  if (dmarcKayitlari.length === 0) {
    const ust = ustAlan(alan);
    if (ust) {
      const ustDmarc = await txtOku(cozucu, '_dmarc.' + ust);
      if (ustDmarc.ok) {
        const bulunan = ustDmarc.kayitlar.filter(function (k) { return /^v=DMARC1\s*;/i.test(k); });
        if (bulunan.length) { dmarcKayitlari = bulunan; dmarcAd = '_dmarc.' + ust; }
      }
    }
  }

  /* DKIM: joker denetimi ÖNCE. Joker varsa seçici taraması anlamsızdır ve
     sonucu kullanmıyoruz. */
  const joker = await txtOku(cozucu, SAHTE_SECICI + '._domainkey.' + alan);
  const jokerVar = joker.ok && joker.kayitlar.some(dkimAnahtarMi);

  let dkimSecici = null;
  if (!jokerVar) {
    const sonuclar = await Promise.all(SECICILER.map(async function (s) {
      const r = await txtOku(cozucu, s + '._domainkey.' + alan);
      return (r.ok && r.kayitlar.some(dkimAnahtarMi)) ? s : null;
    }));
    dkimSecici = sonuclar.filter(Boolean)[0] || null;
  }

  return {
    ok: true,
    alan: alan,
    spf: spfKayitlari,
    dmarc: dmarcKayitlari,
    dmarcAd: dmarcAd,
    dkimSecici: dkimSecici,
    dkimJoker: jokerVar
  };
}

module.exports = {
  mailKayitlari,
  spfDegerlendir,
  dmarcDegerlendir,
  dkimAnahtarMi,
  alanAdi,
  ustAlan,
  SECICILER,
  COK_ETIKETLI_SONEK
};
