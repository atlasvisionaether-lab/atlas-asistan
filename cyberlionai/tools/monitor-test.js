'use strict';

/**
 * Sürekli izleme sınaması (api/_lib/monitor.js).
 *
 * Sabitlenen kararlar:
 *   - Skor ≥5 düşerse uyarı; aynı tarama için bir kez.
 *   - SSL 30/7/1, alan adı 30/7 gün eşikleri; her eşik bir kez.
 *   - Kara liste alt alan adında da (üst alan listede) yakalanır.
 *   - Kesinti uyarısı art arda 2 başarısızlıktan sonra; dönünce "düzeldi".
 *   - İzleme taraması PASİF (consent false) ve günlüğe yazılır.
 *   - QStash zamanlayıcısı sabit kimlikle (kopya üretmez), 5 dakikada bir.
 *
 * Ağ ve veritabanı yok.
 */

const path = require('node:path');
const Module = require('node:module');
const API = path.join(__dirname, '..', 'api');

let gecti = 0;
const hatalar = [];
function dogru(ad, k) { if (k) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, b, e) {
  if (b === e) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')');
}
function sapla(rel, govde) {
  const tam = require.resolve(path.join(API, rel));
  const m = new Module(tam, null);
  m.filename = tam; m.loaded = true; m.exports = govde;
  require.cache[tam] = m;
}

const uyarilar = [];
const gunluk = [];
let oncekiSkor = null;
sapla('_lib/db.js', {
  isConfigured: function () { return true; },
  request: async function (yol, s) {
    if (yol.indexOf('monitor_alerts') === 0 && s && s.method === 'POST') { uyarilar.push(s.body); return null; }
    if (yol.indexOf('scan_logs') === 0 && s && s.method === 'POST') { gunluk.push(s.body); return null; }
    if (yol.indexOf('scan_jobs') === 0) return oncekiSkor === null ? [] : [{ score: oncekiSkor }];
    if (yol.indexOf('cl_subscriptions') === 0) {
      return [
        { user_id: 'u1', domain: 'Ornek.com', plan: 'pro' },
        { user_id: 'u1', domain: 'ornek.com', plan: 'pro' },
        { user_id: 'u2', domain: 'kurum.com.tr', plan: 'enterprise' },
        { user_id: 'u3', domain: 'gecersiz', plan: 'pro' }
      ];
    }
    return [];
  }
});
const kilit = {};
const onbellek = {};
sapla('_lib/store.js', {
  isConfigured: function () { return true; },
  setOnce: async function (k) { if (kilit[k]) return false; kilit[k] = true; return true; },
  hitRateLimit: async function () { return { count: 1, ttl: 60 }; },
  cacheGet: async function (k) { return onbellek[k] || null; },
  cacheSet: async function (k, v) { onbellek[k] = JSON.parse(JSON.stringify(v)); }
});
const telegram = [];
global.fetch = async function (url, o) {
  if (String(url).indexOf('api.telegram.org') !== -1) { telegram.push(JSON.parse(o.body).text); return { ok: true, status: 200 }; }
  throw new Error('beklenmeyen ağ isteği: ' + url);
};
process.env.TELEGRAM_BOT_TOKEN = '7851234567:AAH9xKq-Zm3Rn4pQw7sTvB2cDeFgHiJkLmN';
process.env.TELEGRAM_CHAT_ID = '-1001';
sapla('_lib/guard.js', Object.assign({}, require(path.join(API, '_lib', 'guard.js')), {
  assertPublicHost: async function () { return ['203.0.113.5']; }
}));

const monitor = require(path.join(API, '_lib', 'monitor.js'));

