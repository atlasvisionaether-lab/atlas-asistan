'use strict';

/**
 * OWASP Top 10 LITE kontrolleri — Cyber Lion AI.
 *
 * İlkeler (scanner.js ile aynı):
 *   1. Yalnızca gerçekten ölçülen kontrol puanlanır. Ölçülemeyen
 *      kontrol "skipped" döner ve skora girmez.
 *   2. Aktif kontroller (A03 payload, A01 hassas yol denemesi) SADECE
 *      `consent` true iken çalışır. Çağıran bunu yalnızca beyan + DOĞRULANMIŞ
 *      sahiplik varken true yapar (bkz. scan-levels.js). Yoksa skipped + not.
 *   3. Tüm istekler tek turda paralel atılır; her biri kendi zaman
 *      aşımına sahiptir. Böylece toplam süre tek isteğin süresini
 *      aşmaz ve 30 sn fonksiyon limiti içinde kalır.
 *   4. Hiçbir istek yönlendirmeyi takip etmez (redirect: 'manual') ve
 *      hedef ana bilgisayar tarayıcıda zaten doğrulanmıştır.
 *   5. Yanıt gövdeleri yalnızca küçük bir örnekle okunur (64 KB üstü
 *      alınmaz); dışarı aktarılan tek şey kısa kanıt parçasıdır.
 */

const PROBE_TIMEOUT_MS = 6000;
const MAX_PROBE_BYTES = 64 * 1024;
const UA = 'CyberLionAI-Scanner/1.3 (+https://cyberlionai.com)';

/* OWASP kategorileri (2021): yalnızca bu modülde tarananlar. */
const OWASP = {
  A01: 'Broken Access Control',
  A02: 'Cryptographic Failures',
  A03: 'Injection',
  A05: 'Security Misconfiguration',
  A06: 'Vulnerable and Outdated Components',
  A07: 'Identification and Authentication Failures'
};

function owaspCheck(id, owasp, severity, status, detail, extra) {
  const item = {
    id: id,
    owasp: owasp,
    severity: severity,
    status: status,
    detail: detail || null
  };
  if (extra) Object.assign(item, extra);
  return item;
}

