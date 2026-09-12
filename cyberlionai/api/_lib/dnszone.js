'use strict';

/**
 * Alan adı bölgesi kontrolleri: CAA ve DNSSEC.
 *
 * NEDEN BU İKİSİ
 *
 *   CAA    — hangi sertifika makamının bu alan adına sertifika kesebileceğini
 *            DNS'te sınırlar. Kaydı olmayan bir alan adına, dünyadaki HERHANGİ
 *            bir güvenilir makam sertifika kesebilir; makamlardan biri ihlal
 *            edilirse ya da bir çalışanı kandırılırsa, sizin adınıza geçerli
 *            bir sertifika üretilebilir.
 *   DNSSEC — DNS yanıtlarını imzalar. İmzasız bir bölgede araya giren biri
 *            "bu alan adı şu IP'de" yanıtını değiştirebilir; tarayıcı sahte
 *            sunucuya bağlanır.
 *
 * ÖLÇÜMLE KARARLAŞTIRILANLAR (koşu 34712747409)
 *
 *   1. Node'un dns modülünde DS ya da DNSKEY sorgusu YOK (resolveCaa ve
 *      resolveTlsa var, DS yok). DNSSEC için ham DNS paketi göndermek
 *      gerekiyor ve önce sorulan soru şuydu: UDP/53 çalışıyor mu? Ölçüm
 *      ortamında çalıştı. Üretimde (sunucusuz ortam) çalışmayabilir; o
 *      durumda kontrol dürüstçe "ölçülemedi" der, "DNSSEC yok" DEMEZ.
 *
 *   2. Ayrım gerçekten çalışıyor:
 *        cloudflare.com  DS=2  AD=true     ietf.org      DS=2  AD=true
 *        google.com      DS=0  AD=false    trendyol.com  DS=0  AD=false
 *        cyberlionai.com DS=0  AD=false
 *
 *   3. AD biti (doğrulanmış veri) TEK BAŞINA ölçüt değil: nic.tr sorgusunda
 *      rcode=3 (ad yok) ile birlikte AD=true geldi — imzalı bir OLUMSUZ
 *      yanıt. Üstelik AD, sorduğumuz çözücünün doğrulama yapıp yapmadığına
 *      bağlı; üretimde hangi çözücünün kullanıldığını bilmiyoruz. Bu yüzden
 *      ölçüt DS kaydının VARLIĞI: DS ebeveyn bölgede durur ve "bu bölge
 *      imzalı" demenin standart yoludur.
 *
 *   4. CAA üst alan adına DÜŞER (RFC 8659). Alt alan adında kayıt olmaması
 *      eksiklik değil; ebeveyne bakılıyor.
 *
 * PUANLAMA
 *
 * İkisi de `info` (0) ve yokluk BAŞARISIZLIK SAYILMIYOR — "uygulanmamış"
 * sayılıyor. SPF/DMARC'tan farkı şu: orada yokluk, bugün herkesin
 * yapabileceği somut bir açık. Burada yokluk, saldırı için başka bir şeyin
 * de gerekmesini şart koşar (bir sertifika makamının ihlali, DNS yolunda
 * araya girme). COOP/COEP için verilen kararla aynı çizgi.
 */

const dns = require('dns');
const dgram = require('dgram');

const ZAMAN_ASIMI = 3000;
const DS_TIPI = 43;

/* Ham sorgunun gönderileceği çözücü. Sistem çözücüsü kullanılıyor: üçüncü
   taraf bir DNS servisine çıkmak, taradığımız alan adını ona bildirmek
   olurdu ve bu projede coğrafi konum için de aynı karar verilmişti. */
function sistemCozucusu() {
  const sunucular = dns.getServers()
    .map(function (s) { return String(s).replace(/^\[|\]$/g, '').split('%')[0]; })
    .filter(function (s) { return /^\d+\.\d+\.\d+\.\d+$/.test(s); });
  return sunucular[0] || null;
}

/* ---------------------------------------------------------------------------
   Ham DNS sorgusu — yalnızca SORU gönderip yanıt BAŞLIĞINI okuyoruz.
   Tam bir çözümleyici yazmıyoruz; ihtiyacımız olan iki şey var: yanıt geldi
   mi ve kaç cevap kaydı var.
--------------------------------------------------------------------------- */

function soruPaketi(ad, tip) {
  const etiketler = String(ad).split('.').filter(Boolean);
  let n = 12;
  etiketler.forEach(function (e) { n += 1 + Buffer.byteLength(e); });
  n += 1 + 4 + 11;

  const b = Buffer.alloc(n);
  b.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
  b.writeUInt16BE(0x0120, 2);           // RD + AD isteği
  b.writeUInt16BE(1, 4);                // QDCOUNT
  b.writeUInt16BE(0, 6);
  b.writeUInt16BE(0, 8);
  b.writeUInt16BE(1, 10);               // ARCOUNT (EDNS0 OPT)

  let o = 12;
  etiketler.forEach(function (e) {
    b.writeUInt8(Buffer.byteLength(e), o); o += 1;
    o += b.write(e, o);
  });
  b.writeUInt8(0, o); o += 1;
  b.writeUInt16BE(tip, o); o += 2;
  b.writeUInt16BE(1, o); o += 2;        // IN

  /* EDNS0 OPT, DO biti: DNSSEC kayıtlarını istiyoruz. Bu olmadan çözücü
     imzaları hiç göndermeyebilir. */
  b.writeUInt8(0, o); o += 1;
  b.writeUInt16BE(41, o); o += 2;
  b.writeUInt16BE(4096, o); o += 2;
  b.writeUInt8(0, o); o += 1;
  b.writeUInt8(0, o); o += 1;
  b.writeUInt16BE(0x8000, o); o += 2;
  b.writeUInt16BE(0, o);
  return b;
}

