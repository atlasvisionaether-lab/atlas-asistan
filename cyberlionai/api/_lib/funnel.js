'use strict';

/**
 * Dönüşüm hunisi sayacı: hangi ücretsiz araç tam taramaya ve ödemeye dönüşüyor.
 *
 *   tool_use          bir araç kullanıldı (POST /api/tool-check)
 *   scan              tam tarama başladı (POST /api/scan, kota ayrıldıktan sonra)
 *   checkout_start    iyzico ödeme formuna gidildi (GET/POST /api/checkout)
 *   checkout_success  ödeme etkin aboneliğe döndü (/api/checkout-return)
 *   fix_checkout_start "Biz düzeltelim" ödeme formuna gidildi (/api/fix-pay)
 *   fix_paid          düzeltme siparişi ödendi (/api/fix-pay-return, sipariş başına bir kez)
 *
 * Her olay bir KAYNAKLA sayılır: ziyaretçinin geldiği araç ('headers',
 * 'email', 'ssl', 'blacklist') ya da 'direct'. Kaynak araç sayfasındaki
 * bağlantıların `kaynak=` parametresiyle gelir; tarayıcı onu yalnızca o
 * sekmenin oturum belleğinde taşır (/kaynak.js).
 *
 * GİZLİLİK: yalnızca GÜNLÜK TOPLAM. Çerez, kimlik, IP, alan adı ya da kullanıcı
 * yazılmaz; anahtar `cl:fn:<gün>:<olay>:<kaynak>`, değer bir sayı. Kaynak
 * izinli listeden; dışındaki her değer 'direct' sayılır (anahtar uzayı sabit).
 *
 * Sayma ASLA isteği bozmaz: depo yoksa ya da yazılamazsa sessizce geçilir.
 */

const store = require('./store.js');

const EVENTS = ['tool_use', 'scan', 'checkout_start', 'checkout_success', 'fix_checkout_start', 'fix_paid'];
const SOURCES = ['headers', 'email', 'ssl', 'blacklist', 'direct'];
const TTL_SECONDS = 400 * 86400;   // bir yıldan biraz uzun: yıllık karşılaştırma

function source(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return SOURCES.indexOf(v) !== -1 ? v : 'direct';
}

/** İstanbul saatine göre gün (YYYY-MM-DD). */
function day(now) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}

function key(d, event, src) { return 'cl:fn:' + d + ':' + event + ':' + src; }

/** Olayı sayar. Hata fırlatmaz; sonucu isteğe bağlamaz. */
async function record(event, rawSource, now) {
  if (EVENTS.indexOf(event) === -1) return false;
  if (!store.isConfigured()) return false;
  try {
    await store.incrCounter(key(day(now || Date.now()), event, source(rawSource)), TTL_SECONDS);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Son `days` günün tablosu: { days: [...], totals: { olay: { kaynak: n } },
 * daily: [{ day, counts: { olay: { kaynak: n } } }] }.
 */
async function report(days, now) {
  const n = Math.max(1, Math.min(90, Math.floor(Number(days) || 30)));
  const t = now || Date.now();
  const gunler = [];
  for (let i = n - 1; i >= 0; i--) gunler.push(day(t - i * 86400e3));
  const anahtarlar = [];
  gunler.forEach(function (d) {
    EVENTS.forEach(function (e) { SOURCES.forEach(function (s) { anahtarlar.push(key(d, e, s)); }); });
  });
  const degerler = await store.readCounters(anahtarlar);
  const bos = function () {
    const o = {};
    EVENTS.forEach(function (e) { o[e] = {}; SOURCES.forEach(function (s) { o[e][s] = 0; }); });
    return o;
  };
  const totals = bos();
  const daily = [];
  let i = 0;
  gunler.forEach(function (d) {
    const c = bos();
    EVENTS.forEach(function (e) {
      SOURCES.forEach(function (s) {
        const v = degerler[i++] || 0;
        c[e][s] = v;
        totals[e][s] += v;
      });
    });
    daily.push({ day: d, counts: c });
  });
  return { days: gunler, events: EVENTS, sources: SOURCES, totals: totals, daily: daily };
}

module.exports = { record, report, source, day, EVENTS, SOURCES };
