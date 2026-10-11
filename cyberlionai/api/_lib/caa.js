'use strict';

/**
 * CAA: sertifika yetkisi kaydı.
 *
 * Hangi sertifika makamının bu alan adına sertifika kesebileceğini DNS'te
 * sınırlar. Kaydı olmayan bir alan adına, dünyadaki HERHANGİ bir güvenilir
 * makam sertifika kesebilir; makamlardan biri ihlal edilirse ya da bir
 * çalışanı kandırılırsa sizin adınıza geçerli bir sertifika üretilebilir.
 *
 * ÖLÇÜMLE KARARLAŞTIRILANLAR (koşu 34712747409, yedi alan adı)
 *
 *   1. Dönen nesnenin biçimi: `{ critical, issue }` ya da
 *      `{ critical, issuewild }`, bazen `{ critical, iodef }`.
 *
 *   2. `iodef` YETKİ SAYILMIYOR. cloudflare.com kaydında bir iodef (ihlal
 *      bildirim adresi) var; tek başına hiçbir makamı sınırlamaz. Yalnızca
 *      `issue` ve `issuewild` yetki verir.
 *
 *   3. Makam adı parametreli gelebiliyor: "digicert.com; cansignhttpexchanges=yes".
 *      Noktalı virgülden sonrası parametre, makam adının parçası değil.
 *
 *   4. CAA üst alan adına DÜŞER (RFC 8659): sertifika makamı, sorulan adda
 *      kayıt bulamazsa ebeveyne bakar. Alt alan adında kayıt olmaması
 *      eksiklik DEĞİL — bu yüzden ebeveyn de sorulyor.
 *
 * PUANLAMA
 *
 * `info` (0) ve YOKLUK başarısızlık sayılmıyor, "uygulanmamış" sayılıyor.
 * SPF/DMARC'tan ayrım bilinçli: orada yokluk bugün herkesin yapabileceği
 * somut bir açık; burada yokluk saldırı için bir sertifika makamının
 * ihlalini de şart koşar. COOP/COEP kararıyla aynı çizgi.
 *
 * Kayıtlı alan adı hesabı _lib/dnssec.js ile PAYLAŞILIYOR (registrableDomain):
 * iki ayrı kural iki ayrı cevap verirdi.
 */

const dns = require('dns');
const { registrableDomain } = require('./dnssec.js');

const ZAMAN_ASIMI = 3000;

/**
 * CAA kayıtlarını değerlendirir — ağ gerektirmez, doğrudan sınanabilir.
 * @returns {{durum: 'pass'|'none', detay?: string}}
 */
function caaDegerlendir(kayitlar) {
  const liste = kayitlar || [];
  const yetki = liste.filter(function (k) {
    return k && (typeof k.issue === 'string' || typeof k.issuewild === 'string');
  });
  if (yetki.length === 0) return { durum: 'none' };

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
 * Hedefin CAA kayıtlarını okur. PASİF: hedef siteye istek yok, yalnızca DNS.
 * Sorgu sistem çözümleyicisine gidiyor; sabit bir üçüncü taraf adrese
 * sorsaydık taranan her alan adını o servise bildirmiş olurduk (bkz. _lib/geo.js).
 * @returns {Promise<{ok: boolean, kayitlar?: Array, sebep?: string}>}
 */
async function caaKayitlari(host) {
  const alan = registrableDomain(host);
  if (!alan) return { ok: false, sebep: 'not_a_domain' };

  const cozucu = new dns.promises.Resolver({ timeout: ZAMAN_ASIMI, tries: 1 });

  try {
    return { ok: true, kayitlar: await cozucu.resolveCaa(alan) };
  } catch (e) {
    /* Kayıt yok (ENODATA/ENOTFOUND) ile sorgu düştü (timeout/SERVFAIL) AYRI:
       ilki ölçülmüş bir yokluk, ikincisi bilgisizlik. */
    if (e && (e.code === 'ENODATA' || e.code === 'ENOTFOUND')) {
      return { ok: true, kayitlar: [] };
    }
    return { ok: false, sebep: 'not_measured' };
  }
}

module.exports = { caaKayitlari, caaDegerlendir };