/** Tek istek: yönlendirme takip edilmez, gövde sınırlı okunur. */
async function probe(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, PROBE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: method || 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept': '*/*' }
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: err && err.name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
  clearTimeout(timer);

  let body = null;
  if (method !== 'HEAD') {
    try {
      const reader = response.body ? response.body.getReader() : null;
      if (reader) {
        const chunks = [];
        let size = 0;
        for (;;) {
          const step = await reader.read();
          if (step.done) break;
          size += step.value.length;
          chunks.push(step.value);
          if (size >= MAX_PROBE_BYTES) break;
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
    } catch (e) { body = null; }
  }
  return {
    ok: true,
    status: response.status,
    headers: response.headers,
    body: body
  };
}

/* ------------------------------------------------------------
   A01 — Broken Access Control: hassas dosya sızıntısı.
   AKTİF (seviye 2): yayınlanmamış yolları tahmin etmek, izinsiz yapıldığında
   dizin taraması sayılır. Yalnızca doğrulanmış alan adında.
   HEAD ile bakılır; 200 dönerse ve içerik HTML DEĞİLSE sızıntı
   sayılır. SPA'lar her yola 200 + HTML döndürdüğü için bu ayrım
   yanlış pozitifi engeller.
   ------------------------------------------------------------ */
const SENSITIVE_PATHS = [
  { path: '/.env', label: '.env dosyası' },
  { path: '/.env.bak', label: '.env yedeği' },
  { path: '/.git/HEAD', label: '.git dizini' },
  { path: '/.DS_Store', label: '.DS_Store' },
  { path: '/config.json', label: 'config.json' },
  { path: '/backup.zip', label: 'backup.zip' }
];

async function a01ExposedFiles(origin, consent) {
  if (!consent) {
    return {
      checks: SENSITIVE_PATHS.map(function (item) {
        return owaspCheck('a01_' + item.path.replace(/[^a-z]/gi, '_'), 'A01', 'critical',
          'skipped', null, { note: 'requires_verified_ownership', path: item.path });
      }),
      findings: []
    };
  }
  const results = await Promise.all(
    SENSITIVE_PATHS.map(function (item) { return probe(origin + item.path, 'HEAD'); })
  );
  const checks = [];
  const findings = [];
  let measured = 0;

  SENSITIVE_PATHS.forEach(function (item, i) {
    const r = results[i];
    if (!r.ok) {
      checks.push(owaspCheck('a01_' + item.path.replace(/[^a-z]/gi, '_'), 'A01', 'critical',
        'skipped', null, { note: r.reason }));
      return;
    }
    measured++;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const exposed = r.status === 200 && !ct.includes('text/html');
    checks.push(owaspCheck('a01_' + item.path.replace(/[^a-z]/gi, '_'), 'A01', 'critical',
      exposed ? 'fail' : 'pass', r.status + (ct ? ' ' + ct : ''), { path: item.path }));
    if (exposed) {
      findings.push({
        owasp_category: 'A01',
        severity: 'critical',
        title: 'Açıkta duran hassas dosya: ' + item.label,
        description: item.path + ' adresi herkese açık erişilebilir durumda (HTTP 200, içerik tipi HTML değil).',
        evidence: 'HEAD ' + item.path + ' → 200',
        fix_code: '# nginx\nlocation ~ /\\.(env|git|DS_Store) { deny all; return 404; }\n\n# Apache (.htaccess)\n<FilesMatch "^\\.(env|DS_Store)">\n  Require all denied\n</FilesMatch>\nRedirectMatch 404 /\\.git'
      });
    }
  });
  return { checks: checks, findings: findings, measured: measured };
}

/* ------------------------------------------------------------
   A02 — Cryptographic Failures (pasif ekler).
   Zayıf TLS tarayıcının ana turunda ölçülür (tls_protocol check).
   Burada yalnızca HSTS preload hazırlığı kontrol edilir.
   ------------------------------------------------------------ */
function a02HstsPreload(hstsValue) {
  if (!hstsValue) {
    return owaspCheck('a02_hsts_preload', 'A02', 'high', 'fail', 'HSTS yok',
      { note: 'hsts_missing' });
  }
  const hasInclude = /includeSubDomains/i.test(hstsValue);
  const hasPreload = /preload/i.test(hstsValue);
  const m = /max-age\s*=\s*"?(\d+)"?/i.exec(hstsValue);
  const maxAge = m ? Number(m[1]) : 0;
  const ready = hasInclude && hasPreload && maxAge >= 31536000;
  return owaspCheck('a02_hsts_preload', 'A02', 'high', ready ? 'pass' : 'fail',
    'max-age=' + maxAge + (hasInclude ? ' +includeSubDomains' : '') + (hasPreload ? ' +preload' : ''),
    { note: ready ? 'preload_ready' : 'preload_not_ready' });
}

/* ------------------------------------------------------------
   A03 — Injection (AKTİF; yalnızca sahiplik onayı ile).
   Güvenli, yıkıcı olmayan payloadlar: yansıma kontrolü ve
   hata mesajı kontrolü. Hiçbir veritabanı sorgusu yazılmaz,
   alert çalıştırılmaz; yalnızca yanıtın içeriğine bakılır.
   ------------------------------------------------------------ */
const XSS_PAYLOAD = '"><img src=x onerror=CyberLionTest(1)>cyberlion-xss-probe';
const SQLI_PAYLOAD = "'\" CyberLionSQLProbe";

async function a03Active(origin, consent) {
  const checks = [];
  const findings = [];

  if (!consent) {
    checks.push(owaspCheck('a03_xss_reflection', 'A03', 'high', 'skipped', null, { note: 'requires_verified_ownership' }));
    checks.push(owaspCheck('a03_sqli_error', 'A03', 'critical', 'skipped', null, { note: 'requires_verified_ownership' }));
    return { checks: checks, findings: findings };
  }

  const [xssRes, sqliRes] = await Promise.all([
    probe(origin + '?q=' + encodeURIComponent(XSS_PAYLOAD), 'GET'),
    probe(origin + '?id=' + encodeURIComponent(SQLI_PAYLOAD), 'GET')
  ]);

  /* Reflected XSS: payload aynen ve escape edilmemiş döner mi? */
  if (!xssRes.ok) {
    checks.push(owaspCheck('a03_xss_reflection', 'A03', 'high', 'skipped', null, { note: xssRes.reason }));
  } else {
    const body = xssRes.body || '';
    const reflected = body.includes(XSS_PAYLOAD);
    // Escape edilmiş yansıma (payload var ama < img ayrıştırılmış) güvenli sayılır.
    const escaped = !reflected && body.includes('CyberLionTest');
    checks.push(owaspCheck('a03_xss_reflection', 'A03', 'high',
      reflected ? 'fail' : 'pass',
      reflected ? 'unescaped_reflection' : (escaped ? 'escaped_reflection' : 'no_reflection')));
    if (reflected) {
      findings.push({
        owasp_category: 'A03',
        severity: 'high',
        title: 'Olası yansımalı XSS (reflected)',
        description: 'Sorgu parametresi yanıtta HTML escape edilmeden yansıtılıyor. Payload çalıştırılmadı; yalnızca yansıma ölçüldü.',
        evidence: '?q= payload yanıtta ham hâlde bulundu',
        fix_code: "// Tüm çıktılarda escape uygula:\n// React/Vue otomatik escape eder; şablon motorlarında filtre kullan.\n// Node (Express + EJS): <%= yerine <%= h değil, çıktı açıkta olan alanlarda\n// npm install xss\nconst xss = require('xss');\nres.send(xss(userInput));"
      });
    }
  }

  /* SQLi hata tabanlı: sunucu veritabanı hata mesajı sızdırıyor mu? */
  if (!sqliRes.ok) {
    checks.push(owaspCheck('a03_sqli_error', 'A03', 'critical', 'skipped', null, { note: sqliRes.reason }));
  } else {
    const body = (sqliRes.body || '').slice(0, MAX_PROBE_BYTES);
    const errMatch = /(SQL syntax|mysql_fetch|ORA-\d{5}|PostgreSQL.*ERROR|SQLite3?::QueryException|Warning: mysqli_)/i.exec(body);
    checks.push(owaspCheck('a03_sqli_error', 'A03', 'critical',
      errMatch ? 'fail' : 'pass', errMatch ? errMatch[0].slice(0, 60) : 'no_db_error'));
    if (errMatch) {
      findings.push({
        owasp_category: 'A03',
        severity: 'critical',
        title: 'Olası SQL enjeksiyonu (hata tabanlı)',
        description: 'Hatalı girdi karşısında sunucu ham veritabanı hata mesajı döndürüyor. Bu, hata mesajı üzerinden sorgu keşfine kapı açar.',
        evidence: 'DB hatası sızdırıldı: ' + errMatch[0].slice(0, 60),
        fix_code: "// Parametreli sorgular:\n// node-postgres\nconst { rows } = await pool.query('SELECT * FROM t WHERE id = $1', [id]);\n// PHP PDO\n$stmt = $pdo->prepare('SELECT * FROM t WHERE id = ?');\n$stmt->execute([$id]);\n// VE üretimde hata mesajlarını gizle (display_errors=Off)."
      });
    }
  }
  return { checks: checks, findings: findings };
}

/* ------------------------------------------------------------
   A05 — Security Misconfiguration ekleri (pasif, gövde analizi).
   ------------------------------------------------------------ */
function a05BodyChecks(html, headers) {
  const checks = [];
  const findings = [];

  /* Debug modu: gövdede yığın izi / framework debug çıktısı. */
  if (html === null) {
    checks.push(owaspCheck('a05_debug_mode', 'A05', 'high', 'skipped', null, { note: 'no_html_body' }));
  } else {
    const dbg = /(Traceback \(most recent call last\)|DEBUG = True|Fatal error: Uncaught|at \/app\/|stack trace|Whitelabel Error Page)/i.exec(html);
    checks.push(owaspCheck('a05_debug_mode', 'A05', 'high', dbg ? 'fail' : 'pass', dbg ? dbg[0].slice(0, 60) : null));
    if (dbg) {
      findings.push({
        owasp_category: 'A05',
        severity: 'high',
        title: 'Hata ayıklama çıktısı sızdırılıyor',
        description: 'Sayfa gövdesinde yığın izi veya debug çıktısı bulunuyor. Bu, iç yapı bilgisi sızdırır.',
        evidence: dbg[0].slice(0, 60),
        fix_code: "# Üretimde hata ayıklamayı kapat:\n# PHP: display_errors = Off, log_errors = On\n# Django: DEBUG = False\n# Express: app.set('env', 'production') + error handler"
      });
    }

    /* Dizin listesi. */
    const dirlist = /<title>Index of \//i.exec(html);
    checks.push(owaspCheck('a05_dir_listing', 'A05', 'medium', dirlist ? 'fail' : 'pass', dirlist ? 'Index of /' : null));
    if (dirlist) {
      findings.push({
        owasp_category: 'A05',
        severity: 'medium',
        title: 'Dizin listesi açık',
        description: 'Web sunucusu dizin içerik listesini gösteriyor; kaynak dosyalar keşfedilebilir.',
        evidence: '"Index of /" sayfası döndü',
        fix_code: '# nginx: autoindex off;\n# Apache: Options -Indexes'
      });
    }
  }

  /* A07 — giriş noktalarında hız sınırı imzası (bilgi amaçlı, puansız). */
  const rateHeaders = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'RateLimit-Limit']
    .some(function (h) { return headers.get(h); });
  checks.push(owaspCheck('a07_rate_limit', 'A07', 'info', 'pass',
    rateHeaders ? 'rate_limit_headers_present' : 'no_public_rate_limit_headers',
    { note: 'info_only' }));

  return { checks: checks, findings: findings };
}

