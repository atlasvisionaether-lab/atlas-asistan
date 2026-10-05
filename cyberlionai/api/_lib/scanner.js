'use strict';

/**
 * Cyber Lion AI — tarama motoru.
 *
 * Tasarım ilkesi: **yalnızca gerçekten ölçülen şey puanlanır.** Bir kontrol
 * çalıştırılamadıysa (zaman aşımı, TLS elenmesi, HTML alınamaması) sonuçta
 * "skipped" olarak görünür ve skora hiç girmez. Ölçülmeyen bir maddeyi
 * "başarısız" sayıp puan düşürmek, bir güvenlik ürünü için yalan rapor üretmek
 * demektir.
 */

const tls = require('node:tls');
const { normalizeTarget, assertPublicHost } = require('./guard.js');
const geo = require('./geo.js');
const mail = require('./mail');
const dnssec = require('./dnssec.js');
const owaspLite = require('./owasp.js');

const FETCH_TIMEOUT_MS = 9000;
const TLS_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;   // 512 KB'den sonrası okunmaz
const MAX_REDIRECTS = 4;

/* Rapor ve motor sürümü: kaydedilen her taramaya ve PDF'e yazılır, böylece
   eski bir sonuç hangi kural setiyle üretildiği bilinerek okunabilir. */
const SCANNER_VERSION = '1.3.1-owasp-lite';
const REPORT_VERSION = '1';

/* ============================================================
   Ağ yardımcıları
   ============================================================ */

/**
 * Yönlendirmeleri elle takip eder ve **her adımda** hedefi yeniden doğrular.
 * fetch'in kendi redirect:'follow' davranışı, ilk adresi doğrulasak bile
 * sonraki adımda özel bir IP'ye gitmemizi engellemez.
 */
async function guardedFetch(startUrl, options) {
  let current = startUrl;
  const chain = [];
  /* Son atlamanin cozulen adresleri. Ulke bundan turetiliyor: guvenlik
     kontrolunden GECEN adresin ta kendisi, ayrica sorulmus bir adres degil. */
  let adresler = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    adresler = await assertPublicHost(current.hostname.replace(/^\[|\]$/g, ''));

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(current.href, {
        method: (options && options.method) || 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'CyberLionAI-Scanner/1.0 (+https://cyberlionai.com)',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'tr,en;q=0.8'
        }
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('timeout');
      throw new Error('unreachable');
    }
    clearTimeout(timer);

    chain.push({ url: current.href, status: response.status });

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      let next;
      try {
        next = new URL(location, current);
      } catch (e) {
        throw new Error('bad_redirect');
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error('bad_redirect');
      current = next;
      continue;
    }

    return { response: response, finalUrl: current, chain: chain, addresses: adresler };
  }

  throw new Error('too_many_redirects');
}

/** Gövdeyi üst sınıra kadar okur; devasa dosyalarda belleği korur. */
async function readBodyCapped(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (total < MAX_HTML_BYTES) {
    let piece;
    try {
      piece = await reader.read();
    } catch (e) {
      break;
    }
    if (piece.done) break;
    chunks.push(piece.value);
    total += piece.value.length;
  }
  try { await reader.cancel(); } catch (e) { /* yok say */ }

  return Buffer.concat(chunks.map(function (c) { return Buffer.from(c); })).toString('utf8').slice(0, MAX_HTML_BYTES);
}

/**
 * TLS incelemesi: görüşülen protokol, sertifika geçerlilik süresi ve
 * eski protokollerin (TLS 1.0/1.1) hâlâ kabul edilip edilmediği.
 */
function inspectTls(host, port) {
  return new Promise(function (resolve) {
    const socket = tls.connect({
      host: host, port: port, servername: host,
      rejectUnauthorized: false,          // sertifika hatalı olsa da bilgi toplarız
      ALPNProtocols: ['http/1.1']
    });

    const done = function (result) {
      try { socket.destroy(); } catch (e) { /* yok say */ }
      resolve(result);
    };

    socket.setTimeout(TLS_TIMEOUT_MS, function () { done({ ok: false, reason: 'timeout' }); });
    socket.on('error', function (err) { done({ ok: false, reason: (err && err.code) || 'error' }); });

    socket.on('secureConnect', function () {
      const cert = socket.getPeerCertificate();
      const expiry = cert && cert.valid_to ? new Date(cert.valid_to) : null;
      done({
        ok: true,
        protocol: socket.getProtocol(),
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        issuer: cert && cert.issuer ? (cert.issuer.O || cert.issuer.CN || null) : null,
        validTo: expiry && !isNaN(expiry) ? expiry.toISOString() : null,
        daysLeft: expiry && !isNaN(expiry) ? Math.floor((expiry - Date.now()) / 86400000) : null
      });
    });
  });
}

