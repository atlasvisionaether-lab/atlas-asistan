'use strict';

/**
 * Mobil istemci ile `/api/device-token` ucunun AYNI ŞEYİ konuştuğunun
 * sınaması.
 *
 * NEDEN BU DOSYA VAR
 *
 * Depoda mobil uygulama yok, bu kapta Android/iOS SDK'sı da yok; Dart kodu
 * derlenemiyor. O yüzden "istemci çalışıyor" diye bir iddia yok. Ama sessizce
 * bozulabilecek ve DERLEMEYE BAĞLI OLMAYAN bir iddia var: istemcinin kurduğu
 * istek ile sunucunun beklediği istek aynı mı? Bu dosya onu sınıyor —
 * adres, başlıklar ve gövde alanları DART KAYNAĞINDAN okunup GERÇEK handler'a
 * geçiriliyor.
 *
 * Ayrıca bu PR bir yetki yüzeyine dokunuyor: `/api/device-token` artık
 * `Authorization: Bearer <supabase access_token>` kabul ediyor. Bu yüzden
 * `_lib/auth.js` SAPLANMIYOR — gerçek modül, sahte bir GoTrue'ya karşı
 * koşuyor. (Ders: bir modülü saplayan uç sınaması, o modülün İÇİNDEKİ
 * güvenceyi doğrulamaz; bkz. tools/notify-test.js bölüm 5.)
 *
 * Kilitlenen kararlar:
 *   1. Bearer YALNIZCA bu uçta kabul edilir. Bayrak verilmeyen bir çağrıda
 *      başlık GÖRMEZDEN GELİNİR — diğer uçların yetki yüzeyi değişmedi.
 *   2. Bearer bir ATLATMA DEĞİL: belirteç GoTrue'ya sorulur; sahte belirteç
 *      401 alır.
 *   3. Çerez varsa çerez kazanır; bearer tarayıcı oturumunu ezemez.
 *   4. Sahip OTURUMDAN gelir; gövdedeki bir userId dikkate alınmaz.
 *   5. Jeton ne yanıtta döner ne de loglanır — ne sunucuda ne Dart'ta.
 *   6. Bearer yolunda yenileme çerezi okunmaz ve Set-Cookie yazılmaz.
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const KOK = path.join(__dirname, '..');
const API = path.join(KOK, 'api');
const DEVTOK = require.resolve(path.join(API, 'device-token.js'));
const AUTH = require.resolve(path.join(API, '_lib', 'auth.js'));
const DART = path.join(KOK, 'mobile', 'flutter', 'lib', 'services', 'push_token_service.dart');

const SUPA = 'https://ornek-proje.supabase.co';
const ANON = 'anon-anahtari-yeterince-uzun-0123456789';
const KULLANICI = '44444444-5555-6666-7777-888888888888';
const BASKASI = '99999999-8888-7777-6666-555555555555';
const GECERLI = 'gecerli-erisim-belirteci-' + 'a'.repeat(120);
const COP = 'gecersiz-belirtec-' + 'b'.repeat(120);
const JETON = 'fcm-jetonu-' + 'x'.repeat(140);

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen)
    + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

/* ---------------------------------------------------------------- saplama */

const saplananlar = [];
function sapla(gorecelYol, govde) {
  const tam = require.resolve(path.join(API, gorecelYol));
  const m = new Module(tam, null);
  m.filename = tam; m.loaded = true; m.exports = govde;
  require.cache[tam] = m;
  saplananlar.push(tam);
}
function temizle() {
  saplananlar.forEach(function (p) { delete require.cache[p]; });
  saplananlar.length = 0;
  delete require.cache[DEVTOK];
  delete require.cache[AUTH];
}

function sahteRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; },
    getHeader: function (k) { return res.headers[k.toLowerCase()]; },
    status: function (k) { res.statusCode = k; return res; },
    json: function (b) { res.body = b; return res; }
  };
  return res;
}

