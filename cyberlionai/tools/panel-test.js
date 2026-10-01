'use strict';
/**
 * Panel sorgularını sınar: SAHİPLİK ve gruplama. Ağdan bağımsız.
 *
 *   node tools/panel-test.js
 *
 * NEDEN
 *
 * Panel bir müşterinin kendi taramalarını gösteriyor. Buradaki hatanın
 * bedeli yanlış bir sayı değil, BAŞKA BİR MÜŞTERİNİN verisi. Sınananlar:
 *
 *   1. Her sorgu `user_id=eq.<kullanıcı>` taşıyor. Sahiplik filtresi
 *      sorgunun İÇİNDE olmalı; listeyi çekip JS'te süzmek, bir hata
 *      durumunda başkasının satırını ekrana düşürür.
 *   2. Bulgular İŞ SAHİPLİK KONTROLÜNDEN SONRA okunuyor: başkasının iş
 *      kimliğini bilen biri o işin bulgularını alamamalı.
 *   3. Cloudflare düzeltme denetim satırları "taramalarım" listesinde
 *      görünmüyor (bir düzeltme tarama değil).
 *   4. Bulgular OWASP kategorisine göre gruplanıyor, kategorisi olmayan
 *      bulgu DÜŞMÜYOR ('other' grubunda duruyor) ve her grup içinde önem
 *      derecesine göre sıralanıyor.
 *   5. Abonelik tablosu yoksa haftalık tarama hedef listesi UYDURULMUYOR.
 */

process.env.SUPABASE_URL = 'https://ornek.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sahte-servis-rolu-anahtari';

const db = require('../api/_lib/db.js');

const USER = '99999999-8888-7777-6666-555555555555';
const OTHER_JOB = '11111111-1111-1111-1111-111111111111';
/* Gerçek UUID: getJob biçimi doğruluyor ve 'job1' gibi bir dizgiyi
   sorguya hiç göndermiyor. */
const MY_JOB = '22222222-3333-4444-5555-666666666666';

let sorgular = [];

/** Her yolu ayrı bir cevaba eşleyen sahte fetch. */
function sahneKur(router) {
  global.fetch = function (url) {
    const u = String(url);
    sorgular.push(u);
    const body = router(u);
    if (body === undefined) {
      return Promise.resolve({
        ok: false, status: 404,
        json: function () { return Promise.resolve(null); },
        text: function () { return Promise.resolve('relation does not exist'); }
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: function () { return Promise.resolve(body); },
      text: function () { return Promise.resolve(''); }
    });
  };
}

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen)
              + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