/** Yalnızca eski bir protokolle bağlanmayı dener; başarı = sunucu hâlâ kabul ediyor. */
function probeLegacyTls(host, port, version) {
  return new Promise(function (resolve) {
    let socket;
    try {
      socket = tls.connect({
        host: host, port: port, servername: host,
        rejectUnauthorized: false,
        minVersion: version, maxVersion: version,
        // OpenSSL güvenlik seviyesi varsayılanda eski protokolleri istemci
        // tarafında engeller; sunucunun ne kabul ettiğini ölçebilmek için
        // yalnızca bu yoklamada seviye düşürülür.
        ciphers: 'DEFAULT:@SECLEVEL=0'
      });
    } catch (e) {
      return resolve({ tested: false, reason: 'unsupported_by_runtime' });
    }

    const done = function (result) {
      try { socket.destroy(); } catch (e) { /* yok say */ }
      resolve(result);
    };
    socket.setTimeout(TLS_TIMEOUT_MS, function () { done({ tested: true, accepted: false, reason: 'timeout' }); });
    socket.on('error', function (err) {
      const code = (err && err.code) || '';
      // İstemci protokolü hiç teklif edemediyse ölçüm yapılmamış demektir.
      if (/NO_PROTOCOLS_AVAILABLE/i.test(code)) {
        return done({ tested: false, reason: 'unsupported_by_runtime' });
      }
      // Sunucunun reddi ölçümün kendisidir: eski protokol kapalı.
      done({ tested: true, accepted: false, reason: code || 'refused' });
    });
    socket.on('secureConnect', function () { done({ tested: true, accepted: true, protocol: socket.getProtocol() }); });
  });
}

/* ============================================================
   Kontroller
   ============================================================ */

const WEIGHTS = { critical: 10, high: 7, medium: 4, low: 2, info: 0 };

/* ============================================================
   Alt motorlar (api/_lib/engines/). Kontrol mantığı motorlarda; burada
   yalnızca birleştirme ve SIRA. Sıra eski buildChecks ile birebir aynı
   (rapor ve sınamalar buna dayanıyor); tools/engines-test.js eski çıktıyla
   karşılaştırır.
   ============================================================ */
const headerEngine = require('./engines/header-scanner.js');
const cookieEngine = require('./engines/cookie-scanner.js');
const tlsEngine = require('./engines/tls-scanner.js');
const dnsEngine = require('./engines/dns-scanner.js');
const blacklistEngine = require('./engines/blacklist-scanner.js');

const ENGINES = [headerEngine, cookieEngine, tlsEngine, dnsEngine, blacklistEngine];

/* Eski buildChecks sırası: başlıkların ilk yedisi, çerez, kalan başlıklar,
   TLS, DNS, kara liste. */
const ORDER = headerEngine.IDS.slice(0, 7)
  .concat(cookieEngine.IDS, headerEngine.IDS.slice(7), tlsEngine.IDS, dnsEngine.IDS, blacklistEngine.IDS);

function orderIndex(id) {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length : i;
}

/** Tüm motorları çalıştırır: { checks, findings, fixCode } (checks eski sırada). */
function runEngines(context, lang) {
  const parts = ENGINES.map(function (e) { return e.analyze(context, lang); });
  const checks = [].concat.apply([], parts.map(function (p) { return p.checks; }))
    .map(function (c, i) { return { c: c, i: i }; })
    .sort(function (x, y) { return (orderIndex(x.c.id) - orderIndex(y.c.id)) || (x.i - y.i); })
    .map(function (x) { return x.c; });
  const fixCode = {};
  parts.forEach(function (p) { Object.assign(fixCode, p.fixCode || {}); });
  return { checks: checks, findings: [].concat.apply([], parts.map(function (p) { return p.findings || []; })), fixCode: fixCode };
}