/** Bos dizide cokmemek icin: eksik kayit bir COKME degil, bir basarisizlik. */
function ilk(dizi) { return (dizi && dizi[0]) || {}; }

function kod(res) { return (res && res.body && res.body.error && res.body.error.code) || null; }

/** Sahte GoTrue: yalnızca GECERLI belirteci bir kullanıcıya çözer. */
function sahteGoTrue(iz) {
  return async function (url, opt) {
    const adres = String(url);
    iz.push({ url: adres, auth: (opt && opt.headers && opt.headers.Authorization) || null });
    if (adres === SUPA + '/auth/v1/user') {
      const h = (opt && opt.headers && opt.headers.Authorization) || '';
      if (h === 'Bearer ' + GECERLI) {
        return { ok: true, status: 200, json: async function () { return { id: KULLANICI, email: 'a@b.c' }; } };
      }
      return { ok: false, status: 401, json: async function () { return { msg: 'invalid' }; } };
    }
    /* Yenileme denemesi: bu sınamada hiç olmaması gerekiyor. */
    return { ok: false, status: 400, json: async function () { return {}; } };
  };
}

/** Uç çağrısı. `_lib/auth.js` GERÇEK; db/store/telegram saplı. */
async function cagir(istek, ayar) {
  temizle();
  const a = ayar || {};
  const iz = { save: [], del: [], fetch: [] };

  sapla('_lib/db.js', {
    isConfigured: function () { return true; },
    saveDeviceToken: async function (u, t, p) { iz.save.push({ userId: u, token: t, platform: p }); },
    deleteDeviceToken: async function (u, t) { iz.del.push({ userId: u, token: t }); return 1; }
  });
  sapla('_lib/store.js', {
    isConfigured: function () { return false; },
    hitRateLimit: async function () { return { count: 1, ttl: 60 }; }
  });
  sapla('_lib/telegram.js', {
    sendTelegram: async function () { return { ok: true }; },
    bildirimIsaretle: function () {},
    mesaj: { hata: function () { return 'hata'; } },
    ucuSar: function (h) { return h; }
  });

  global.fetch = sahteGoTrue(iz.fetch);
  const handler = require(DEVTOK);
  const req = Object.assign({ method: 'POST', headers: {}, body: { token: JETON } },
    istek || {});
  const res = sahteRes();
  await handler(req, res);
  return { res: res, iz: iz, a: a };
}

/* ------------------------------------------------- Dart kaynağından okunan */

const dart = fs.readFileSync(DART, 'utf8');

/** Dart yorumlarını atar: bir kuralı yorumda geçtiği için geçmiş saymayalım. */
function sadeDart(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}
const dartKod = sadeDart(dart);

/** Dart'ın kurduğu isteğin alanları — kaynaktan okunuyor, elle yazılmıyor. */
function dartSozlesmesi() {
  const yol = /'\$apiBase(\/api\/[a-z-]+)'/.exec(dartKod);
  const basliklar = {};
  const bBlok = /final basliklar = \{([\s\S]*?)\};/.exec(dartKod);
  if (bBlok) {
    const re = /'([A-Za-z-]+)':\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(bBlok[1])) !== null) basliklar[m[1]] = m[2];
  }
  const govdeBlok = /final govde = ([\s\S]*?);\n/.exec(dartKod);
  const alanlar = [];
  if (govdeBlok) {
    /* Buyuk harf de yakalanmali: 'userId' kacmisti (mutasyonla bulundu). */
    const re = /'([A-Za-z_]+)':/g;
    let m;
    while ((m = re.exec(govdeBlok[1])) !== null) {
      if (alanlar.indexOf(m[1]) === -1) alanlar.push(m[1]);
    }
  }
  const platformlar = [];
  const pRe = /return '(android|ios|web)';/g;
  let pm;
  while ((pm = pRe.exec(dartKod)) !== null) {
    if (platformlar.indexOf(pm[1]) === -1) platformlar.push(pm[1]);
  }
  return {
    yol: yol ? yol[1] : null,
    basliklar: basliklar,
    alanlar: alanlar,
    platformlar: platformlar.sort()
  };
}

