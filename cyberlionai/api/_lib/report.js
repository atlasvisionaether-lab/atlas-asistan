'use strict';

/**
 * Tarama kaydından PDF güvenlik raporu üretir.
 *
 * Rapor yalnızca **kaydedilmiş** tarama satırından üretilir; istemciden gelen
 * skor veya bulgu verisine güvenilmez. Kayıt gizlilik gereği ham başlık
 * değerleri içermez, bu yüzden raporda da kanıt olarak ham başlık yer almaz.
 */

const { PdfDoc, A4 } = require('./pdf.js');

const GOLD = [0.831, 0.686, 0.216];
const INK = [0.09, 0.09, 0.11];
const MUTED = [0.42, 0.44, 0.48];
const HAIR = [0.85, 0.86, 0.88];
const SEV_COLOR = {
  critical: [0.80, 0.16, 0.13],
  high: [0.85, 0.40, 0.05],
  medium: [0.72, 0.53, 0.04],
  low: [0.30, 0.42, 0.55]
};
const STATE_COLOR = { pass: [0.11, 0.47, 0.24], fail: [0.75, 0.15, 0.12], skipped: MUTED };

/* Atlanan kontrolün NEDENİ üç ayrı şey olabilir; raporda da ayrı yazılıyor:
   uygulanabilir değil (ölçülecek bir şey yok), uygulanmamış (tavsiye edilen
   katman yazılmamış), ölçülemedi (denendi, başarılamadı). Üçü de skora
   girmiyor — ayrım rapor dürüstlüğü için.

   Etiket `note` alanından türetiliyor, böylece bu değişiklikten ÖNCE kaydedilmiş
   taramaların PDF'i de doğru çıkıyor.

   Arayüzdeki eşi: index.html -> SKIP_NA / SKIP_NI.
   İkisinin aynı kalmasını tools/skiplabel-test.js sınıyor. */
const SKIP_NA = ['no_cookies', 'no_external_scripts', 'no_html', 'not_https'];
const SKIP_NI = ['not_implemented'];

function stateKey(item) {
  if (item.status !== 'skipped') return item.status;
  if (SKIP_NA.indexOf(item.note) !== -1) return 'skippedNa';
  if (SKIP_NI.indexOf(item.note) !== -1) return 'skippedNi';
  return 'skipped';
}

/* Risk eşikleri — raporda da açıkça yazılır ki skor yorumu tutarlı olsun. */
const RISK_BANDS = [
  { min: 85, key: 'low' },
  { min: 70, key: 'medium' },
  { min: 50, key: 'high' },
  { min: 0, key: 'critical' }
];

function riskOf(score) {
  if (typeof score !== 'number') return null;
  for (const band of RISK_BANDS) if (score >= band.min) return band.key;
  return 'critical';
}