/** Geriye uyum: kalibrasyon ve diğer sınamalar yalnızca kontrol dizisini ister. */
function buildChecks(context) {
  return runEngines(context).checks;
}

/** Skor: yalnızca ölçülebilmiş kontroller üzerinden. */
function scoreOf(checks) {
  const measured = checks.filter(function (c) { return c.status === 'pass' || c.status === 'fail'; });
  const total = measured.reduce(function (a, c) { return a + WEIGHTS[c.severity]; }, 0);
  if (!total) return null;
  const lost = measured.filter(function (c) { return c.status === 'fail'; })
                       .reduce(function (a, c) { return a + WEIGHTS[c.severity]; }, 0);
  return Math.max(0, Math.round((1 - lost / total) * 100));
}

/* ============================================================
   Giriş noktası
   ============================================================ */

async function scanSite(rawUrl, options) {
  const target = normalizeTarget(rawUrl);
  if (target.error) throw new Error(target.error);
  const opts = options || {};

  const started = Date.now();
  const { response, finalUrl, chain, addresses } = await guardedFetch(target.url, {});

  const contentType = response.headers.get('content-type') || '';
  const html = /html|xml|text\/plain/i.test(contentType) ? await readBodyCapped(response) : null;

  const isHttps = finalUrl.protocol === 'https:';
  const host = finalUrl.hostname.replace(/^\[|\]$/g, '');
  const port = finalUrl.port ? Number(finalUrl.port) : 443;

  /* E-posta kimlik kayitlari TLS ile ayni anda olculuyor: ikisi de agi
     bekliyor ve sirayla yapilsaydi sureleri toplanirdi. Olculen gecikme
     16-330 ms araliginda (kosu 34709562560). Sorgu duserse `ok:false` doner
     ve kontroller "olculemedi" olur; tarama DUSMEZ. */
  const mailSozu = mail.mailKayitlari(host).catch(function (e) {
    return { ok: false, sebep: 'query_failed', hata: e && e.message };
  });
  /* Kara liste (URLhaus) da paralel; önbellekli, düşerse null → skipped. */
  const blacklistSozu = blacklistEngine.loadBlacklist().catch(function () { return null; });
  /* DNSSEC sorgusu da paralel: hedef siteye değil genel DNS'e. */
  const dnssecSozu = dnssec.dnssecDurumu(host).catch(function () { return { ok: false, reason: 'not_measured' }; });

  let tlsInfo = null;
  let legacyInfo = null;
  if (isHttps) {
    // Paralel çalıştırılır: sıralı yapılsaydı en kötü durumda üç el sıkışma
    // arka arkaya beklenir ve fonksiyon zaman aşımına yaklaşırdı.
    const [inspected, legacy11] = await Promise.all([
      inspectTls(host, port),
      probeLegacyTls(host, port, 'TLSv1.1')
    ]);
    tlsInfo = inspected;

    if (tlsInfo.ok) {
      legacyInfo = legacy11;
      // 1.1 kabul edilmiyorsa 1.0 ayrıca denenir; kabul ediliyorsa gerek yok.
      if (legacy11.tested && !legacy11.accepted) {
        const legacy10 = await probeLegacyTls(host, port, 'TLSv1');
        if (legacy10.tested && legacy10.accepted) legacyInfo = legacy10;
      }
    }
  }

  const mailInfo = await mailSozu;
  const dnssecInfo = await dnssecSozu;

  const engineResult = runEngines({
    headers: response.headers,
    finalUrl: finalUrl,
    html: html,
    tls: tlsInfo,
    legacyTls: legacyInfo,
    mail: mailInfo,
    dnssec: dnssecInfo,
    blacklist: await blacklistSozu
  }, opts.lang);
  const baseChecks = engineResult.checks;

  /* OWASP Top 10 LITE: paralel tek tur. Aktif kontroller (A03) yalnızca
     kullanıcının sahiplik onayı ile çalışır; onay yoksa skipped döner.
     Bknz _lib/owasp.js — ölçülmeyen kontrol burada da puanlanmaz. */
  const owaspResult = await owaspLite.runOwaspLite({
    finalUrl: finalUrl,
    headers: response.headers,
    html: html,
    consent: opts.consent === true
  });

  const checks = baseChecks.concat(owaspResult.checks);

  /* Ulke: SON atlamanin cozulmus adreslerinden, kamu mali RIR tablosuyla.
     Ucuncu taraf bir cografi konum servisine cikilmiyor — taradigimiz adresi
     disariya bildirmemek bu projenin acik bir karari (bkz. _lib/geo.js).

     Yalnizca IPv4 cozuluyor: tablo IPv4. Cozulemeyen kayit NULL kaliyor;
     uydurulmus bir ulke, bos bir alandan daha kotu olurdu.

     IP'nin kendisi HICBIR YERE yazilmiyor; buradan yalnizca iki harf cikiyor. */
  let country = null;
  for (const adres of (addresses || [])) {
    const cc = geo.countryOfIp(adres);
    /* Buyuk harfe cevriliyor: tablo bugun ISO-2'yi buyuk harf uretiyor
       (olculdu) ama veritabani kisiti da kod suzgeci de BUYUK harf bekliyor.
       Uretici bir gun kucuk harfe gecerse degeri sessizce dusurmek yerine
       kabul etmek dogru olan. */
    if (cc) { country = String(cc).toUpperCase(); break; }
  }

  const failed = checks.filter(function (c) { return c.status === 'fail'; });

  // Hedef hata sayfası döndürdüyse başlıklar normal sayfanınkinden farklı
  // olabilir; sonucu bu uyarıyla birlikte sunmak, sessizce puanlamaktan dürüst.
  const warnings = [];
  if (response.status >= 400) warnings.push('error_response');
  if (html === null) warnings.push('no_html_body');

  const owaspFailByCat = {};
  owaspResult.checks.forEach(function (c) {
    if (c.owasp && c.status === 'fail') {
      owaspFailByCat[c.owasp] = (owaspFailByCat[c.owasp] || 0) + 1;
    }
  });

  return {
    url: finalUrl.href,
    warnings: warnings,
    host: host,
    owaspFindings: owaspResult.findings,
    owaspFailedCategories: owaspFailByCat,
    activeChecksConsent: opts.consent === true,
    country: country,
    /* Sertifika bitişi: izleme (monitor.js) 30/7/1 gün uyarısı için okuyor.
       Yalnızca tarih ve kalan gün; sertifikanın kendisi dışarı çıkmaz. */
    tls: tlsInfo && tlsInfo.ok
      ? { validTo: tlsInfo.validTo || null, daysLeft: typeof tlsInfo.daysLeft === 'number' ? tlsInfo.daysLeft : null }
      : null,
    httpStatus: response.status,
    redirects: chain.length - 1,
    score: scoreOf(checks),
    /* Ana skordan ayrı (bkz. _lib/dnssec.js): SPF/DMARC/DKIM/DNSSEC. */
    emailScore: dnssec.emailScore(checks),
    /* Kalan kontrollerin sunucuya göre düzeltme parçaları (engines/fixes.js). */
    fixCode: engineResult.fixCode,
    checks: checks,
    summary: {
      total: checks.length,
      passed: checks.filter(function (c) { return c.status === 'pass'; }).length,
      failed: failed.length,
      skipped: checks.filter(function (c) { return c.status === 'skipped'; }).length,
      critical: failed.filter(function (c) { return c.severity === 'critical'; }).length,
      high: failed.filter(function (c) { return c.severity === 'high'; }).length
    },
    durationMs: Date.now() - started,
    scannedAt: new Date().toISOString(),
    scannerVersion: SCANNER_VERSION,
    reportVersion: REPORT_VERSION,
    isDemo: false
  };
}

/* buildChecks ve scoreOf, kalibrasyon sinamasi icin disari aciliyor
   (tools/calibration-test.js). Skorun dogrulugu ancak bilinen girdilerle
   olculebilir; agdan gecen bir sinama bunu yapamaz. */
module.exports = { scanSite, buildChecks, runEngines, ORDER, scoreOf, WEIGHTS, SCANNER_VERSION, REPORT_VERSION };