async function kos() {
  /* ---------- saf yardımcılar ---------- */
  esit('eşik 45 gün → yok', monitor.crossedThreshold(45, [30, 7, 1]), null);
  esit('eşik 30', monitor.crossedThreshold(30, [30, 7, 1]), 30);
  esit('eşik 6 → 7', monitor.crossedThreshold(6, [30, 7, 1]), 7);
  esit('eşik 0 → 1', monitor.crossedThreshold(0, [30, 7, 1]), 1);
  esit('eşik bitmiş (-3) → 1', monitor.crossedThreshold(-3, [30, 7, 1]), 1);
  esit('eşik sayı değil', monitor.crossedThreshold(null, [30]), null);
  esit('kayıtlı alan: .com', monitor.registrableDomain('a.b.ornek.com'), 'ornek.com');
  esit('kayıtlı alan: .com.tr', monitor.registrableDomain('www.ornek.com.tr'), 'ornek.com.tr');
  esit('kayıtlı alan: .tr tek seviye', monitor.registrableDomain('ornek.tr'), 'ornek.tr');
  const set = monitor.parseHostfile('# yorum\n127.0.0.1\tkotu.example\n127.0.0.1\tlocalhost\n\n127.0.0.1 diger.test\n');
  esit('host listesi boyutu', set.size, 2);
  esit('kara liste birebir', monitor.blacklistedHost('kotu.example', set), 'kotu.example');
  esit('kara liste alt alan', monitor.blacklistedHost('cdn.kotu.example', set), 'kotu.example');
  esit('kara liste benzer ad değil', monitor.blacklistedHost('iyikotu.example', set), null);
  esit('RDAP bitiş', monitor.rdapExpiration({ events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' },
    { eventAction: 'expiration', eventDate: '2027-02-01T00:00:00Z' }] }), '2027-02-01T00:00:00.000Z');
  esit('RDAP olay yok', monitor.rdapExpiration({}), null);

  /* ---------- hedefler ---------- */
  const hedefler = await monitor.paidTargets();
  esit('hedef: kopya ve geçersiz atılır', hedefler.length, 2);
  esit('hedef: küçük harf', hedefler[0].domain, 'ornek.com');
  const s1 = await monitor.claimDue(hedefler, 5);
  const s2 = await monitor.claimDue(hedefler, 5);
  esit('günde bir: ilk koşu ikisini alır', s1.length, 2);
  esit('günde bir: ikinci koşu boş', s2.length, 0);

  /* ---------- günlük kontrol ---------- */
  const hedef = { userId: 'u1', domain: 'ornek.com', plan: 'pro' };
  let istenen = null;
  const ctx = {
    blacklist: new Set(['ornek.com']),
    scanSite: async function (url, o) { istenen = o; return { score: 70, tls: { validTo: '2026-10-10T00:00:00.000Z', daysLeft: 6 } }; },
    saveJob: async function () { return 'job-1'; },
    domainExpiry: async function () { return '2026-10-20T00:00:00.000Z'; },
    now: function () { return Date.parse('2026-10-04T00:00:00Z'); }
  };
  oncekiSkor = 90;
  const r = await monitor.dailyCheck(hedef, ctx);
  esit('izleme taraması pasif', istenen.consent, false);
  esit('izleme taraması günlüğe yazıldı', gunluk.length === 1 && gunluk[0].level === 'passive' && gunluk[0].ip === null, true);
  dogru('skor düşüşü uyarısı', r.alerts.indexOf('score_drop') !== -1);
  dogru('SSL uyarısı', r.alerts.indexOf('ssl_expiry') !== -1);
  dogru('kara liste uyarısı', r.alerts.indexOf('blacklist') !== -1);
  dogru('alan adı bitiş uyarısı', r.alerts.indexOf('domain_expiry') !== -1);
  const ssl = uyarilar.find(function (u) { return u.kind === 'ssl_expiry'; });
  esit('SSL 6 gün → kritik', ssl.severity, 'critical');
  esit('SSL eşiği 7', ssl.data.threshold, 7);
  const drop = uyarilar.find(function (u) { return u.kind === 'score_drop'; });
  esit('düşüş verisi', drop.data.from + '→' + drop.data.to, '90→70');
  dogru('uyarı hesaba yazıldı', uyarilar.every(function (u) { return u.user_id === 'u1' && u.domain === 'ornek.com'; }));
  dogru('Telegram metni', telegram.some(function (m) { return /Skor düştü: ornek\.com 90 → 70/.test(m); }));

  const onceSayi = uyarilar.length;
  ctx.saveJob = async function () { return 'job-1'; };
  await monitor.dailyCheck(hedef, ctx);
  esit('aynı olaylar ikinci kez uyarı üretmez', uyarilar.length, onceSayi);

  /* Küçük düşüş uyarı üretmez */
  oncekiSkor = 72;
  const r2 = await monitor.dailyCheck({ userId: 'u9', domain: 'temiz.com', plan: 'pro' }, {
    blacklist: new Set(), now: ctx.now, domainExpiry: async function () { return null; },
    scanSite: async function () { return { score: 70, tls: { validTo: 'x', daysLeft: 200 } }; }
  });
  esit('2 puan düşüş uyarı yok', r2.alerts.length, 0);

  const r3 = await monitor.dailyCheck({ userId: 'u9', domain: 'bozuk.com', plan: 'pro' }, {
    blacklist: new Set(), scanSite: async function () { throw new Error('unreachable'); }
  });
  esit('tarama düşerse ok:false', r3.ok, false);
  esit('tarama hatası kodu', r3.error, 'unreachable');

  /* ---------- erişilebilirlik ---------- */
  const ent = { userId: 'u2', domain: 'kurum.com.tr', plan: 'enterprise' };
  let durum = 503;
  const f = async function () { return { status: durum, body: null }; };
  const sayac0 = uyarilar.length;
  let u = await monitor.uptimeCheck(ent, { fetch: f });
  esit('1. başarısızlık uyarı yok', u.event, null);
  u = await monitor.uptimeCheck(ent, { fetch: f });
  esit('2. başarısızlık → downtime', u.event, 'downtime');
  u = await monitor.uptimeCheck(ent, { fetch: f });
  esit('düşükken tekrar uyarı yok', u.event, null);
  durum = 301;
  u = await monitor.uptimeCheck(ent, { fetch: f });
  esit('3xx ayakta sayılır → recovered', u.event, 'recovered');
  esit('kesinti + düzeldi = 2 uyarı', uyarilar.length - sayac0, 2);
  const zaman = async function () { const e = new Error('x'); e.name = 'AbortError'; throw e; };
  u = await monitor.uptimeCheck(ent, { fetch: zaman });
  u = await monitor.uptimeCheck(ent, { fetch: zaman });
  esit('zaman aşımı da kesinti', u.event, 'downtime');
  dogru('kesinti sebebi timeout', uyarilar[uyarilar.length - 1].data.reason === 'timeout');

  /* ---------- DNSSEC + e-posta skoru ---------- */
  const dnssec = require(path.join(API, '_lib', 'dnssec.js'));
  const doh = function (json) { return async function (url) { doh.son = url; return { ok: true, json: async function () { return json; } }; }; };
  let ds = await dnssec.dnssecDurumu('www.ornek.com.tr', doh({ Status: 0, Answer: [{ type: 43 }] }));
  esit('DNSSEC açık', ds.enabled, true);
  dogru('DS kayıtlı alan adında sorulur', /name=ornek\.com\.tr&type=DS/.test(doh.son));
  ds = await dnssec.dnssecDurumu('ornek.com', doh({ Status: 0 }));
  esit('DNSSEC yok', ds.ok && ds.enabled === false, true);
  ds = await dnssec.dnssecDurumu('ornek.com', doh({ Status: 2 }));
  esit('SERVFAIL ölçülemedi (yok sayılmaz)', ds.ok, false);
  esit('e-posta skoru: skipped paydan düşer', dnssec.emailScore([
    { id: 'spf', status: 'pass' }, { id: 'dmarc', status: 'fail' },
    { id: 'dkim', status: 'skipped' }, { id: 'dnssec', status: 'pass' }]).score, 50);
  esit('e-posta skoru: tamamı', dnssec.emailScore([{ id: 'spf', status: 'pass' }, { id: 'dmarc', status: 'pass' }]).score, 100);
  esit('e-posta skoru: ölçüm yok', dnssec.emailScore([{ id: 'hsts', status: 'pass' }]), null);

  /* ---------- QStash zamanlayıcısı ---------- */
  delete process.env.QSTASH_TOKEN;
  esit('belirteç yoksa oluşturulmaz', (await monitor.ensureTickSchedule()).code, 'qstash_token_missing');
  process.env.QSTASH_TOKEN = 'qs-token';
  let istek = null;
  const sonuc = await monitor.ensureTickSchedule('https://www.cyberlionai.com', async function (url, o) { istek = { url: url, o: o }; return { ok: true, status: 200 }; });
  esit('zamanlayıcı oluşturuldu', sonuc.ok, true);
  esit('hedef adres', istek.url, 'https://qstash.upstash.io/v2/schedules/https://www.cyberlionai.com/api/cron/tick');
  esit('5 dakikada bir', istek.o.headers['Upstash-Cron'], '*/5 * * * *');
  esit('sabit kimlik (kopya yok)', istek.o.headers['Upstash-Schedule-Id'], 'cyberlion-monitor-tick');
  esit('POST ile çağrılır', istek.o.headers['Upstash-Method'], 'POST');
  esit('gövde düz metin (imza özeti tutsun)', istek.o.headers['Content-Type'], 'text/plain');
  esit('gövde sabit', istek.o.body, monitor.TICK_BODY);
  /* Uçta: QStash gövdesi string gelir, imzadaki özetle aynı baytlar. */
  const cronauth = require(path.join(API, '_lib', 'cronauth.js'));
  esit('ham gövde string aynen', cronauth.readRawBody({ body: monitor.TICK_BODY }), monitor.TICK_BODY);
  delete process.env.QSTASH_TOKEN;

  if (hatalar.length) {
    console.error('\nİzleme sınaması: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('İzleme sınaması: ' + gecti + ' / ' + gecti + ' geçti');
}

kos().catch(function (err) {
  console.error('sınama çöktü:', err && err.stack || err);
  process.exit(1);
});
