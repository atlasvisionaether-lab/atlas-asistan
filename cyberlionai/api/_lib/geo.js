'use strict';

/**
 * IP → ülke çözümü.
 *
 * Tablo `geo-table.js`'de; RIR delegasyon dosyalarından üretiliyor (kamu malı,
 * anahtar gerektirmez). Üçüncü taraf bir coğrafi konum servisine çağrı YOK:
 * ne tarayıcıdan ne sunucudan. Bu, hem CSP'yi dar tutuyor hem de taradığımız
 * ya da listelediğimiz adresleri dışarıdaki bir servise bildirmemizi önlüyor.
 *
 * Çözünürlük sınırı dürüstçe: RIR tablosu bir adresin KAYITLI OLDUĞU ülkeyi
 * verir, fiziksel konumunu değil. Büyük sağlayıcılarda ikisi ayrışabilir.
 * Harita bu yüzden "altyapının kayıtlı olduğu ülke" der, "saldırganın yeri"
 * demez.
 */

let TABLO = null;

function yukle() {
  if (TABLO) return TABLO;
  let ham;
  try {
    ham = require('./geo-table.js');
  } catch (err) {
    // Tablo uretilmemisse cozum sessizce devre disi kalir; harita feodo'nun
    // kendi ulke alaniyla calismaya devam eder.
    TABLO = { hazir: false, n: 0, buf: null, ulkeler: [], generatedAt: null };
    return TABLO;
  }
  const buf = Buffer.from(ham.packed, 'base64');
  TABLO = {
    hazir: buf.length > 0 && buf.length % 9 === 0,
    n: Math.floor(buf.length / 9),
    buf: buf,
    ulkeler: ham.countries || [],
    generatedAt: ham.generatedAt || null
  };
  return TABLO;
}

/** "203.0.113.7" → 3405803783; geçersizse null. */
function ipToInt(s) {
  if (typeof s !== 'string') return null;
  const p = s.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(p[i])) return null;
    const v = Number(p[i]);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/**
 * IP adresinin kayıtlı olduğu ülke kodu (ISO-2) veya null.
 *
 * İkili arama: aralıklar başlangıca göre sıralı. Bulunamayan adres için null
 * döner — UYDURULMAZ. Haritada görünmeyen kayıt da kayıttır ve ayrıca sayılır.
 */
function countryOfIp(ip) {
  const t = yukle();
  if (!t.hazir) return null;
  const x = ipToInt(ip);
  if (x === null) return null;

  let lo = 0, hi = t.n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const o = mid * 9;
    const bas = t.buf.readUInt32BE(o);
    const bit = t.buf.readUInt32BE(o + 4);
    if (x < bas) hi = mid - 1;
    else if (x > bit) lo = mid + 1;
    else return t.ulkeler[t.buf.readUInt8(o + 8)] || null;
  }
  return null;
}

/**
 * Bir URL veya host içindeki IPv4 adresini çıkarır.
 *
 * Yalnızca ÇIPLAK IP kabul edilir. Alan adı çözümlemesi BİLEREK yapılmıyor:
 * DNS sorgusu, listelenen zararlı alan adlarını bizim çözücümüze bildirmek
 * demektir ve her tazelemede binlerce sorgu üretirdi.
 */
function ipFromUrl(u) {
  if (typeof u !== 'string') return null;
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i.exec(u);
  if (m) return ipToInt(m[1]) === null ? null : m[1];
  const m2 = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(u.trim());
  return m2 && ipToInt(m2[1]) !== null ? m2[1] : null;
}

/** Tablonun durumu — arayüzde dürüstçe gösterilebilsin diye. */
function tableInfo() {
  const t = yukle();
  return { ready: t.hazir, ranges: t.n, countries: t.ulkeler.length, generatedAt: t.generatedAt };
}

module.exports = { countryOfIp, ipFromUrl, ipToInt, tableInfo };
