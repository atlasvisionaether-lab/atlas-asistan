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

const FETCH_TIMEOUT_MS = 9000;
const TLS_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;   // 512 KB'den sonrası okunmaz
const MAX_REDIRECTS = 4;

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

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current.hostname.replace(/^\[|\]$/g, ''));

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

    return { response: response, finalUrl: current, chain: chain };
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

function check(id, severity, status, detail, extra) {
  const item = { id: id, severity: severity, status: status, detail: detail || null };
  if (extra) Object.assign(item, extra);
  return item;
}

function parseMaxAge(value) {
  const match = /max-age\s*=\s*"?(\d+)"?/i.exec(value || '');
  return match ? Number(match[1]) : null;
}

/** Set-Cookie başlıklarını sürüm farklarından bağımsız olarak dizi hâlinde verir. */
function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

function buildChecks(context) {
  const h = context.headers;
  const checks = [];
  const isHttps = context.finalUrl.protocol === 'https:';

  /* --- Aktarım güvenliği --- */
  checks.push(check('https', 'critical', isHttps ? 'pass' : 'fail',
    isHttps ? context.finalUrl.origin : 'HTTP: ' + context.finalUrl.origin));

  const hsts = h.get('strict-transport-security');
  const hstsAge = parseMaxAge(hsts);
  checks.push(check('hsts', 'high',
    hsts && hstsAge && hstsAge >= 15552000 ? 'pass' : 'fail',
    hsts || null,
    { note: hsts && (!hstsAge || hstsAge < 15552000) ? 'max_age_low' : null }));

  /* --- İçerik güvenliği başlıkları --- */
  const csp = h.get('content-security-policy');
  let cspStatus = 'fail';
  let cspNote = null;
  if (csp) {
    const scriptSrc = /script-src[^;]*/i.exec(csp);
    const source = scriptSrc ? scriptSrc[0] : csp;
    if (/'unsafe-inline'/i.test(source) && !/'(nonce-|sha256-)/i.test(source)) {
      cspStatus = 'fail';
      cspNote = 'unsafe_inline';
    } else {
      cspStatus = 'pass';
    }
  }
  checks.push(check('csp', 'critical', cspStatus, csp ? csp.slice(0, 300) : null, { note: cspNote }));

  const xfo = h.get('x-frame-options');
  const frameAncestors = csp && /frame-ancestors/i.test(csp);
  checks.push(check('xframe', 'medium', xfo || frameAncestors ? 'pass' : 'fail',
    xfo || (frameAncestors ? 'CSP: frame-ancestors' : null)));

  const nosniff = h.get('x-content-type-options');
  checks.push(check('nosniff', 'medium',
    nosniff && /nosniff/i.test(nosniff) ? 'pass' : 'fail', nosniff));

  const referrer = h.get('referrer-policy');
  checks.push(check('referrer', 'low', referrer ? 'pass' : 'fail', referrer));

  const permissions = h.get('permissions-policy') || h.get('feature-policy');
  checks.push(check('permissions', 'low', permissions ? 'pass' : 'fail',
    permissions ? permissions.slice(0, 200) : null));

  /* --- Çerezler --- */
  const cookies = getSetCookies(h);
  if (!cookies.length) {
    checks.push(check('cookies', 'high', 'skipped', null, { note: 'no_cookies' }));
  } else {
    const weak = cookies.filter(function (c) {
      return !/;\s*secure/i.test(c) || !/;\s*httponly/i.test(c) || !/;\s*samesite/i.test(c);
    });
    checks.push(check('cookies', 'high', weak.length ? 'fail' : 'pass',
      weak.length ? weak.length + '/' + cookies.length : cookies.length + ' çerez',
      { note: weak.length ? 'missing_flags' : null }));
  }

  /* --- Bilgi ifşası --- */
  const server = h.get('server');
  const powered = h.get('x-powered-by');
  const disclosed = [server, powered].filter(Boolean);
  const versioned = disclosed.some(function (v) { return /\d+\.\d+/.test(v); });
  checks.push(check('disclosure', 'low', versioned ? 'fail' : 'pass',
    disclosed.length ? disclosed.join(' | ') : null));

  /* --- Karışık içerik (yalnızca HTTPS sayfalarda anlamlı) --- */
  if (!isHttps) {
    checks.push(check('mixed_content', 'high', 'skipped', null, { note: 'not_https' }));
  } else if (context.html === null) {
    checks.push(check('mixed_content', 'high', 'skipped', null, { note: 'no_html' }));
  } else {
    const matches = context.html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi) || [];
    const insecure = matches.filter(function (m) { return !/http:\/\/(localhost|127\.)/i.test(m); });
    checks.push(check('mixed_content', 'high', insecure.length ? 'fail' : 'pass',
      insecure.length ? insecure.length + ' kaynak' : null,
      { samples: insecure.slice(0, 3).map(function (m) { return m.replace(/^[^=]*=\s*["']/, '').slice(0, 120); }) }));
  }

  /* --- TLS --- */
  const t = context.tls;
  if (!isHttps || !t || !t.ok) {
    checks.push(check('tls_protocol', 'high', 'skipped', t && t.reason ? t.reason : null, { note: 'not_measured' }));
    checks.push(check('tls_cert', 'high', 'skipped', null, { note: 'not_measured' }));
  } else {
    const modern = t.protocol === 'TLSv1.3' || t.protocol === 'TLSv1.2';
    checks.push(check('tls_protocol', 'high', modern ? 'pass' : 'fail', t.protocol));

    let certStatus = 'pass';
    let certNote = null;
    if (!t.authorized) { certStatus = 'fail'; certNote = t.authorizationError || 'untrusted'; }
    else if (t.daysLeft !== null && t.daysLeft < 0) { certStatus = 'fail'; certNote = 'expired'; }
    else if (t.daysLeft !== null && t.daysLeft < 15) { certStatus = 'fail'; certNote = 'expiring_soon'; }
    checks.push(check('tls_cert', 'high', certStatus,
      t.daysLeft !== null ? t.daysLeft + ' gün' : null,
      { note: certNote, issuer: t.issuer }));
  }

  /* --- Eski TLS sürümleri --- */
  const legacy = context.legacyTls;
  if (!isHttps || !legacy || !legacy.tested) {
    checks.push(check('tls_legacy', 'high', 'skipped', legacy && legacy.reason ? legacy.reason : null,
      { note: 'not_measured' }));
  } else {
    checks.push(check('tls_legacy', 'high', legacy.accepted ? 'fail' : 'pass',
      legacy.accepted ? 'TLS 1.0/1.1 kabul ediliyor' : 'Yalnızca modern TLS'));
  }

  return checks;
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

async function scanSite(rawUrl) {
  const target = normalizeTarget(rawUrl);
  if (target.error) throw new Error(target.error);

  const started = Date.now();
  const { response, finalUrl, chain } = await guardedFetch(target.url, {});

  const contentType = response.headers.get('content-type') || '';
  const html = /html|xml|text\/plain/i.test(contentType) ? await readBodyCapped(response) : null;

  const isHttps = finalUrl.protocol === 'https:';
  const host = finalUrl.hostname.replace(/^\[|\]$/g, '');
  const port = finalUrl.port ? Number(finalUrl.port) : 443;

  let tlsInfo = null;
  let legacyInfo = null;
  if (isHttps) {
    tlsInfo = await inspectTls(host, port);
    if (tlsInfo.ok) {
      // TLS 1.1 kabul ediliyorsa 1.0'ı ayrıca denemeye gerek yok.
      legacyInfo = await probeLegacyTls(host, port, 'TLSv1.1');
      if (legacyInfo.tested && !legacyInfo.accepted) {
        const older = await probeLegacyTls(host, port, 'TLSv1');
        if (older.tested && older.accepted) legacyInfo = older;
      }
    }
  }

  const checks = buildChecks({
    headers: response.headers,
    finalUrl: finalUrl,
    html: html,
    tls: tlsInfo,
    legacyTls: legacyInfo
  });

  const failed = checks.filter(function (c) { return c.status === 'fail'; });

  // Hedef hata sayfası döndürdüyse başlıklar normal sayfanınkinden farklı
  // olabilir; sonucu bu uyarıyla birlikte sunmak, sessizce puanlamaktan dürüst.
  const warnings = [];
  if (response.status >= 400) warnings.push('error_response');
  if (html === null) warnings.push('no_html_body');

  return {
    url: finalUrl.href,
    warnings: warnings,
    host: host,
    httpStatus: response.status,
    redirects: chain.length - 1,
    score: scoreOf(checks),
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
    isDemo: false
  };
}

module.exports = { scanSite, WEIGHTS };
