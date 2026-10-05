'use strict';

/**
 * Alan adı sahipliği + tarama seviyeleri sınaması.
 *
 * Sabitlenen kararlar:
 *   - Onay kutusu tek başına aktif testi AÇMAZ; beyan + doğrulanmış sahiplik.
 *   - Açıkça aktif seviye istenip doğrulama yoksa 403 ownership_required.
 *   - Doğrulanmamış alan adına aynı IP'den günde en çok 3 tarama.
 *   - DNS doğrulaması alt alan adlarını kapsar; dosya/meta kapsamaz.
 *   - 3 başarısız denemeden sonra 1 saat bekleme.
 *   - Doğrulama isteği başka siteye yönlendirmeyi izlemez (SSRF).
 *   - Okuma hatası "doğrulanmış" sonucuna düşmez.
 *   - Autofix: doğrulanmamış alan adı 403; zoneId başka zone'u gösteriyorsa 403.
 *
 * Ağ ve veritabanı yok: db.request bellek içi bir PostgREST taklidine bağlı.
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

/* ---------- bellek içi PostgREST ---------- */
const tablolar = { verified_domains: [], scan_logs: [], abuse_reports: [], scan_jobs: [] };
let dbBozuk = false;
let sira = 1;
function eslesir(row, filtreler) {
  return filtreler.every(function (f) {
    const v = row[f.k];
    if (f.op === 'eq') return String(v) === f.v;
    if (f.op === 'in') return f.v.indexOf(String(v)) !== -1;
    if (f.op === 'lt') return String(v) < f.v;
    if (f.op === 'gte') return String(v) >= f.v;
    if (f.op === 'not') return v !== null && v !== undefined;
    return true;
  });
}
function ayristir(yol) {
  const [tablo, q] = yol.split('?');
  const filtreler = [];
  (q || '').split('&').forEach(function (p) {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i), raw = decodeURIComponent(p.slice(i + 1));
    if (['select', 'order', 'limit', 'offset'].indexOf(k) !== -1) return;
    const nokta = raw.indexOf('.');
    const op = raw.slice(0, nokta), v = raw.slice(nokta + 1);
    if (op === 'in') filtreler.push({ k: k, op: 'in', v: v.replace(/^\(|\)$/g, '').split(',').map(decodeURIComponent) });
    else filtreler.push({ k: k, op: op, v: v });
  });
  return { tablo: tablo, filtreler: filtreler };
}
const sahteDb = {
  isConfigured: function () { return true; },
  request: async function (yol, secenek) {
    if (dbBozuk) throw new Error('db_unreachable');
    const s = secenek || {};
    const a = ayristir(yol);
    const t = tablolar[a.tablo];
    if (!t) throw new Error('db_error_404');
    const yontem = s.method || 'GET';
    if (yontem === 'POST') {
      const row = Object.assign({ id: String(sira++), created_at: new Date().toISOString() }, s.body);
      if (a.tablo === 'verified_domains') {
        if (t.some(function (r) { return r.user_id === row.user_id && r.domain === row.domain; })) throw new Error('db_error_409');
        row.failed_attempts = 0; row.status = row.status || 'pending';
      }
      t.push(row);
      return [row];
    }
    const hedef = t.filter(function (r) { return eslesir(r, a.filtreler); });
    if (yontem === 'PATCH') { hedef.forEach(function (r) { Object.assign(r, s.body); }); return null; }
    if (yontem === 'DELETE') { tablolar[a.tablo] = t.filter(function (r) { return hedef.indexOf(r) === -1; }); return null; }
    return hedef.map(function (r) { return Object.assign({}, r); });
  }
};
sapla('_lib/db.js', sahteDb);

const hiz = {};
sapla('_lib/store.js', {
  isConfigured: function () { return true; },
  hitRateLimit: async function (k) { hiz[k] = (hiz[k] || 0) + 1; return { count: hiz[k], ttl: 100 }; },
  setOnce: async function () { return true; }
});
sapla('_lib/session.js', {
  clientIp: function () { return '198.51.100.7'; },
  ipKey: function (ip) { return ip; },
  resolveOwner: async function () { return { userId: 'u1', isAuthenticated: true }; }
});
/* Alan adları "genel" sayılır; özel ağ denemesi için ayrı ad. */
sapla('_lib/guard.js', Object.assign({}, require(path.join(API, '_lib', 'guard.js')), {
  assertPublicHost: async function (host) {
    if (host === 'ic-ag.ornek.com') throw new Error('blocked_target');
    return ['203.0.113.10'];
  }
}));

