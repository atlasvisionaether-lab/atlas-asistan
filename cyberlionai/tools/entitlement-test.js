'use strict';

/**
 * Plan hakları ve Cloudflare erişim kapısı — uçları GERÇEKTEN çağıran sınama.
 *
 *   node tools/entitlement-test.js
 *
 * NE SINANIYOR
 *
 * 1. `_lib/entitlement.js` saf fonksiyonları (plan çözümü, politika, TSİ ayı).
 * 2. `/api/scan`: free 5 (ömür boyu), Pro aylık 50 ayrı anahtarda, Enterprise
 *    sayaçsız. Eskiden herkese 5 uygulanıyordu: Pro müşteri 6. taramada 402
 *    alıyordu.
 * 3. `/api/auth/me`: gösterilen kota, uygulanan kotayla aynı politika.
 * 4. `/api/autofix-cloudflare` ve `/api/cloudflare-zones`: oturumsuz 401,
 *    token'sız 400; CLOUDFLARE_TEST_TOKEN tanımlı olsa bile ona düşülmüyor;
 *    `?token=` kabul edilmiyor.
 * 5. Fiyat sayfası "Ayda N Tarama" = PRO_MONTHLY_SCAN_LIMIT.
 *
 * Ağ, veritabanı, depo yok: `_lib/*` modülleri require.cache saplamalarıyla
 * değiştiriliyor (tools/scanhandler-test.js ile aynı yöntem).
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');

let gecti = 0;
const hatalar = [];
function esit(ad, bulunan, beklenen) {
  const a = JSON.stringify(bulunan), b = JSON.stringify(beklenen);
  if (a === b) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + b + ', bulunan ' + a + ')');
}
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }

function sapla(rel, govde) {
  const tam = require.resolve(path.join(API, rel));
  const m = new Module(tam, null);
  m.filename = tam; m.loaded = true; m.exports = govde;
  require.cache[tam] = m;
}
function tazeYukle(rel) {
  const tam = require.resolve(path.join(API, rel));
  delete require.cache[tam];
  return require(tam);
}
function temizle() {
  Object.keys(require.cache).forEach(function (k) { if (k.indexOf(API) === 0) delete require.cache[k]; });
}
function sahteRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; },
    getHeader: function (k) { return res.headers[k.toLowerCase()]; },
    status: function (k) { res.statusCode = k; return res; },
    json: function (b) { res.body = b; return res; },
    end: function () { return res; }
  };
  return res;
}

const { FREE_SCAN_LIMIT, PRO_MONTHLY_SCAN_LIMIT } = require(path.join(API, '_lib/limits.js'));

(async function () {
  /* ================= 1. saf fonksiyonlar ================= */
  temizle();
  sapla('_lib/db.js', { isConfigured: function () { return false; } });
  const E = tazeYukle('_lib/entitlement.js');

  esit('abonelik yok → free', E.planFromSubscriptions([]), 'free');
  esit('etkin pro → pro', E.planFromSubscriptions([{ active: true, plan: 'pro' }]), 'pro');
  esit('etkin olmayan pro → free', E.planFromSubscriptions([{ active: false, plan: 'pro' }]), 'free');
  esit('pro + enterprise → enterprise', E.planFromSubscriptions([{ active: true, plan: 'pro' }, { active: true, plan: 'enterprise' }]), 'enterprise');
  esit('pasif enterprise + etkin pro → pro', E.planFromSubscriptions([{ active: false, plan: 'enterprise' }, { active: true, plan: 'pro' }]), 'pro');

  /* TSİ = UTC+3: 31 Ekim 21:30 UTC, Türkiye'de 1 Kasım 00:30. */
  esit('ay anahtarı Türkiye saatiyle', E.monthKey(Date.parse('2026-10-31T21:30:00Z')), '2026-11');
  esit('ay anahtarı ay ortası', E.monthKey(Date.parse('2026-10-15T12:00:00Z')), '2026-10');

  const owner = { userId: 'u-1' };
  const pf = E.policyFor('free', owner, 'cl:quota:u:u-1');
  esit('free sınırı', pf.limit, FREE_SCAN_LIMIT);
  esit('free mevcut anahtarı kullanıyor', pf.key, 'cl:quota:u:u-1');
  esit('free dönemi', pf.period, 'lifetime');
  const pp = E.policyFor('pro', owner, 'cl:quota:u:u-1', Date.parse('2026-10-15T12:00:00Z'));
  esit('pro sınırı', pp.limit, PRO_MONTHLY_SCAN_LIMIT);
  esit('pro aylık AYRI anahtar (free hakkı düşülmez)', pp.key, 'cl:quota:m:2026-10:u:u-1');
  esit('pro dönemi', pp.period, 'month');
  const pe = E.policyFor('enterprise', owner, 'x');
  esit('enterprise sınırsız', [pe.unlimited, pe.limit, pe.key], [true, null, null]);

  esit('quotaView free', E.quotaView(pf, 3, 'account'),
    { used: 3, limit: 5, remaining: 2, scope: 'account', plan: 'free', period: 'lifetime', unlimited: false });
  esit('quotaView sınırsız', E.quotaView(pe, null, 'account'),
    { used: null, limit: null, remaining: null, scope: 'account', plan: 'enterprise', period: null, unlimited: true });
  esit('anonim → free (db sorulmadan)', await E.planFor({ sessionId: 's' }), 'free');

  temizle();
  sapla('_lib/db.js', { isConfigured: function () { return true; }, listSubscriptions: async function () { throw new Error('db_error_500'); } });
  const E2 = tazeYukle('_lib/entitlement.js');
  esit('abonelik okunamazsa free (sınırsız açılmaz)', await E2.planFor({ userId: 'u' }), 'free');

  /* ================= 2. /api/scan plana göre ================= */
  async function taramaUcu(plan, kotaDolu) {
    temizle();
    const kayit = { reserve: [], refund: 0 };
    sapla('_lib/scanner.js', {
      scanSite: async function () { return { host: 'ornek.com', url: 'https://ornek.com/', score: 90, summary: {}, checks: [], warnings: [], owaspFindings: [], owaspFailedCategories: {} }; },
      SCANNER_VERSION: 't', REPORT_VERSION: 't'
    });
    sapla('_lib/db.js', {
      isConfigured: function () { return true; },
      listSubscriptions: async function () { return plan === 'free' ? [] : [{ active: true, plan: plan }]; },
      saveScan: async function () { return 'k'; }, saveOwaspJob: async function () { return 'j'; }
    });
    sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      quotaKey: function (o) { return 'cl:quota:u:' + o.userId; },
      hitRateLimit: async function () { return { count: 1, ttl: 60 }; },
      reserveQuota: async function (key, limit) {
        kayit.reserve.push([key.replace(/m:\d{4}-\d{2}/, 'm:AY'), limit]);
        return kotaDolu ? { ok: false, used: limit } : { ok: true, used: 6 };
      },
      refundQuota: async function () { kayit.refund += 1; }
    });
    sapla('_lib/session.js', {
      resolveOwner: async function () { return { userId: 'u-9', sessionId: 's', isAuthenticated: true }; },
      ownerRef: function (o) { return o; }, clientIp: function () { return '203.0.113.9'; }, ipKey: function (ip) { return ip; }
    });
    sapla('_lib/scanqueue.js', { isEnabled: function () { return false; } });
    /* telegram.js gerçek modül: env yokken sessizce hiçbir şey göndermiyor. */
    const handler = tazeYukle('scan.js');
    const res = sahteRes();
    await (handler.default || handler)({ method: 'POST', headers: {}, body: { url: 'https://ornek.com' } }, res);
    return { res: res, kayit: kayit };
  }

  let r = await taramaUcu('pro', false);
  esit('Pro: 6. tarama geçiyor (eskiden 402)', r.res.statusCode, 200);
  esit('Pro: aylık anahtar + 50 sınırı', r.kayit.reserve, [['cl:quota:m:AY:u:u-9', PRO_MONTHLY_SCAN_LIMIT]]);
  esit('Pro: kota yanıtı', r.res.body && r.res.body.quota && [r.res.body.quota.plan, r.res.body.quota.limit, r.res.body.quota.remaining, r.res.body.quota.period],
    ['pro', 50, 44, 'month']);

  r = await taramaUcu('pro', true);
  esit('Pro: 51. tarama 402', r.res.statusCode, 402);
  esit('Pro: 402 gövdesi planı bildiriyor', r.res.body && [r.res.body.error.code, r.res.body.error.plan, r.res.body.error.limit], ['quota_exceeded', 'pro', 50]);

  r = await taramaUcu('enterprise', true);
  esit('Enterprise: sayaç dolu görünse de geçiyor', r.res.statusCode, 200);
  esit('Enterprise: kota sayacına hiç dokunulmuyor', r.kayit.reserve.length, 0);
  esit('Enterprise: yanıt sınırsız', r.res.body && r.res.body.quota && r.res.body.quota.unlimited, true);

  r = await taramaUcu('free', true);
  esit('Free: 6. tarama 402', r.res.statusCode, 402);
  esit('Free: ömür boyu anahtar + 5', r.kayit.reserve, [['cl:quota:u:u-9', FREE_SCAN_LIMIT]]);

  /* ================= 3. /api/auth/me ================= */
  async function meUcu(plan, used) {
    temizle();
    sapla('_lib/auth.js', { isConfigured: function () { return true; }, resolveUser: async function () { return { id: 'u-7', email: 'a@b.co' }; } });
    sapla('_lib/db.js', { isConfigured: function () { return true; }, listSubscriptions: async function () { return plan === 'free' ? [] : [{ active: true, plan: plan }]; } });
    const okunan = [];
    sapla('_lib/store.js', {
      isConfigured: function () { return true; },
      quotaKey: function (o) { return 'cl:quota:u:' + o.userId; },
      readQuota: async function (k) { okunan.push(k.replace(/m:\d{4}-\d{2}/, 'm:AY')); return used; }
    });
    sapla('_lib/session.js', { resolveSession: function () { return { id: 's', isNew: false }; } });
    const handler = tazeYukle('auth/me.js');
    const res = sahteRes();
    await handler({ method: 'GET', headers: {} }, res);
    return { q: res.body && res.body.quota, okunan: okunan };
  }
  let m = await meUcu('pro', 12);
  esit('me Pro: 38/50 bu ay', [m.q.remaining, m.q.limit, m.q.period], [38, 50, 'month']);
  esit('me Pro: tarama ucuyla AYNI anahtar', m.okunan, ['cl:quota:m:AY:u:u-7']);
  m = await meUcu('enterprise', 999);
  esit('me Enterprise: sınırsız, sayaç okunmuyor', [m.q.unlimited, m.okunan.length], [true, 0]);
  m = await meUcu('free', 3);
  esit('me Free: 2/5', [m.q.remaining, m.q.limit, m.q.period], [2, 5, 'lifetime']);

  /* ================= 4. Cloudflare erişim kapısı ================= */
  async function cfUcu(rel, girisli, req, envToken) {
    temizle();
    const cfCagri = [];
    if (envToken) process.env.CLOUDFLARE_TEST_TOKEN = envToken; else delete process.env.CLOUDFLARE_TEST_TOKEN;
    sapla('_lib/auth.js', { isConfigured: function () { return true; }, resolveUser: async function () { return girisli ? { id: 'u-3' } : null; } });
    sapla('_lib/store.js', { isConfigured: function () { return true; }, hitRateLimit: async function () { return { count: 1, ttl: 60 }; } });
    sapla('_lib/db.js', { isConfigured: function () { return false; } });
    sapla('_lib/cloudflare.js', {
      cf: async function (p, method, token) { cfCagri.push(token); return { ok: true, data: { result: [] } }; },
      findZoneId: async function (d, token) { cfCagri.push(token); return { ok: true, zoneId: 'z' }; },
      applyTransformRule: async function (z, token) { cfCagri.push(token); return { ok: true, rulesetId: 'rs', ruleId: 'r' }; },
      maskToken: function () { return '***'; }
    });
    const handler = tazeYukle(rel);
    const res = sahteRes();
    await handler(Object.assign({ headers: {}, query: {} }, req), res);
    delete process.env.CLOUDFLARE_TEST_TOKEN;
    return { res: res, cfCagri: cfCagri };
  }
  const MUSTERI = 'musteri-token-0123456789abcdef';
  const SUNUCU = 'sunucu-token-0123456789abcdef';
  const POST = { method: 'POST', body: { domain: 'ornek.com', fixType: 'hsts', token: MUSTERI } };

  let c = await cfUcu('autofix-cloudflare.js', false, POST, SUNUCU);
  esit('autofix: oturumsuz 401', c.res.statusCode, 401);
  esit('autofix: oturumsuz Cloudflare çağrılmıyor', c.cfCagri.length, 0);
  c = await cfUcu('autofix-cloudflare.js', true, { method: 'POST', body: { domain: 'ornek.com', fixType: 'hsts' } }, SUNUCU);
  esit('autofix: token yok → 400 (env token\'a düşmüyor)', [c.res.statusCode, ((c.res.body && c.res.body.error) || {}).code], [400, 'token_required']);
  esit('autofix: sunucu token\'ı hiç kullanılmadı', c.cfCagri.indexOf(SUNUCU), -1);
  c = await cfUcu('autofix-cloudflare.js', true, POST, SUNUCU);
  esit('autofix: girişli + müşteri token\'ı → 200', c.res.statusCode, 200);
  dogru('autofix: yalnızca müşteri token\'ı kullanıldı', c.cfCagri.length > 0 && c.cfCagri.every(function (t) { return t === MUSTERI; }));
  c = await cfUcu('autofix-cloudflare.js', false, { method: 'DELETE', body: { zoneId: 'z', rulesetId: 'rs', ruleId: 'r' } }, SUNUCU);
  esit('autofix DELETE: oturumsuz 401', c.res.statusCode, 401);
  c = await cfUcu('autofix-cloudflare.js', true, { method: 'DELETE', body: { zoneId: 'z', rulesetId: 'rs', ruleId: 'r' } }, SUNUCU);
  esit('autofix DELETE: token yok → 400', c.res.statusCode, 400);

  c = await cfUcu('cloudflare-zones.js', false, { method: 'GET', query: { token: MUSTERI } }, null);
  esit('zones: oturumsuz 401', c.res.statusCode, 401);
  c = await cfUcu('cloudflare-zones.js', true, { method: 'GET', query: { token: MUSTERI } }, SUNUCU);
  esit('zones: ?token= kabul edilmiyor', c.res.statusCode, 400);
  esit('zones: sunucu token\'ına düşmüyor', c.cfCagri.length, 0);
  c = await cfUcu('cloudflare-zones.js', true, { method: 'GET', headers: { authorization: 'Bearer ' + MUSTERI } }, null);
  esit('zones: Bearer başlığıyla 200', c.res.statusCode, 200);

  /* ================= 5. fiyat sayfası taahhüdü ================= */
  const pricing = fs.readFileSync(path.join(ROOT, 'pricing.html'), 'utf8');
  dogru('pricing "Ayda ' + PRO_MONTHLY_SCAN_LIMIT + ' Tarama" = PRO_MONTHLY_SCAN_LIMIT',
    pricing.indexOf('Ayda ' + PRO_MONTHLY_SCAN_LIMIT + ' Tarama') !== -1);
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  dogru('ana sayfa Pro için "Sınırsız tarama" vaat etmiyor', !/Sınırsız tarama, detaylı PDF/.test(index) && !/for unlimited scans, detailed PDF/.test(index));

  if (hatalar.length) {
    console.error('\nentitlement: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('entitlement sınaması: ' + gecti + ' / ' + gecti + ' geçti');
})().catch(function (err) { console.error(err); process.exit(1); });