(async function () {
  console.log('Panel sorguları (sahiplik ve gruplama)');

  /* ---- 1 & 3. Liste ---- */
  sorgular = [];
  sahneKur(function (u) {
    if (u.indexOf('scan_jobs') !== -1) {
      return [
        { id: 'a', domain: 'bir.com', url: 'https://bir.com', status: 'completed', score: 90, scanner_mode: 'passive', country: 'TR', created_at: '2026-10-01T10:00:00Z', completed_at: '2026-10-01T10:00:09Z' },
        { id: 'b', domain: 'bir.com', url: 'cloudflare-transform://bir.com/hsts', status: 'completed', score: null, scanner_mode: 'passive', country: null, created_at: '2026-10-01T09:00:00Z', completed_at: null },
        { id: 'c', domain: 'iki.com', url: 'https://iki.com', status: 'failed', score: null, scanner_mode: 'passive', country: null, created_at: '2026-09-30T10:00:00Z', completed_at: null }
      ];
    }
    return [];
  });

  const liste = await db.listJobs(USER, { limit: 10 });
  sina('düzeltme denetim satırı listede yok', liste.items.map(function (i) { return i.id; }), ['a', 'c']);
  sina('sahiplik filtresi sorgunun içinde',
    sorgular[0].indexOf('user_id=eq.' + USER) !== -1, true);
  sina('alan adları ve durumlar taşınıyor',
    liste.items.map(function (i) { return i.domain + ':' + i.status; }), ['bir.com:completed', 'iki.com:failed']);

  /* ---- Süzgeç sorguya giriyor ---- */
  sorgular = [];
  await db.listJobs(USER, { limit: 5, status: 'completed' });
  sina('durum süzgeci sorguya ekleniyor', sorgular[0].indexOf('status=eq.completed') !== -1, true);

  /* Süzgeç olarak uydurma değer sorguya GEÇMEMELİ. */
  sorgular = [];
  await db.listJobs(USER, { limit: 5, status: 'completed;drop table' });
  sina('biçimsiz süzgeç sorguya geçmiyor', /status=eq/.test(sorgular[0]), false);

  /* ---- 2. Başkasının işi ---- */
  sorgular = [];
  sahneKur(function (u) {
    /* İş sorgusu sahiplik filtresiyle geliyor ve BOŞ dönüyor: iş bu
       kullanıcıya ait değil. */
    if (u.indexOf('scan_jobs') !== -1) return [];
    if (u.indexOf('scan_findings') !== -1) {
      return [{ id: 'f1', owasp_category: 'A01', severity: 'critical', title: 'sızmamalı', description: null, evidence: null, fix_code: null, created_at: '2026-10-01T10:00:00Z' }];
    }
    return [];
  });

  const yabanci = await db.getJobWithFindings(USER, OTHER_JOB);
  sina('başkasının işi null dönüyor', yabanci, null);
  sina('bulgu sorgusu HİÇ yapılmıyor',
    sorgular.some(function (u) { return u.indexOf('scan_findings') !== -1; }), false);

  /* ---- 4. Gruplama ---- */
  sorgular = [];
  sahneKur(function (u) {
    if (u.indexOf('scan_jobs') !== -1) {
      return [{ id: MY_JOB, domain: 'bir.com', url: 'https://bir.com', status: 'completed', score: 72, scanner_mode: 'passive', country: 'TR', created_at: '2026-10-01T10:00:00Z', completed_at: '2026-10-01T10:00:09Z', result: {} }];
    }
    if (u.indexOf('scan_findings') !== -1) {
      return [
        { id: '1', owasp_category: 'A05', severity: 'low', title: 'düşük', description: null, evidence: null, fix_code: null, created_at: '1' },
        { id: '2', owasp_category: 'A05', severity: 'critical', title: 'kritik', description: null, evidence: null, fix_code: null, created_at: '2' },
        { id: '3', owasp_category: 'A01', severity: 'medium', title: 'orta', description: null, evidence: null, fix_code: null, created_at: '3' },
        { id: '4', owasp_category: null, severity: 'info', title: 'kategorisiz', description: null, evidence: null, fix_code: null, created_at: '4' },
        { id: '5', owasp_category: 'A99', severity: 'high', title: 'geçersiz kategori', description: null, evidence: null, fix_code: null, created_at: '5' }
      ];
    }
    return [];
  });

  const detay = await db.getJobWithFindings(USER, MY_JOB);
  sina('gruplar OWASP sırasında, other sonda',
    detay.groups.map(function (g) { return g.category; }), ['A01', 'A05', 'other']);
  sina('grup içinde önem sırası',
    detay.groups[1].findings.map(function (f) { return f.severity; }), ['critical', 'low']);
  /* Kategorisi olmayan (4) ve geçersiz kategori taşıyan (5) bulgu 'other'
     grubunda, önem sırasıyla: high önce, info sonra. */
  sina('kategorisiz ve geçersiz kategorili bulgu düşmüyor',
    detay.groups[2].findings.map(function (f) { return f.id; }), ['5', '4']);
  sina('bulgu sayısı tam', detay.totalFindings, 5);
  sina('önem sayaçları', detay.severityCounts,
    { critical: 1, high: 1, medium: 1, low: 1, info: 1 });
  sina('bulgu sorgusu işin kimliğiyle yapılıyor',
    sorgular.some(function (u) { return u.indexOf('job_id=eq.' + MY_JOB) !== -1; }), true);

  /* ---- 5. Abonelik tablosu yok ---- */
  sahneKur(function (u) {
    if (u.indexOf('cl_subscriptions') !== -1) return undefined; // 404
    return [];
  });
  const hedefler = await db.enterpriseScanTargets(5);
  sina('tablo yoksa hedef uydurulmuyor', hedefler, { available: false, reason: 'no_subscriptions_table', targets: [] });

  /* Tablo varsa biçimsiz satır süzülüyor. */
  sahneKur(function (u) {
    if (u.indexOf('cl_subscriptions') !== -1) {
      return [
        { user_id: USER, domain: 'gecerli.com' },
        { user_id: 'kullanici-degil', domain: 'gecerli2.com' },
        { user_id: USER, domain: 'alan adi degil' }
      ];
    }
    return [];
  });
  const temiz = await db.enterpriseScanTargets(5);
  sina('yalnızca geçerli hedefler', temiz.targets, [{ userId: USER, domain: 'gecerli.com' }]);

  console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
  process.exit(hata === 0 ? 0 : 1);
})();