const ownership = require(path.join(API, '_lib', 'ownership.js'));
const levels = require(path.join(API, '_lib', 'scan-levels.js'));
const gateMod = require(path.join(API, '_lib', 'scan-gate.js'));

function yanit(status, body, headers) {
  return {
    status: status, ok: status >= 200 && status < 300,
    headers: { get: function (k) { return (headers || {})[k.toLowerCase()] || null; } },
    text: async function () { return body; }
  };
}
function reqSahte(extra) {
  return Object.assign({ method: 'POST', headers: { 'user-agent': 'Sınama/1.0' }, query: {} }, extra || {});
}

async function kos() {
  /* ---------- seviyeler ---------- */
  esit('pasif varsayılan', levels.parseLevel(undefined), levels.PASSIVE);
  esit('intrusive', levels.parseLevel('intrusive'), levels.INTRUSIVE);
  esit('onay tek başına aktif açmaz', levels.activeAllowed(true, false), false);
  esit('doğrulama tek başına aktif açmaz', levels.activeAllowed(false, true), false);
  esit('onay + doğrulama aktif açar', levels.activeAllowed(true, true), true);
  esit('403 kodu', levels.ownershipRequired('ornek.com').error.code, 'ownership_required');
  dogru('403 TCK atfı', /TCK m\.243\/244/.test(levels.ownershipRequired('ornek.com').error.message));

  /* ---------- yardımcılar ---------- */
  esit('alan adı sadeleşir', ownership.normalizeDomain('HTTPS://Www.Ornek.com:443/yol?a=1'), 'www.ornek.com');
  esit('geçersiz alan adı', ownership.normalizeDomain('localhost'), null);
  dogru('belirteç biçimi', ownership.TOKEN_RE.test(ownership.newToken()));
  dogru('belirteçler farklı', ownership.newToken() !== ownership.newToken());
  esit('meta: öznitelik sırası serbest', ownership.metaToken('<head><meta content="abc" name="cyberlion-verify"></head>'), 'abc');
  esit('meta: tek tırnak', ownership.metaToken("<meta name='cyberlion-verify' content='xyz'>"), 'xyz');
  esit('meta: yoksa null', ownership.metaToken('<meta name="description" content="x">'), null);
  esit('üst alanlar', ownership.selfAndParents('a.b.ornek.com').join(), 'a.b.ornek.com,b.ornek.com,ornek.com');

  /* ---------- doğrulama akışı: DNS ---------- */
  const row = await ownership.initVerification('u1', 'ornek.com');
  esit('init pending', row.status, 'pending');
  const row2 = await ownership.initVerification('u1', 'ornek.com');
  esit('ikinci init aynı belirteç', row2.token, row.token);
  esit('başlamadan doğrulanmamış', await ownership.isVerified('u1', 'ornek.com'), false);

  let r = await ownership.checkVerification('u1', 'ornek.com', 'dns', {
    resolveTxt: async function (ad) {
      esit('DNS sorgu adı', ad, '_cyberlion-verify.ornek.com');
      return [['başka-kayıt'], [row.token.slice(0, 20), row.token.slice(20)]];
    }
  });
  esit('DNS TXT (parçalı kayıt) doğrular', r.ok, true);
  esit('doğrulandı', await ownership.isVerified('u1', 'ornek.com'), true);
  esit('DNS alt alanı kapsar', await ownership.isVerified('u1', 'api.ornek.com'), true);
  esit('başka hesap kapsanmaz', await ownership.isVerified('u2', 'ornek.com'), false);
  esit('benzer ad kapsanmaz', await ownership.isVerified('u1', 'kotuornek.com'), false);

  /* ---------- dosya yöntemi: yalnız o ana bilgisayar ---------- */
  const fRow = await ownership.initVerification('u1', 'dosya.com');
  r = await ownership.checkVerification('u1', 'dosya.com', 'file', {
    fetch: async function (url, o) {
      esit('dosya adresi', url, 'https://dosya.com/.well-known/cyberlion-verify.txt');
      esit('yönlendirme elle', o.redirect, 'manual');
      return yanit(200, fRow.token + '\n');
    }
  });
  esit('dosya doğrular', r.ok, true);
  esit('dosya alt alanı KAPSAMAZ', await ownership.isVerified('u1', 'www.dosya.com'), false);

  /* ---------- meta yöntemi + www yönlendirmesi ---------- */
  const mRow = await ownership.initVerification('u1', 'meta.com');
  r = await ownership.checkVerification('u1', 'meta.com', 'meta', {
    fetch: async function (url) {
      if (url === 'https://meta.com/') return yanit(301, '', { location: 'https://www.meta.com/' });
      return yanit(200, '<html><head><meta name="cyberlion-verify" content="' + mRow.token + '"></head></html>');
    }
  });
  esit('meta + www yönlendirmesi doğrular', r.ok, true);

  /* ---------- SSRF: başka siteye yönlendirme izlenmez ---------- */
  const sRow = await ownership.initVerification('u1', 'yonlen.com');
  let ikinciIstek = false;
  r = await ownership.checkVerification('u1', 'yonlen.com', 'file', {
    fetch: async function (url) {
      if (url.indexOf('yonlen.com') !== -1) return yanit(302, '', { location: 'https://saldirgan.example/' + sRow.token });
      ikinciIstek = true;
      return yanit(200, sRow.token);
    }
  });
  esit('başka siteye yönlendirmede doğrulanmaz', r.ok, false);
  esit('başka siteye istek atılmadı', ikinciIstek, false);
  esit('http yönlendirmesi izlenmez', await ownership.safeGet('https://x.com/', async function () {
    return yanit(301, '', { location: 'http://x.com/' });
  }), null);
  esit('özel ağ adresine istek yok', await ownership.safeGet('https://ic-ag.ornek.com/', async function () {
    throw new Error('çağrılmamalıydı');
  }), null);

  /* ---------- 3 başarısız → bekleme ---------- */
  await ownership.initVerification('u1', 'bekle.com');
  const yok = { resolveTxt: async function () { return [['yanlis']]; } };
  r = await ownership.checkVerification('u1', 'bekle.com', 'dns', yok);
  esit('1. başarısız', r.code, 'not_found');
  esit('kalan deneme', r.attemptsLeft, 2);
  await ownership.checkVerification('u1', 'bekle.com', 'dns', yok);
  r = await ownership.checkVerification('u1', 'bekle.com', 'dns', yok);
  esit('3. başarısız → bekleme', r.code, 'cooldown');
  r = await ownership.checkVerification('u1', 'bekle.com', 'dns', {
    resolveTxt: async function () { throw new Error('çağrılmamalıydı'); }
  });
  esit('beklemede kanıt okunmaz', r.code, 'cooldown');
  dogru('bekleme ~1 saat', r.retryAfter > 3500 && r.retryAfter <= 3600);
  const sonra = Date.now() + 61 * 60 * 1000;
  const bRow = tablolar.verified_domains.find(function (x) { return x.domain === 'bekle.com'; });
  r = await ownership.checkVerification('u1', 'bekle.com', 'dns', {
    now: function () { return sonra; },
    resolveTxt: async function () { return [[bRow.token]]; }
  });
  esit('bekleme sonrası doğrular', r.ok, true);
  esit('geçersiz yöntem', (await ownership.checkVerification('u1', 'ornek.com', 'eposta')).code, 'invalid_method');
  esit('başlatılmamış', (await ownership.checkVerification('u1', 'hic.com', 'dns')).code, 'not_started');

  /* ---------- kapalı devre ---------- */
  dbBozuk = true;
  esit('DB düşerse doğrulanmamış', await ownership.isVerified('u1', 'ornek.com'), false);
  esit('DB düşerse günlük fırlatmaz', await ownership.logScan({ domain: 'ornek.com', level: 'passive' }), false);
  dbBozuk = false;

  /* ---------- tarama kapısı ---------- */
  const yetkili = { userId: 'u1', isAuthenticated: true };
  const anonim = { userId: null, sessionId: 's', isAuthenticated: false };
  let g = await gateMod.checkScan(reqSahte(), { url: 'https://ornek.com', owner: yetkili, consent: true });
  esit('doğrulanmış + onay → aktif', g.activeConsent, true);
  g = await gateMod.checkScan(reqSahte(), { url: 'https://ornek.com', owner: yetkili, consent: false });
  esit('doğrulanmış ama onaysız → pasif', g.activeConsent, false);
  g = await gateMod.checkScan(reqSahte(), { url: 'baskasi.com', owner: anonim, consent: true });
  esit('anonim + onay → pasif (reddedilmez)', g.ok && g.activeConsent === false, true);
  esit('anonim → doğrulama adresi', g.ownership.verifyUrl, '/verify?domain=baskasi.com');
  g = await gateMod.checkScan(reqSahte(), { url: 'baskasi.com', owner: yetkili, consent: true, level: 'intrusive' });
  esit('intrusive + doğrulanmamış → 403', g.status, 403);
  esit('403 gövdesi', g.body.error.code, 'ownership_required');
  g = await gateMod.checkScan(reqSahte(), { url: 'ornek.com', owner: yetkili, consent: true, level: 'intrusive' });
  esit('intrusive + doğrulanmış → izin', g.ok, true);

  const log = tablolar.scan_logs;
  const son = log[log.length - 1];
  esit('günlük: seviye', son.level, 'intrusive');
  esit('günlük: doğrulandı', son.verified, true);
  esit('günlük: IP', son.ip, '198.51.100.7');
  esit('günlük: user-agent', son.user_agent, 'Sınama/1.0');
  dogru('günlük: pasif tarama da yazılıyor', log.some(function (x) { return x.domain === 'baskasi.com' && x.level === 'passive'; }));

  /* Doğrulanmamış alan adına günde 3: baskasi.com yukarıda 2 kez geçti (403 sayılmaz). */
  for (let i = 0; i < 3; i++) hiz['cl:rl:unv:198.51.100.7:gunluk.com'] = hiz['cl:rl:unv:198.51.100.7:gunluk.com'] || 0;
  const g1 = await gateMod.checkScan(reqSahte(), { url: 'gunluk.com', owner: anonim });
  const g2 = await gateMod.checkScan(reqSahte(), { url: 'gunluk.com', owner: anonim });
  const g3 = await gateMod.checkScan(reqSahte(), { url: 'gunluk.com', owner: anonim });
  const g4 = await gateMod.checkScan(reqSahte(), { url: 'gunluk.com', owner: anonim });
  esit('1-3. tarama geçer', g1.ok && g2.ok && g3.ok, true);
  esit('4. tarama 429', g4.status, 429);
  esit('429 kodu', g4.body.error.code, 'verify_to_continue');
  for (let i = 0; i < 5; i++) {
    const gv = await gateMod.checkScan(reqSahte(), { url: 'ornek.com', owner: yetkili });
    if (!gv.ok) { hatalar.push('doğrulanmış alan adına günlük sınır uygulandı'); break; }
  }
  gecti += 1;

  /* ---------- autofix: zone eşleşmesi ---------- */
  const autofix = require(path.join(API, 'autofix-cloudflare.js'));
  esit('zone: kendisi', autofix.inZone('ornek.com', 'ornek.com'), true);
  esit('zone: alt alan', autofix.inZone('www.ornek.com', 'ornek.com'), true);
  esit('zone: benzer ad değil', autofix.inZone('kotuornek.com', 'ornek.com'), false);

  /* ---------- 12 ay saklama ---------- */
  tablolar.scan_logs.push({ id: 'eski', domain: 'ornek.com', created_at: '2020-01-01T00:00:00.000Z' });
  const kesim = await ownership.purgeOldLogs();
  dogru('kesim ~365 gün önce', Date.now() - Date.parse(kesim) > 364 * 86400 * 1000);
  esit('eski günlük silindi', tablolar.scan_logs.some(function (x) { return x.id === 'eski'; }), false);
  dogru('yeni günlük kaldı', tablolar.scan_logs.length > 0);

  if (hatalar.length) {
    console.error('\nSahiplik sınaması: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('Sahiplik sınaması: ' + gecti + ' / ' + gecti + ' geçti');
}

kos().catch(function (err) {
  console.error('sınama çöktü:', err && err.stack || err);
  process.exit(1);
});
