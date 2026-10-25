'use strict';

/**
 * Açık tehdit beslemeleri — sunucu tarafı çekme ve normalleştirme.
 *
 * Neden sunucuda: tarayıcının CSP'si `connect-src 'self'` ile dar tutuluyor ve
 * öyle kalmalı. Harita için üçüncü taraf adres eklemek yerine istek burada
 * yapılır; tarayıcı yalnızca kendi origin'imizle konuşur.
 *
 * KAYNAKLAR (2026-10-25): yalnızca Tor çıkış düğümleri (Tor Project; ölçüm
 * verisi CC0). Kaldırılanlar ve sebebi:
 *   urlhaus    410 Gone; abuse.ch ücretsiz kullanımı kâr amacı gütmeyenlere açık
 *   feodo      abuse.ch, aynı koşul
 *   phishtank  404; ticari kullanım koşulu belirsiz, yeni kayıt kapalı
 * Harita artık kendi taramalarımızdan besleniyor (bkz. _lib/ownmap.js). Tor
 * bir anonimlik ağıdır, kötü niyetli altyapı DEĞİLDİR: haritada işaret
 * olarak değil, ayrı bir sayaç olarak gösterilir (geo: false).
 *
 * Ticari tehdit haritalarının (Kaspersky, Check Point, Fortinet, Radware)
 * verisi ve adlandırması bilerek kullanılmıyor: açık API'leri yok ve şartları
 * yeniden yayını yasaklıyor.
 */

const geo = require('./geo.js');

const FETCH_TIMEOUT_MS = 5000;

/* Bir beslemeden okunacak azami gövde (Tor listesi ölçümde ~17 KB). Sınır
   aşılırsa besleme sessizce yarım ayrıştırılmaz, açıkça başarısız sayılır. */
const MAX_BYTES = 2 * 1024 * 1024;

const UA = 'CyberLionAI-WorldMap/1.0 (+https://www.cyberlionai.com)';

/* ------------------------------------------------------------------
   Çekme
   ------------------------------------------------------------------ */

async function fetchBody(url) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': '*/*' }
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('feed_unreachable');
  }

  if (!response.ok) {
    clearTimeout(timer);
    throw new Error('feed_status_' + response.status);
  }

  /* Content-Length güvenilmez (sıkıştırma, eksik başlık). Gövde parça parça
     okunup sınır gerçekten aşıldığında kesilir. */
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.length;
      if (total > MAX_BYTES) {
        reader.cancel().catch(function () {});
        throw new Error('feed_too_large');
      }
      chunks.push(step.value);
    }
  } finally {
    clearTimeout(timer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/* ------------------------------------------------------------------
   Ayrıştırıcılar — her biri ölçülmüş biçime birebir yazıldı
   ------------------------------------------------------------------ */

/** Ülke haritasını, en yoğundan aza sıralı düz listeye çevirir. */
function ulkeListesi(m) {
  return Array.from(m.values())
    .map(function (e) {
      const o = { country: e.country, count: e.count };
      if (e.online !== undefined) o.online = e.online;
      /* Zaman pencereleri yalnizca damga TASIYAN kaynaklarda var. Yoklugu
         "sifir" degil "olculemedi" demek; bu yuzden alan hic eklenmiyor ve
         arayuz farki gorebiliyor. */
      if (e.windows) o.windows = e.windows;
      if (e.malware) {
        o.malware = Array.from(e.malware.entries())
          .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3)
          .map(function (p) { return { name: p[0], count: p[1] }; });
      }
      if (e.threats) {
        o.threats = Array.from(e.threats.entries())
          .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3)
          .map(function (p) { return { name: p[0], count: p[1] }; });
      }
      return o;
    })
    .sort(function (a, b) { return b.count - a.count; });
}

/**
 * torexit: satır başına bir IP, düz metin.
 *
 * Ülke yok, dolayısıyla harita işareti yok. Yalnızca çıkış düğümü sayısı
 * sunuluyor; IP listesi dışarı verilmiyor.
 */
function parseTorExit(text) {
  const byCountry = new Map();
  let count = 0;
  let cozulemeyen = 0;
  for (const line of text.split('\n')) {
    const v = line.trim();
    if (!v || v.charAt(0) === '#') continue;
    count++;
    const cc = geo.countryOfIp(v);
    if (cc) {
      let e = byCountry.get(cc);
      if (!e) { e = { country: cc, count: 0 }; byCountry.set(cc, e); }
      e.count++;
    } else {
      cozulemeyen++;
    }
  }
  return { total: count, unresolved: cozulemeyen, countries: ulkeListesi(byCountry) };
}

/* ------------------------------------------------------------------
   Kaynak tanımları
   ------------------------------------------------------------------ */

/** `ttl` kaynak başına ayrı; Tor listesi saatte bir tazeleniyor, sayaç için
    yarım saat yeterli. */
const SOURCES = [
  {
    id: 'torexit',
    label: 'Tor çıkış düğümleri',
    attribution: 'Tor Project',
    url: 'https://check.torproject.org/torbulkexitlist',
    /* Sayaç: haritada işaret YOK (anonimlik ağı, tehdit değil). Ülke kırılımı
       yine hesaplanıyor ama işaretlere karışmıyor. */
    geo: false,
    geoSource: 'resolved',
    /* Duz IP listesi; OLCULDU, tek bir tarih bile yok. */
    supportsWindows: false,
    ttl: 30 * 60,
    parse: parseTorExit
  }
];

/**
 * Tek kaynağı çeker ve ayrıştırır.
 *
 * Hata YAYILMAZ: bir besleme düşerse diğerleri gösterilmeye devam eder.
 * Harita "üç kaynaktan ikisi" ile de doğru bir haritadır; hepsini birden
 * kaybetmek çok daha kötü bir sonuç.
 */
async function loadSource(source) {
  try {
    const data = source.parse(await fetchBody(source.url));
    return {
      id: source.id,
      label: source.label,
      attribution: source.attribution,
      geo: source.geo,
      geoSource: source.geoSource || null,
      supportsWindows: source.supportsWindows === true,
      ok: true,
      fetchedAt: new Date().toISOString(),
      data: data
    };
  } catch (err) {
    const code = err && err.message ? String(err.message) : 'feed_error';
    return {
      id: source.id,
      label: source.label,
      attribution: source.attribution,
      geo: source.geo,
      geoSource: source.geoSource || null,
      supportsWindows: source.supportsWindows === true,
      ok: false,
      fetchedAt: new Date().toISOString(),
      error: /^feed_/.test(code) ? code : 'feed_error'
    };
  }
}

function findSource(id) {
  return SOURCES.find(function (s) { return s.id === id; }) || null;
}

module.exports = { SOURCES, loadSource, findSource, ulkeListesi };
