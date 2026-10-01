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
const dnszone = require('./dnszone');

const FETCH_TIMEOUT_MS = 9000;
const TLS_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;   // 512 KB'den sonrası okunmaz
const MAX_REDIRECTS = 4;

/* Rapor ve motor sürümü: kaydedilen her taramaya ve PDF'e yazılır, böylece
   eski bir sonuç hangi kural setiyle üretildiği bilinerek okunabilir. */
const SCANNER_VERSION = '1.3.0';
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

  /* --- Çapraz köken sertleştirmesi ---------------------------------------
     ÖLÇÜLDÜ (koşu 34663226505): Observatory bu başlıkların YOKLUĞUNU
     başarısızlık saymıyor —

       coop-not-implemented  pass=true   m=0
       coep-not-implemented  pass=true   m=0
       corp-not-implemented  pass=null   m=0

     Bu doğru bir duruş: bunlar derinlemesine savunma katmanları, kusur değil.
     Yoklukta "fail" versek hem hemen her siteyle çelişirdik hem de haksız
     olurduk. O yüzden: yoksa `skipped`, varsa ve BİLEREK zayıflatılmışsa
     `fail`. Ağırlık `info` (0) — mevcut müşterilerin skoru bu eklemeyle
     kaymıyor; bunlar tavsiye, ceza değil. */

  const coop = (h.get('cross-origin-opener-policy') || '').trim().toLowerCase();
  if (!coop) {
    checks.push(check('coop', 'info', 'skipped', null, { note: 'not_implemented' }));
  } else {
    /* `unsafe-none` tarayıcı varsayılanı ama BİLEREK yazılmışsa korumayı
       kapatma niyetidir; onu ayrıca işaretliyoruz. */
    checks.push(check('coop', 'info', coop === 'unsafe-none' ? 'fail' : 'pass', coop));
  }

  const coep = (h.get('cross-origin-embedder-policy') || '').trim().toLowerCase();
  if (!coep) {
    checks.push(check('coep', 'info', 'skipped', null, { note: 'not_implemented' }));
  } else {
    checks.push(check('coep', 'info', coep === 'unsafe-none' ? 'fail' : 'pass', coep));
  }

  const corp = (h.get('cross-origin-resource-policy') || '').trim().toLowerCase();
  if (!corp) {
    checks.push(check('corp', 'info', 'skipped', null, { note: 'not_implemented' }));
  } else {
    const gecerli = corp === 'same-origin' || corp === 'same-site' || corp === 'cross-origin';
    checks.push(check('corp', 'info', gecerli ? 'pass' : 'fail', corp));
  }

  /* CORS: `*` tek başına kusur DEĞİL — herkese açık bir API için doğru
     olabilir; Observatory de m=0 veriyor. Gerçek sorun `*` ile birlikte
     kimlik bilgisi istenmesi: tarayıcı bu ikiliyi zaten reddeder, yani
     yapılandırma yanlış yazılmış demektir. Bunu ayrıca işaretliyoruz ve
     bu, Observatory'den BİLEREK ayrıldığımız tek nokta. */
  const acao = (h.get('access-control-allow-origin') || '').trim();
  const acac = (h.get('access-control-allow-credentials') || '').trim().toLowerCase();
  if (!acao) {
    checks.push(check('cors', 'info', 'skipped', null, { note: 'not_implemented' }));
  } else if (acao === '*' && acac === 'true') {
    /* Onem derecesi CIKTIYA gore degismemeli — kalibrasyon sinamasi bunu
       yakaladi ve hakliydi. Bu grubun tamami `info`: tarayici zaten bu
       ikiliyi reddediyor, yani somurulebilir bir acik degil, yanlis yazilmis
       bir yapilandirma. Raporda basarisiz kontrol olarak gorunuyor ama skoru
       kaydirmiyor. */
    checks.push(check('cors', 'info', 'fail', acao + ' + credentials',
      { note: 'wildcard_with_credentials' }));
  } else {
    checks.push(check('cors', 'info', 'pass', acao.slice(0, 120)));
  }

  /* SRI: yalnızca BAŞKA bir kökenden yüklenen script'ler için anlamlıdır.
     Kendi kökeninden yüklenen dosyada bütünlük özniteliği beklenmez —
     Observatory de öyle yapıyor (sri-not-implemented-but-no-scripts-loaded
     ve ...-all-scripts-loaded-from-secure-origin, ikisi de pass=null). */
  if (context.html === null) {
    checks.push(check('sri', 'low', 'skipped', null, { note: 'no_html' }));
  } else {
    const scriptler = context.html.match(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
    const disKokenli = scriptler.filter(function (etiket) {
      const m = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(etiket);
      if (!m) return false;
      let u;
      try { u = new URL(m[1], context.finalUrl); } catch (e) { return false; }
      return u.origin !== context.finalUrl.origin;
    });
    const butunluksuz = disKokenli.filter(function (etiket) {
      return !/\bintegrity\s*=\s*["'][^"']+["']/i.test(etiket);
    });
    if (!disKokenli.length) {
      checks.push(check('sri', 'low', 'skipped', null, { note: 'no_external_scripts' }));
    } else {
      checks.push(check('sri', 'low', butunluksuz.length ? 'fail' : 'pass',
        butunluksuz.length ? butunluksuz.length + '/' + disKokenli.length + ' script'
                           : disKokenli.length + ' script',
        { samples: butunluksuz.slice(0, 3).map(function (e) {
            const m = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(e);
            return m ? m[1].slice(0, 120) : '';
          }) }));
    }
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

  /* --- E-posta kimlik doğrulaması (SPF / DMARC / DKIM) --------------------
     Ağırlık `info` (0): bu üçü POSTA yüzeyini ölçüyor, skor ise WEB yüzeyi
     için kalibre edilmiş. Ağırlık vermek, hiçbir şeyini değiştirmemiş
     müşterilerin skorunu bir gecede düşürürdü. Bulgu olarak görünüyorlar,
     düzeltmesi raporda yazıyor, skor sabit kalıyor. Ayrıntılı gerekçe:
     _lib/mail.js başlığı. */
  const m = context.mail;

  if (!m || !m.ok) {
    /* Sebep saklanmıyor: alan adı yoksa "SPF yok" demek yanlış olur, sorgu
       düştüyse de bilmiyoruz demektir. İkisi de ölçüm başarısızlığı. */
    const sebep = (m && m.sebep) || 'not_measured';
    ['spf', 'dmarc', 'dkim'].forEach(function (id) {
      checks.push(check(id, 'info', 'skipped', null, { note: sebep }));
    });
  } else {
    const spf = mail.spfDegerlendir(m.spf);
    if (spf.durum === 'none') {
      /* Yokluk BURADA başarısızlıktır ve bu, COOP/COEP'ten bilinçli bir
         ayrım: orada yokluk zararsız bir eksik katmandı, burada yokluk
         "herkes bu alan adı adına e-posta gönderebilir" demek. Üstelik
         yokluğu ÖLÇTÜK (NOERROR/NODATA), varsayımda bulunmuyoruz. */
      checks.push(check('spf', 'info', 'fail', null, { note: 'spf_missing' }));
    } else {
      checks.push(check('spf', 'info', spf.durum, spf.detay || null,
        spf.not ? { note: spf.not } : null));
    }

    const dmarc = mail.dmarcDegerlendir(m.dmarc);
    if (dmarc.durum === 'none') {
      checks.push(check('dmarc', 'info', 'fail', null, { note: 'dmarc_missing' }));
    } else {
      checks.push(check('dmarc', 'info', dmarc.durum, dmarc.detay || null,
        dmarc.not ? { note: dmarc.not } : null));
    }

    /* DKIM ASLA `fail` olmuyor. Bir alan adının seçicileri DNS'ten
       numaralandırılamaz (ölçüldü); bulamamak "yok" demek değil, "bilmiyoruz"
       demektir. Yokluğu başarısızlık saymak, ölçmediğimiz bir şeyi
       cezalandırmak olurdu. */
    if (m.dkimJoker) {
      checks.push(check('dkim', 'info', 'skipped', null, { note: 'dkim_wildcard' }));
    } else if (m.dkimSecici) {
      checks.push(check('dkim', 'info', 'pass', m.dkimSecici + '._domainkey'));
    } else {
      checks.push(check('dkim', 'info', 'skipped', null, { note: 'dkim_not_enumerable' }));
    }
  }

  /* --- Alan adı bölgesi: CAA ve DNSSEC --------------------------------
     İkisinde de YOKLUK başarısızlık değil "uygulanmamış" sayılıyor ve bu,
     SPF/DMARC'tan bilinçli bir ayrım: orada yokluk bugün herkesin
     yapabileceği somut bir açıktı (sahte e-posta). Burada yokluk, saldırı
     için başka bir şeyin de gerekmesini şart koşuyor — bir sertifika
     makamının ihlali ya da DNS yolunda araya girme. COOP/COEP kararıyla
     aynı çizgi. Ağırlık: info (0). */
  const z = context.zone;

  if (!z || !z.ok) {
    const sebep = (z && z.sebep) || 'not_measured';
    ['caa', 'dnssec'].forEach(function (id) {
      checks.push(check(id, 'info', 'skipped', null, { note: sebep }));
    });
  } else {
    const caa = dnszone.caaDegerlendir(z.caa);
    if (caa.durum === 'none') {
      checks.push(check('caa', 'info', 'skipped', null, { note: 'not_implemented' }));
    } else {
      checks.push(check('caa', 'info', 'pass', caa.detay || null));
    }

    const sec = dnszone.dnssecDegerlendir(z.ds);
    if (sec.durum === 'pass') {
      checks.push(check('dnssec', 'info', 'pass', sec.detay || null));
    } else if (sec.durum === 'none') {
      checks.push(check('dnssec', 'info', 'skipped', null, { note: 'not_implemented' }));
    } else {
      /* UDP/53 kapalıysa ya da yanıt yorumlanamıyorsa: BİLMİYORUZ.
         "DNSSEC yok" demek burada yalan olurdu. */
      checks.push(check('dnssec', 'info', 'skipped', null, { note: sec.not || 'not_measured' }));
    }
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

  const bolgeSozu = dnszone.bolgeKayitlari(host).catch(function (e) {
    return { ok: false, sebep: 'query_failed', hata: e && e.message };
  });

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
  const bolgeInfo = await bolgeSozu;

  const checks = buildChecks({
    headers: response.headers,
    finalUrl: finalUrl,
    html: html,
    tls: tlsInfo,
    legacyTls: legacyInfo,
    mail: mailInfo,
    zone: bolgeInfo
  });

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

  return {
    url: finalUrl.href,
    warnings: warnings,
    host: host,
    country: country,
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
    scannerVersion: SCANNER_VERSION,
    reportVersion: REPORT_VERSION,
    isDemo: false
  };
}

/* buildChecks ve scoreOf, kalibrasyon sinamasi icin disari aciliyor
   (tools/calibration-test.js). Skorun dogrulugu ancak bilinen girdilerle
   olculebilir; agdan gecen bir sinama bunu yapamaz. */
module.exports = { scanSite, buildChecks, scoreOf, WEIGHTS, SCANNER_VERSION, REPORT_VERSION };