/* ------------------------------------------------------------
   A06 — Vulnerable and Outdated Components (pasif).
   Script src'lerinden eski kütüphane sürümleri.
   ------------------------------------------------------------ */
const OUTDATED_LIBS = [
  { re: /jquery[.-]1\.(0|1|2|3|4|5|6|7|8|9|10|11|12)(\.|$)/i, name: 'jQuery 1.x', severity: 'medium' },
  { re: /jquery[.-]2\.(0|1|2)(\.|$)/i, name: 'jQuery 2.x', severity: 'low' },
  { re: /bootstrap[.-](3|4)\./i, name: 'Bootstrap 3/4', severity: 'low' },
  { re: /angular[.-]?1\./i, name: 'AngularJS 1.x', severity: 'medium' },
  { re: /moment(-with-locales)?\.min\.js$/i, name: 'Moment.js (bakım modunda)', severity: 'low' },
  { re: /lodash[.-](3|4\.[0-6])\./i, name: 'eski Lodash', severity: 'low' }
];

function a06OutdatedLibs(html) {
  const checks = [];
  const findings = [];
  if (html === null) {
    checks.push(owaspCheck('a06_outdated_libs', 'A06', 'medium', 'skipped', null, { note: 'no_html_body' }));
    return { checks: checks, findings: findings };
  }
  const srcs = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) srcs.push(m[1]);

  const found = [];
  OUTDATED_LIBS.forEach(function (lib) {
    srcs.forEach(function (src) {
      if (lib.re.test(src)) found.push({ lib: lib, src: src });
    });
  });

  const unique = found.filter(function (f, i) {
    return found.findIndex(function (o) { return o.lib.name === f.lib.name; }) === i;
  });

  checks.push(owaspCheck('a06_outdated_libs', 'A06', 'medium',
    unique.length ? 'fail' : 'pass',
    unique.length ? unique.map(function (u) { return u.lib.name; }).join(', ') : (srcs.length ? 'none_detected' : 'no_scripts'),
    { scriptCount: srcs.length }));

  unique.forEach(function (u) {
    findings.push({
      owasp_category: 'A06',
      severity: u.lib.severity,
      title: 'Güncelliğini yitirmiş kütüphane: ' + u.lib.name,
      description: 'Sayfada bilinen güvenlik açıkları barındıran eski bir kütüphane sürümü yükleniyor: ' + u.src.slice(0, 200),
      evidence: u.src.slice(0, 200),
      fix_code: '# ' + u.lib.name + ' sürümünü yükseltin ve değişiklik notlarını okuyun.\n# Örn. jQuery: <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>'
    });
  });
  return { checks: checks, findings: findings };
}

/* ------------------------------------------------------------
   Giriş noktası.
   ------------------------------------------------------------ */
async function runOwaspLite(context) {
  const origin = context.finalUrl.origin;
  const consent = context.consent === true;

  const [a01, a03, a05, a06] = await Promise.all([
    a01ExposedFiles(origin, consent),
    a03Active(origin, consent),
    a05BodyChecks(context.html, context.headers),
    a06OutdatedLibs(context.html)
  ]);
  const a02 = a02HstsPreload(context.headers.get('strict-transport-security'));

  const checks = [].concat(a01.checks, a02 ? [a02] : [], a03.checks, a05.checks, a06.checks);
  const findings = [].concat(a01.findings, a03.findings, a05.findings, a06.findings);

  return { checks: checks, findings: findings };
}

module.exports = { runOwaspLite, OWASP, SCANNER_LITE_VERSION: '1.0.0' };
