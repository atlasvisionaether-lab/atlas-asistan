'use strict';

/**
 * Tarama haritası: Cyber Lion AI'ın KENDİ taramalarından ülke başına özet.
 *
 * NEDEN: harita eskiden açık tehdit beslemeleriyle besleniyordu. URLhaus 410,
 * PhishTank 404 dönüyor; Feodo ve URLhaus (abuse.ch) ücretsiz yalnızca kâr
 * amacı gütmeyen kullanıma açık, PhishTank'in ticari koşulu belirsiz. Google
 * Web Risk liste vermiyor (yalnız adres sorgusu); Spamhaus DROP'un koşulları
 * lisans vermiyor ve ticari materyalde adını yasaklıyor (ölçüldü: 2026-10-25).
 * Lisans sorunu olmayan veri kendi ölçümümüz.
 *
 * Saf: ağ yok. Girdi db.recentScansForMap() satırları.
 *
 * GİZLİLİK: yanıtta host, IP, kullanıcı ya da oturum YOK; yalnızca ülke başına
 * sayı. Bir ülkede DETAY_ESIGI'nden az site varsa bulgu dağılımı verilmez —
 * tek sitenin sorunları ülke üzerinden tahmin edilemesin.
 *
 * HAZIRLIK: veri azken harita yanıltıcı derecede boş (ölçüm 2026-10-25: 39
 * tarama, tek ülke). Bölüm, HAZIR_ULKE ülke ve HAZIR_SITE benzersiz siteye
 * ulaşana kadar ana sayfada gizli kalır (bkz. ready).
 */

const { CHECKS } = require('./report.js');

const DETAY_ESIGI = 3;
const HAZIR_ULKE = 10;
const HAZIR_SITE = 200;
/* Ülke kırılımında sayılan bulgular: yalnızca ağırlıklı (skoru etkileyen)
   başarısızlıklar. `info` (SPF/DMARC/CAA…) haritayı gürültüye boğardı. */
const SAYILAN_ONEM = ['critical', 'high', 'medium'];
const HOUR = 3600e3;

/**
 * @param rows  [{ host, country, scanned_at, findings: [{id, severity, status}] }]
 *              yeniden eskiye sıralı (her host'un ilk satırı en yenisi)
 * @param now   epoch ms
 */
function aggregate(rows, now) {
  const gorulen = new Set();
  const ulkeler = new Map();
  let site = 0;

  for (const r of rows || []) {
    if (!r || typeof r.host !== 'string' || !/^[A-Z]{2}$/.test(r.country || '')) continue;
    const host = r.host.toLowerCase();
    if (gorulen.has(host)) continue;           // yalnızca sitenin EN YENİ taraması
    gorulen.add(host);
    site++;

    let e = ulkeler.get(r.country);
    if (!e) {
      e = { country: r.country, count: 0, windows: { h1: 0, h24: 0, d7: 0 }, bulgu: new Map(), sorunlu: 0 };
      ulkeler.set(r.country, e);
    }
    e.count++;
    const t = Date.parse(r.scanned_at || '');
    if (!isNaN(t) && t <= now) {
      const yas = now - t;
      if (yas <= HOUR) e.windows.h1++;
      if (yas <= 24 * HOUR) e.windows.h24++;
      if (yas <= 7 * 24 * HOUR) e.windows.d7++;
    }

    const ids = new Set();
    (Array.isArray(r.findings) ? r.findings : []).forEach(function (f) {
      if (f && f.status === 'fail' && SAYILAN_ONEM.indexOf(f.severity) !== -1 && CHECKS.tr[f.id]) ids.add(f.id);
    });
    if (ids.size) e.sorunlu++;
    ids.forEach(function (id) { e.bulgu.set(id, (e.bulgu.get(id) || 0) + 1); });
  }

  const ad = function (id) { return CHECKS.tr[id][0]; };
  const countries = Array.from(ulkeler.values()).map(function (e) {
    const o = { country: e.country, count: e.count, windows: e.windows };
    if (e.count >= DETAY_ESIGI) {
      o.withIssues = e.sorunlu;
      o.threats = Array.from(e.bulgu.entries())
        .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3)
        .map(function (p) { return { name: ad(p[0]), count: p[1] }; });
    }
    return o;
  }).sort(function (a, b) { return b.count - a.count; });

  /* Genel dağılım yalnızca eşiği geçen ülkelerin bulgularından: eşik altı
     ülkenin tek sitesi genel listede de iz bırakmasın. */
  const genel = new Map();
  ulkeler.forEach(function (e) {
    if (e.count < DETAY_ESIGI) return;
    e.bulgu.forEach(function (n, id) { genel.set(ad(id), (genel.get(ad(id)) || 0) + n); });
  });

  return {
    total: site,
    countries: countries,
    threats: Array.from(genel.entries())
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10)
      .map(function (p) { return { name: p[0], count: p[1] }; })
  };
}

/** Bölüm gösterilecek kadar veri var mı. */
function ready(agg) {
  return !!agg && agg.total >= HAZIR_SITE && agg.countries.length >= HAZIR_ULKE;
}

module.exports = { aggregate, ready, DETAY_ESIGI, HAZIR_ULKE, HAZIR_SITE };