/* Bu fonksiyonun hata alanı bilerek `hata` diye adlandırıldı, `sebep` değil:
   `sebep` DIŞARIYA çıkan, kullanıcıya çevrilmesi gereken nottur. İkisi aynı
   adı taşırken "timeout" gibi bir taşıma ayrıntısı kullanıcıya not olarak
   sızabilir görünüyordu (sınama bunu yakaladı). Taşıma ayrıntısı kullanıcı
   için anlamsız: onun bilmesi gereken tek şey ölçemediğimiz. */
function hamSorgu(sunucu, ad, tip) {
  return new Promise(function (coz) {
    let bitti = false;
    const s = dgram.createSocket('udp4');

    function kapat(sonuc) {
      if (bitti) return;
      bitti = true;
      clearTimeout(zamanlayici);
      try { s.close(); } catch (e) { /* kapanmışsa sorun değil */ }
      coz(sonuc);
    }

    const zamanlayici = setTimeout(function () { kapat({ ok: false, hata: 'timeout' }); }, ZAMAN_ASIMI);

    s.on('error', function (e) { kapat({ ok: false, hata: e.code || 'error' }); });
    s.on('message', function (m) {
      if (m.length < 12) return kapat({ ok: false, hata: 'short_answer' });
      const bayraklar = m.readUInt16BE(2);
      kapat({
        ok: true,
        rcode: bayraklar & 0x0f,
        ad: !!(bayraklar & 0x0020),
        cevap: m.readUInt16BE(6)
      });
    });

    try {
      s.send(soruPaketi(ad, tip), 53, sunucu, function (e) {
        if (e) kapat({ ok: false, hata: e.code || 'send_error' });
      });
    } catch (e) {
      kapat({ ok: false, hata: 'send_failed' });
    }
  });
}

/* ============================================================
   Değerlendiriciler — ağ gerektirmez, doğrudan sınanabilir
   ============================================================ */

/**
 * CAA kayıtlarını değerlendirir.
 * Dönüş: { durum: 'pass'|'none', detay }
 */
function caaDegerlendir(kayitlar) {
  const liste = kayitlar || [];
  /* Yalnızca `issue` ve `issuewild` yetki verir; `iodef` bir raporlama
     adresidir ve tek başına hiçbir makamı sınırlamaz. */
  const yetki = liste.filter(function (k) {
    return k && (typeof k.issue === 'string' || typeof k.issuewild === 'string');
  });
  if (yetki.length === 0) return { durum: 'none' };

  /* Makam adları ayıklanıyor: "letsencrypt.org" ya da parametreli hâliyle
     "digicert.com; cansignhttpexchanges=yes" gelebiliyor (ölçüldü). */
  const makamlar = Array.from(new Set(yetki.map(function (k) {
    return String(k.issue || k.issuewild).split(';')[0].trim();
  }).filter(Boolean)));

  return {
    durum: 'pass',
    detay: makamlar.length > 3
      ? makamlar.slice(0, 3).join(', ') + ' +' + (makamlar.length - 3)
      : makamlar.join(', ')
  };
}

/**
 * DS yanıtını değerlendirir.
 * Dönüş: { durum: 'pass'|'none'|'unknown', detay, not }
 */
function dnssecDegerlendir(ds) {
  if (!ds || !ds.ok) return { durum: 'unknown', not: 'not_measured' };
  /* rcode 0 dışında bir yanıt, "imzasız" demek DEĞİL: ad yok (3) ya da sunucu
     hatası (2) olabilir. Bilmediğimizi söylemek doğrusu. */
  if (ds.rcode !== 0) return { durum: 'unknown', not: 'not_measured' };
  if (ds.cevap > 0) {
    return { durum: 'pass', detay: ds.cevap + ' DS kaydı' + (ds.ad ? ' (doğrulandı)' : '') };
  }
  return { durum: 'none' };
}

/* ============================================================
   Ölçüm
   ============================================================ */

async function bolgeKayitlari(host) {
  const alan = String(host || '').replace(/^www\./i, '').toLowerCase();
  if (!alan || alan.indexOf('.') === -1) return { ok: false, sebep: 'not_a_domain' };

  const cozucu = new dns.promises.Resolver({ timeout: ZAMAN_ASIMI, tries: 1 });
  const sunucu = sistemCozucusu();

  /* CAA ve DS paralel: ikisi de ağı bekliyor. */
  const [caa, ds] = await Promise.all([
    (async function () {
      try {
        return await cozucu.resolveCaa(alan);
      } catch (e) {
        /* CAA üst alan adına düşer (RFC 8659): alt alan adında kayıt
           olmaması eksiklik değil, ebeveyndeki kayıt geçerlidir. */
        const parca = alan.split('.');
        if (parca.length > 2) {
          try { return await cozucu.resolveCaa(parca.slice(1).join('.')); }
          catch (e2) { return []; }
        }
        return [];
      }
    })(),
    sunucu ? hamSorgu(sunucu, alan, DS_TIPI) : Promise.resolve({ ok: false, hata: 'no_resolver' })
  ]);

  return { ok: true, alan: alan, caa: caa, ds: ds };
}

module.exports = {
  bolgeKayitlari,
  caaDegerlendir,
  dnssecDegerlendir,
  sistemCozucusu
};