async function kos() {
  const eskiUrl = process.env.SUPABASE_URL;
  const eskiKey = process.env.SUPABASE_ANON_KEY;
  const eskiFetch = global.fetch;
  const eskiHata = console.error;
  const eskiUyari = console.warn;
  const yakalanan = [];
  console.error = function () { yakalanan.push(Array.prototype.join.call(arguments, ' ')); };
  console.warn = function () { yakalanan.push(Array.prototype.join.call(arguments, ' ')); };
  process.env.SUPABASE_URL = SUPA;
  process.env.SUPABASE_ANON_KEY = ANON;

  try {
    /* ================================================================ */
    /* 1. Dart kaynağı sunucunun sözleşmesini kuruyor                    */
    /* ================================================================ */
    const sz = dartSozlesmesi();
    {
      esit('Dart adresi /api/device-token', sz.yol, '/api/device-token');
      esit('Dart Authorization başlığı Bearer', sz.basliklar.Authorization, 'Bearer $belirtec');
      esit('Dart Content-Type json', sz.basliklar['Content-Type'], 'application/json');
      dogru('Dart gövdesinde token var', sz.alanlar.indexOf('token') !== -1);
      dogru('Dart gövdesinde platform var', sz.alanlar.indexOf('platform') !== -1);
      /* SAHİP SUNUCUDA BELİRLENİR: gövdeye kullanıcı kimliği konmuyor. */
      dogru('Dart gövdesinde kullanıcı kimliği YOK',
        sz.alanlar.indexOf('userId') === -1 && sz.alanlar.indexOf('user_id') === -1);
      esit('Dart üç platformu biliyor', sz.platformlar.join(','), 'android,ios,web');
      dogru('DELETE gövdesi yalnızca jeton taşıyor',
        /yontem == 'DELETE'\s*\?\s*jsonEncode\(\{'token': jeton\}\)/.test(dartKod));
    }

    /* Sunucunun kabul ettiği platform kümesi ile Dart'ın ürettiği aynı mı? */
    {
      const uc = fs.readFileSync(path.join(API, 'device-token.js'), 'utf8');
      const m = /const PLATFORMS = \[([^\]]+)\]/.exec(uc);
      const sunucu = m ? m[1].split(',').map(function (x) { return x.trim().replace(/'/g, ''); }).sort() : [];
      esit('platform kümeleri örtüşüyor', sz.platformlar.join(','), sunucu.join(','));
    }

    /* Jeton alt sınırı iki tarafta aynı olmalı: aksi hâlde istemci sunucunun
       400 döneceği bir jetonu gönderir ya da geçerli bir jetonu eler. */
    {
      const fcmKaynak = fs.readFileSync(path.join(API, '_lib', 'fcm.js'), 'utf8');
      const s = /const MIN_TOKEN_LENGTH = (\d+);/.exec(fcmKaynak);
      const d = /const int kMinTokenLength = (\d+);/.exec(dartKod);
      dogru('iki tarafta da jeton alt sınırı yazılı', !!s && !!d);
      esit('alt sınırlar eşit', d && d[1], s && s[1]);
    }

    /* ================================================================ */
    /* 2. Bearer ile gerçek yol — Dart'ın kurduğu isteğin AYNISI          */
    /* ================================================================ */
    {
      const r = await cagir({
        method: 'POST',
        headers: { authorization: 'Bearer ' + GECERLI, 'content-type': 'application/json' },
        body: { token: JETON, platform: 'android' }
      });
      esit('bearer ile 200', r.res.statusCode, 200);
      esit('ok dönüyor', r.res.body && r.res.body.ok, true);
      esit('platform yankılanıyor', r.res.body && r.res.body.platform, 'android');
      esit('bir kayıt yazıldı', r.iz.save.length, 1);
      esit('sahip GoTrue\'nun döndüğü kullanıcı', ilk(r.iz.save).userId, KULLANICI);
      esit('jeton olduğu gibi yazıldı', ilk(r.iz.save).token, JETON);
      /* Belirteç GERÇEKTEN doğrulandı mı? */
      const sorgu = r.iz.fetch.filter(function (f) { return f.url === SUPA + '/auth/v1/user'; });
      esit('belirteç GoTrue\'ya soruldu', sorgu.length, 1);
      esit('soruda belirteç taşındı', ilk(sorgu).auth, 'Bearer ' + GECERLI);
      dogru('yanıtta jeton YOK', JSON.stringify(r.res.body).indexOf(JETON) === -1);
      dogru('Set-Cookie yazılmadı', r.res.headers['set-cookie'] === undefined);
    }

    /* ================================================================ */
    /* 3. Bearer bir atlatma değil                                       */
    /* ================================================================ */
    {
      const r = await cagir({
        headers: { authorization: 'Bearer ' + COP },
        body: { token: JETON }
      });
      esit('geçersiz belirteç 401', r.res.statusCode, 401);
      esit('kod unauthorized', kod(r.res), 'unauthorized');
      esit('hiçbir şey yazılmadı', r.iz.save.length, 0);
    }
    {
      const r = await cagir({ headers: {}, body: { token: JETON } });
      esit('başlık yoksa 401', r.res.statusCode, 401);
      esit('başlıksız istekte GoTrue\'ya hiç gidilmiyor', r.iz.fetch.length, 0);
    }
    {
      /* Biçimi bozuk başlıklar: "Bearer" eksik, çok kısa, boşluklu. */
      const bozuk = ['Basic ' + GECERLI, 'Bearer kisa', GECERLI, 'Bearer ', 'Bearer a b'];
      let hepsi401 = true;
      let hicSorgu = true;
      for (const h of bozuk) {
        const r = await cagir({ headers: { authorization: h }, body: { token: JETON } });
        if (r.res.statusCode !== 401) hepsi401 = false;
        if (r.iz.fetch.length !== 0) hicSorgu = false;
      }
      dogru('biçimi bozuk beş başlık da 401', hepsi401);
      dogru('biçim geçmeyen başlık GoTrue\'ya hiç sorulmuyor', hicSorgu);
    }
    {
      /* Gövdedeki kullanıcı kimliği YOK SAYILIR. */
      const r = await cagir({
        headers: { authorization: 'Bearer ' + GECERLI },
        body: { token: JETON, userId: BASKASI, user_id: BASKASI }
      });
      esit('gövdedeki kimlikle de 200', r.res.statusCode, 200);
      esit('sahip hâlâ oturumun kullanıcısı', ilk(r.iz.save).userId, KULLANICI);
      dogru('gövdedeki yabancı kimlik hiç kullanılmadı',
        JSON.stringify(r.iz.save).indexOf(BASKASI) === -1);
    }

    /* ================================================================ */
    /* 4. Çerez yolu bozulmadı, bearer onu ezemiyor                      */
    /* ================================================================ */
    {
      const r = await cagir({
        headers: { cookie: 'cl_at=' + GECERLI },
        body: { token: JETON }
      });
      esit('çerezle 200', r.res.statusCode, 200);
      esit('çerez yolunda da sahip doğru', ilk(r.iz.save).userId, KULLANICI);
    }
    {
      /* Çerez geçersiz, bearer geçerli: çerez KAZANIR ve istek 401 olur.
         Aksi hâlde bir XSS, çalınmış bir belirteci başlıkta deneyebilirdi. */
      const r = await cagir({
        headers: { cookie: 'cl_at=' + COP, authorization: 'Bearer ' + GECERLI },
        body: { token: JETON }
      });
      esit('çerez varken bearer yok sayılıyor', r.res.statusCode, 401);
      const sorgu = r.iz.fetch.filter(function (f) { return f.url === SUPA + '/auth/v1/user'; });
      esit('sorulan belirteç çerezdeki', ilk(sorgu).auth, 'Bearer ' + COP);
    }
    {
      /* Bearer yolunda yenileme çerezi OKUNMUYOR: mobilde yenilemeyi
         uygulama yapıyor, sunucu mobil oturumun sahibi olmuyor. */
      const r = await cagir({
        headers: { cookie: 'cl_rt=yenileme-belirteci-' + 'c'.repeat(60),
                   authorization: 'Bearer ' + COP },
        body: { token: JETON }
      });
      esit('bearer geçersizse 401', r.res.statusCode, 401);
      const yenileme = r.iz.fetch.filter(function (f) { return f.url.indexOf('refresh_token') !== -1; });
      esit('yenileme hiç denenmedi', yenileme.length, 0);
      dogru('Set-Cookie yazılmadı', r.res.headers['set-cookie'] === undefined);
    }

    /* ================================================================ */
    /* 5. Bayrak uç uca: diğer uçların yüzeyi DEĞİŞMEDİ                  */
    /* ================================================================ */
    {
      temizle();
      const iz = [];
      global.fetch = sahteGoTrue(iz);
      const auth = require(AUTH);
      const req = { headers: { authorization: 'Bearer ' + GECERLI } };

      const bayraksiz = await auth.resolveUser(req, sahteRes());
      esit('bayrak verilmeyince bearer YOK SAYILIYOR', bayraksiz, null);
      esit('bayraksız çağrı GoTrue\'ya hiç gitmiyor', iz.length, 0);

      const bayrakli = await auth.resolveUser(req, sahteRes(), { bearerKabul: true });
      dogru('bayrakla aynı istek çözülüyor', !!bayrakli && bayrakli.id === KULLANICI);

      /* readTokens sözleşmesi: varsayılan yalnızca çerez. */
      const t1 = auth.readTokens(req);
      esit('readTokens varsayılanı bearer okumuyor', t1.accessToken, null);
      const t2 = auth.readTokens(req, { bearerKabul: true });
      esit('bayrakla okuyor', t2.accessToken, GECERLI);
      esit('bearer yolunda yenileme belirteci yok', t2.refreshToken, null);
      dogru('bearer olduğu işaretleniyor', t2.bearer === true);
    }
    {
      /* Bearer'ı KULLANAN tek uç device-token olmalı. */
      const hepsi = [];
      (function tara(dizin) {
        fs.readdirSync(dizin, { withFileTypes: true }).forEach(function (e) {
          const tam = path.join(dizin, e.name);
          if (e.isDirectory()) return tara(tam);
          if (e.name.endsWith('.js')) hepsi.push(tam);
        });
      })(API);
      const kullananlar = hepsi.filter(function (f) {
        return /bearerKabul/.test(fs.readFileSync(f, 'utf8'));
      }).map(function (f) { return path.relative(API, f); }).sort();
      esit('bearerKabul yalnızca iki dosyada (uç + auth)',
        kullananlar.join(','), '_lib/auth.js,device-token.js');
    }

    /* ================================================================ */
    /* 6. DELETE — çıkışta cihazı ayırma                                 */
    /* ================================================================ */
    {
      const r = await cagir({
        method: 'DELETE',
        headers: { authorization: 'Bearer ' + GECERLI },
        body: { token: JETON }
      });
      esit('DELETE 200', r.res.statusCode, 200);
      esit('silinen sayısı dönüyor', r.res.body && r.res.body.removed, 1);
      esit('silme sahibe bağlı', ilk(r.iz.del).userId, KULLANICI);
      esit('kayıt yazılmadı', r.iz.save.length, 0);
    }
    {
      const r = await cagir({
        method: 'DELETE',
        headers: { authorization: 'Bearer ' + COP },
        body: { token: JETON }
      });
      esit('yetkisiz DELETE 401', r.res.statusCode, 401);
      esit('hiçbir şey silinmedi', r.iz.del.length, 0);
    }
    {
      /* Kısa jeton oturumdan ÖNCE eleniyor: çöp gövde için GoTrue'ya
         gitmenin anlamı yok. */
      const r = await cagir({
        headers: { authorization: 'Bearer ' + GECERLI },
        body: { token: 'kisa' }
      });
      esit('kısa jeton 400', r.res.statusCode, 400);
      esit('kod bad_token', kod(r.res), 'bad_token');
      esit('kısa jetonda GoTrue\'ya gidilmiyor', r.iz.fetch.length, 0);
    }

    /* ================================================================ */
    /* 7. Jeton ve belirteç loglanmıyor                                  */
    /* ================================================================ */
    {
      const hepsi = yakalanan.join('\n');
      dogru('sunucu loglarında jeton yok', hepsi.indexOf(JETON) === -1);
      dogru('sunucu loglarında belirteç yok',
        hepsi.indexOf(GECERLI) === -1 && hepsi.indexOf(COP) === -1);

      /* Dart tarafı: hiçbir debugPrint jetonu ya da belirteci basmıyor. */
      const basimlar = dartKod.match(/debugPrint\([^;]*\)/g) || [];
      dogru('Dart en az bir yerde log basıyor', basimlar.length > 0);
      const sizdiran = basimlar.filter(function (b) {
        return /\$jeton|\$belirtec|\$\{jeton|\$\{belirtec|yanit\.body/.test(b);
      });
      esit('jeton/belirteç/ham gövde basan log yok', sizdiran.length, 0);
      dogru('Dart belirteci alanda tutmuyor',
        !/String\?? _belirtec|String\?? _accessToken/.test(dartKod));
    }

    /* ================================================================ */
    /* 8. Dart istemcisinin dayanıklılığı                                */
    /* ================================================================ */
    {
      dogru('onTokenRefresh dinleniyor', /onTokenRefresh\.listen/.test(dartKod));
      dogru('izin isteniyor', /requestPermission\(\)/.test(dartKod));
      dogru('zaman aşımı var', /timeout\(const Duration\(seconds: \d+\)\)/.test(dartKod));
      /* Yeniden deneme YALNIZCA 5xx için: 400/401/429'u tekrarlamak
         ne sonucu değiştirir ne hız sınırına yardım eder. */
      dogru('yeniden deneme 5xx ile sınırlı',
        /statusCode >= 500 && deneme == 0/.test(dartKod));
      dogru('401 oturum tazelemeye yönlendiriyor',
        /statusCode == 401/.test(dartKod) && /oturumYok/.test(dartKod));
      dogru('web için vapid anahtarı yoksa jeton istenmiyor',
        /kIsWeb && kVapidKey\.isEmpty/.test(dartKod));
      dogru('çıkışta DELETE yolu var', /cikistaSil/.test(dartKod));
      dogru('adres derleme değişkeninden geliyor',
        /String\.fromEnvironment\(\s*'CL_API_BASE'/.test(dartKod));
    }
  } finally {
    temizle();
    console.error = eskiHata;
    console.warn = eskiUyari;
    global.fetch = eskiFetch;
    if (eskiUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = eskiUrl;
    if (eskiKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = eskiKey;
  }

  if (hatalar.length) {
    console.log('\n\u001b[31mKALAN ' + hatalar.length + '\u001b[0m');
    hatalar.forEach(function (h) { console.log('  - ' + h); });
    process.exitCode = 1;
    return;
  }
  console.log('\u001b[32mHEPSİ GEÇTİ\u001b[0m — ' + gecti + ' doğrulama');
}

kos().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