const T = {
  tr: {
    title: 'GÜVENLİK RAPORU', brand: 'CYBER LION AI',
    domain: 'Taranan alan adı', date: 'Rapor tarihi',
    score: 'Güvenlik skoru', risk: 'Risk seviyesi',
    summary: 'Kontrol özeti', passed: 'Geçti', failed: 'Kaldı', skipped: 'Puan dışı',
    checksTitle: 'Kontrol sonuçları', findingsTitle: 'Bulgular ve düzeltme önerileri',
    check: 'Kontrol', severity: 'Önem', state: 'Durum',
    fix: 'Düzeltme', impact: 'Etki',
    riskNames: { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' },
    sev: { critical: 'Kritik', high: 'Yüksek', medium: 'Orta', low: 'Düşük' },
    states: { pass: 'Geçti', fail: 'Kaldı', skipped: 'Ölçülemedi',
              skippedNa: 'Uygulanabilir değil', skippedNi: 'Uygulanmamış' },
    bands: 'Eşikler: 85–100 Düşük · 70–84 Orta · 50–69 Yüksek · 0–49 Kritik',
    skippedNote: 'Puan dışı kontroller skora dahil edilmez: uygulanabilir değil (ölçülecek '
      + 'bir şey yok), uygulanmamış (tavsiye edilen ek katman) veya ölçülemedi.',
    disclaimerTitle: 'Kapsam ve sınırlar',
    disclaimer: 'Bu rapor, hedefin dışarıdan gözlemlenebilen HTTP yanıt başlıklarına ve TLS '
      + 'yapılandırmasına dayanır. Kapsamlı bir sızma testi (penetrasyon testi) değildir ve '
      + 'uygulama mantığındaki, kimlik doğrulamadaki veya sunucu içindeki zafiyetleri kapsamaz. '
      + 'Otomatik taramalar yanlış pozitif ve yanlış negatif üretebilir. Kritik sistemlerde '
      + 'otomatik taramayı düzenli uzman denetimiyle birlikte kullanın.',
    versions: 'Motor sürümü', reportVersion: 'Rapor sürümü',
    page: 'Sayfa', noFindings: 'Başarısız kontrol bulunmadı.',
    fixHeader: 'Uygulanacak yapılandırma'
  },
  en: {
    title: 'SECURITY REPORT', brand: 'CYBER LION AI',
    domain: 'Scanned domain', date: 'Report date',
    score: 'Security score', risk: 'Risk level',
    summary: 'Check summary', passed: 'Passed', failed: 'Failed', skipped: 'Not scored',
    checksTitle: 'Check results', findingsTitle: 'Findings and remediation',
    check: 'Check', severity: 'Severity', state: 'Status',
    fix: 'Fix', impact: 'Impact',
    riskNames: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
    sev: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
    states: { pass: 'Pass', fail: 'Fail', skipped: 'Not measured',
              skippedNa: 'Not applicable', skippedNi: 'Not implemented' },
    bands: 'Thresholds: 85–100 Low · 70–84 Medium · 50–69 High · 0–49 Critical',
    skippedNote: 'Checks outside the score: not applicable (nothing to measure), not '
      + 'implemented (recommended extra layer) or not measured.',
    disclaimerTitle: 'Scope and limitations',
    disclaimer: 'This report is based on externally observable HTTP response headers and TLS '
      + 'configuration of the target. It is not a full penetration test and does not cover '
      + 'application logic, authentication or server-side vulnerabilities. Automated scans can '
      + 'produce false positives and false negatives. On critical systems, pair automated '
      + 'scanning with regular expert review.',
    versions: 'Scanner version', reportVersion: 'Report version',
    page: 'Page', noFindings: 'No failed checks.',
    fixHeader: 'Configuration to apply'
  }
};

/* Kontrol adları ve düzeltmeleri — ön yüzdeki metinlerle aynı kaynak bilgi. */
const CHECKS = {
  tr: {
    https: ['HTTPS kullanımı', 'Trafiğin şifrelenmemesi, araya giren birinin veriyi okumasına ve değiştirmesine izin verir.', 'Tüm trafiği HTTPS üzerinden sunun; HTTP isteklerini 301 ile HTTPS\'e yönlendirin.'],
    hsts: ['Strict-Transport-Security', 'HSTS olmadan tarayıcı ilk isteği HTTP ile yapabilir; SSL stripping saldırısına açık kalır.', 'Strict-Transport-Security: max-age=63072000; includeSubDomains'],
    csp: ['Content-Security-Policy', 'CSP olmadan XSS açığı, sayfada istediği script\'i çalıştırabilir.', 'Content-Security-Policy: default-src \'self\'; object-src \'none\'; base-uri \'self\''],
    xframe: ['Çerçeveleme koruması', 'Sayfa başka bir sitenin iframe\'ine gömülüp clickjacking için kullanılabilir.', 'X-Frame-Options: DENY   (veya CSP frame-ancestors \'none\')'],
    nosniff: ['MIME tipi zorlaması', 'Tarayıcı içerik tipini tahmin ederek zararlı dosyayı script gibi çalıştırabilir.', 'X-Content-Type-Options: nosniff'],
    referrer: ['Referrer-Policy', 'Adres bilgisi dış sitelere sızabilir; iç yolları ve parametreleri açığa çıkarır.', 'Referrer-Policy: strict-origin-when-cross-origin'],
    permissions: ['Permissions-Policy', 'Kamera, mikrofon ve konum gibi yetenekler gereksizce açık kalır.', 'Permissions-Policy: camera=(), microphone=(), geolocation=()'],
    cookies: ['Çerez bayrakları', 'Secure/HttpOnly/SameSite olmadan oturum çerezi çalınabilir veya CSRF ile kullanılabilir.', 'Set-Cookie: ...; Secure; HttpOnly; SameSite=Lax'],
    disclosure: ['Sürüm bilgisi ifşası', 'Sunucu ve sürüm bilgisi, saldırgana bilinen açıkları hedefleme kolaylığı verir.', 'Nginx: server_tokens off;    Apache: ServerTokens Prod'],
    mixed_content: ['Karışık içerik', 'HTTPS sayfada HTTP kaynak yüklenmesi, sayfanın güvenliğini zayıflatır.', 'Sayfadaki tüm kaynakları https:// ile yükleyin.'],
    tls_protocol: ['TLS protokol sürümü', 'Eski protokoller bilinen kriptografik zayıflıklar taşır.', 'Yalnızca TLS 1.2 ve 1.3 açık kalsın.'],
    tls_cert: ['SSL sertifikası', 'Süresi dolmuş veya doğrulanamayan sertifika, kullanıcıya güvenlik uyarısı gösterir.', 'Sertifikayı yenileyin ve zincirin tam olduğundan emin olun.'],
    tls_legacy: ['Eski TLS sürümleri', 'TLS 1.0/1.1 kabul edilmesi, düşürme (downgrade) saldırılarına imkân verir.', 'Nginx: ssl_protocols TLSv1.2 TLSv1.3;    Apache: SSLProtocol -all +TLSv1.2 +TLSv1.3']
  },
  en: {
    https: ['HTTPS in use', 'Unencrypted traffic lets an interceptor read and modify data.', 'Serve all traffic over HTTPS; 301-redirect HTTP to HTTPS.'],
    hsts: ['Strict-Transport-Security', 'Without HSTS the first request may go over HTTP, allowing SSL stripping.', 'Strict-Transport-Security: max-age=63072000; includeSubDomains'],
    csp: ['Content-Security-Policy', 'Without CSP an XSS flaw can execute any script on the page.', 'Content-Security-Policy: default-src \'self\'; object-src \'none\'; base-uri \'self\''],
    xframe: ['Framing protection', 'The page can be embedded in another site\'s iframe for clickjacking.', 'X-Frame-Options: DENY   (or CSP frame-ancestors \'none\')'],
    nosniff: ['MIME type enforcement', 'The browser may sniff content type and execute a file as script.', 'X-Content-Type-Options: nosniff'],
    referrer: ['Referrer-Policy', 'Address details can leak to third parties, exposing internal paths.', 'Referrer-Policy: strict-origin-when-cross-origin'],
    permissions: ['Permissions-Policy', 'Camera, microphone and location stay needlessly available.', 'Permissions-Policy: camera=(), microphone=(), geolocation=()'],
    cookies: ['Cookie flags', 'Without Secure/HttpOnly/SameSite a session cookie can be stolen or used via CSRF.', 'Set-Cookie: ...; Secure; HttpOnly; SameSite=Lax'],
    disclosure: ['Version disclosure', 'Server and version details help an attacker target known flaws.', 'Nginx: server_tokens off;    Apache: ServerTokens Prod'],
    mixed_content: ['Mixed content', 'Loading HTTP resources on an HTTPS page weakens the page\'s security.', 'Load every resource over https://.'],
    tls_protocol: ['TLS protocol version', 'Legacy protocols carry known cryptographic weaknesses.', 'Leave only TLS 1.2 and 1.3 enabled.'],
    tls_cert: ['SSL certificate', 'An expired or untrusted certificate shows users a security warning.', 'Renew the certificate and ensure the chain is complete.'],
    tls_legacy: ['Legacy TLS versions', 'Accepting TLS 1.0/1.1 enables downgrade attacks.', 'Nginx: ssl_protocols TLSv1.2 TLSv1.3;    Apache: SSLProtocol -all +TLSv1.2 +TLSv1.3']
  }
};

const M = 48;                      // kenar boşluğu
const CONTENT_W = A4.width - 2 * M;

/**
 * Dile duyarlı büyük harf.
 *
 * JavaScript'in toUpperCase()'i 'i' harfini 'I' yapar; Türkçede doğrusu 'İ'dir
 * ve 'ı' harfinin büyüğü 'I'dır. Etiketler büyük harfle yazıldığı için bu fark
 * raporda görünür hale geliyordu ("GÜVENLIK SKORU", "RISK SEVIYESI").
 * toLocaleUpperCase('tr') ICU'ya bağlı olduğundan, dönüşüm burada açıkça
 * yapılıyor: davranış çalışma ortamından bağımsız.
 */
function upper(str, lang) {
  const s = String(str);
  if (lang !== 'tr') return s.toUpperCase();
  return s.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
}

function formatDate(iso, lang) {
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return lang === 'tr'
    ? pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC'
    : d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function buildReport(scan, lang) {
  const L = T[lang] || T.tr;
  const C = CHECKS[lang] || CHECKS.tr;
  const doc = new PdfDoc();
  let y = 0;

  /* ---- Başlık bandı ---- */
  doc.rect(0, 0, A4.width, 96, INK);
  doc.rect(0, 94, A4.width, 2, GOLD);
  doc.text(M, 44, L.brand, { size: 17, bold: true, color: GOLD });
  doc.text(M, 66, L.title, { size: 10, color: [0.75, 0.76, 0.78] });
  doc.text(A4.width - M - doc.widthOf(formatDate(scan.scanned_at, lang), 9), 66,
    formatDate(scan.scanned_at, lang), { size: 9, color: [0.65, 0.66, 0.7] });

  y = 132;

  /* ---- Alan adı ---- */
  doc.text(M, y, upper(L.domain, lang), { size: 7.5, color: MUTED });
  y += 20;
  doc.text(M, y, scan.host, { size: 19, bold: true, color: INK });
  y += 30;

  /* ---- Skor ve risk ---- */
  const risk = riskOf(scan.score);
  const riskColor = risk ? SEV_COLOR[risk === 'low' ? 'low' : risk] : MUTED;

  doc.rect(M, y, CONTENT_W, 76, [0.97, 0.97, 0.98]);
  doc.rect(M, y, 4, 76, riskColor);

  doc.text(M + 20, y + 26, upper(L.score, lang), { size: 7.5, color: MUTED });
  const scoreText = (typeof scan.score === 'number' ? scan.score : '—') + '/100';
  doc.text(M + 20, y + 56, scoreText, { size: 26, bold: true, color: riskColor });

  doc.text(M + 170, y + 26, upper(L.risk, lang), { size: 7.5, color: MUTED });
  doc.text(M + 170, y + 52, risk ? L.riskNames[risk] : '—', { size: 15, bold: true, color: riskColor });

  doc.text(M + 300, y + 26, upper(L.summary, lang), { size: 7.5, color: MUTED });
  doc.text(M + 300, y + 50,
    L.passed + ': ' + scan.checks_passed + '    ' + L.failed + ': ' + scan.checks_failed
    + '    ' + L.skipped + ': ' + scan.checks_skipped, { size: 9.5, color: INK });
  doc.text(M + 300, y + 64, L.bands, { size: 6.5, color: MUTED });

  y += 96;
  doc.text(M, y, L.skippedNote, { size: 7.5, color: MUTED });
  y += 26;

  /* ---- Kontrol tablosu ---- */
  doc.text(M, y, L.checksTitle, { size: 12, bold: true, color: INK });
  y += 16;
  doc.line(M, y, A4.width - M, y, GOLD, 1.2);
  y += 16;

  doc.text(M, y, L.check, { size: 7.5, bold: true, color: MUTED });
  doc.text(M + 300, y, L.severity, { size: 7.5, bold: true, color: MUTED });
  doc.text(M + 390, y, L.state, { size: 7.5, bold: true, color: MUTED });
  y += 6;
  doc.line(M, y, A4.width - M, y, HAIR);
  y += 16;

  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  const order = { fail: 0, pass: 1, skipped: 2 };
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = findings.slice().sort(function (a, b) {
    return (order[a.status] - order[b.status]) || (sevOrder[a.severity] - sevOrder[b.severity]);
  });

  for (const item of sorted) {
    if (y > A4.height - 70) { doc.addPage(); y = M + 10; }
    const meta = C[item.id] || [item.id, '', ''];
    doc.text(M, y, meta[0], { size: 9.5, color: INK });
    doc.text(M + 300, y, L.sev[item.severity] || item.severity, { size: 9, color: SEV_COLOR[item.severity] || MUTED });
    doc.text(M + 390, y, L.states[stateKey(item)] || item.status,
      { size: 9, bold: item.status === 'fail', color: STATE_COLOR[item.status] || MUTED });
    y += 8;
    doc.line(M, y, A4.width - M, y, [0.93, 0.93, 0.94], 0.5);
    y += 14;
  }

  /* ---- Bulgular ve düzeltmeler ---- */
  const failed = sorted.filter(function (i) { return i.status === 'fail'; });
  y += 14;
  if (y > A4.height - 140) { doc.addPage(); y = M + 10; }
  doc.text(M, y, L.findingsTitle, { size: 12, bold: true, color: INK });
  y += 16;
  doc.line(M, y, A4.width - M, y, GOLD, 1.2);
  y += 20;

  if (!failed.length) {
    doc.text(M, y, L.noFindings, { size: 9.5, color: MUTED });
    y += 20;
  }

  for (const item of failed) {
    const meta = C[item.id] || [item.id, '', ''];
    const impactLines = doc.wrap(meta[1], 9, CONTENT_W - 16);
    const fixLines = doc.wrap(meta[2], 8.5, CONTENT_W - 32);
    const blockHeight = 34 + impactLines.length * 12 + 18 + fixLines.length * 12 + 16;

    if (y + blockHeight > A4.height - 60) { doc.addPage(); y = M + 10; }

    doc.rect(M, y - 12, 3, blockHeight - 8, SEV_COLOR[item.severity] || MUTED);
    doc.text(M + 14, y, meta[0], { size: 10.5, bold: true, color: INK });
    doc.text(M + 14 + doc.widthOf(meta[0], 10.5, true) + 10, y,
      '[' + (L.sev[item.severity] || item.severity) + ']',
      { size: 8, color: SEV_COLOR[item.severity] || MUTED });
    y += 16;

    for (const line of impactLines) {
      doc.text(M + 14, y, line, { size: 9, color: [0.28, 0.29, 0.32] });
      y += 12;
    }
    y += 8;

    doc.text(M + 14, y, upper(L.fixHeader, lang), { size: 7, color: MUTED });
    y += 12;
    doc.rect(M + 14, y - 9, CONTENT_W - 14, fixLines.length * 12 + 8, [0.96, 0.96, 0.97]);
    for (const line of fixLines) {
      doc.text(M + 22, y, line, { size: 8.5, color: [0.15, 0.16, 0.18] });
      y += 12;
    }
    y += 20;
  }

  /* ---- Kapsam ve sınırlar ---- */
  if (y > A4.height - 150) { doc.addPage(); y = M + 10; }
  y += 6;
  doc.line(M, y, A4.width - M, y, HAIR);
  y += 20;
  doc.text(M, y, L.disclaimerTitle, { size: 10, bold: true, color: INK });
  y += 16;
  for (const line of doc.wrap(L.disclaimer, 8.5, CONTENT_W)) {
    doc.text(M, y, line, { size: 8.5, color: MUTED });
    y += 11;
  }

  /* ---- Alt bilgi (her sayfada) ---- */
  const total = doc.pages.length;
  doc.pages.forEach(function (page, index) {
    doc.current = page;
    doc.line(M, A4.height - 42, A4.width - M, A4.height - 42, HAIR);
    doc.text(M, A4.height - 28,
      L.versions + ': ' + (scan.scanner_version || '-') + '   ·   '
      + L.reportVersion + ': ' + (scan.report_version || '-') + '   ·   cyberlionai.com',
      { size: 7, color: MUTED });
    const pageLabel = L.page + ' ' + (index + 1) + '/' + total;
    doc.text(A4.width - M - doc.widthOf(pageLabel, 7), A4.height - 28, pageLabel, { size: 7, color: MUTED });
  });

  return doc.build();
}

/** Dosya adı: cyberlionai-security-report-<domain>-<YYYY-MM-DD>.pdf */
function reportFilename(scan) {
  const host = String(scan.host || 'site').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 60);
  const d = new Date(scan.scanned_at);
  const date = isNaN(d) ? 'tarihsiz'
    : d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  return 'cyberlionai-security-report-' + host + '-' + date + '.pdf';
}

module.exports = { buildReport, reportFilename, riskOf, RISK_BANDS };
