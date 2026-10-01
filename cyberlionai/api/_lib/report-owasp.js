'use strict';

/**
 * OWASP kategorilerine göre gruplanmış PDF raporu (`scan_jobs` kaydından).
 *
 * `report.js` ile ilişkisi: o dosya eski `cl_scans` kaydından kontrol listesi
 * biçiminde rapor üretiyor ve ana sayfadaki akış onu kullanıyor. Bu dosya
 * OWASP Lite şemasındaki iş + bulgu kayıtlarından panel raporunu üretiyor.
 * İkisi aynı PDF yazıcısını (`pdf.js`) ve aynı risk bantlarını paylaşıyor.
 *
 * NEDEN jsPDF DEĞİL
 *
 * Türkçe karakterler (ı, İ, ş, ğ) PDF'in yerleşik base-14 fontlarının WinAnsi
 * kodlamasında yok; doğru görünmeleri için gerçek bir TrueType font gömmek
 * gerekiyor. `pdf.js` bunu zaten yapıyor (Identity-H / CIDFontType2) ve depo
 * bağımlılıksız. jsPDF eklemek hem bir bağımlılık hem de aynı font işini
 * baştan çözmek demekti; eldeki yazıcı genişletildi.
 *
 * Rapor YALNIZCA veritabanındaki kayıttan üretiliyor; istemciden gelen skor,
 * bulgu ya da metne güvenilmiyor.
 */

const { PdfDoc, A4 } = require('./pdf.js');
const { riskOf } = require('./report.js');

const GOLD = [0.831, 0.686, 0.216];
const INK = [0.09, 0.09, 0.11];
const MUTED = [0.42, 0.44, 0.48];
const HAIR = [0.85, 0.86, 0.88];
const CODE_BG = [0.96, 0.96, 0.97];

const SEV_COLOR = {
  critical: [0.80, 0.16, 0.13],
  high: [0.85, 0.40, 0.05],
  medium: [0.72, 0.53, 0.04],
  low: [0.30, 0.42, 0.55],
  info: [0.42, 0.44, 0.48]
};

const MARGIN = 46;
const CONTENT_WIDTH = A4.width - MARGIN * 2;
const BOTTOM = A4.height - 56;

/* OWASP Top 10 (2021) başlıkları. Kategori kodunu tek başına yazmak
   ("A05") müşteriye bir şey anlatmıyor; raporun okunur olması için
   kategorinin adı da gerekiyor. */
const OWASP_NAMES = {
  tr: {
    A01: 'Bozuk Erişim Denetimi',
    A02: 'Kriptografik Hatalar',
    A03: 'Enjeksiyon',
    A04: 'Güvensiz Tasarım',
    A05: 'Hatalı Güvenlik Yapılandırması',
    A06: 'Güncelliğini Yitirmiş Bileşenler',
    A07: 'Kimlik Doğrulama Hataları',
    A08: 'Yazılım ve Veri Bütünlüğü Hataları',
    A09: 'Günlükleme ve İzleme Eksikleri',
    A10: 'Sunucu Taraflı İstek Sahteciliği',
    other: 'Kategorilendirilmemiş bulgular'
  },
  en: {
    A01: 'Broken Access Control',
    A02: 'Cryptographic Failures',
    A03: 'Injection',
    A04: 'Insecure Design',
    A05: 'Security Misconfiguration',
    A06: 'Vulnerable and Outdated Components',
    A07: 'Identification and Authentication Failures',
    A08: 'Software and Data Integrity Failures',
    A09: 'Security Logging and Monitoring Failures',
    A10: 'Server-Side Request Forgery',
    other: 'Uncategorised findings'
  }
};

const T = {
  tr: {
    brand: 'CYBER LION AI',
    title: 'OWASP GÜVENLİK RAPORU',
    domain: 'Taranan alan adı',
    date: 'Rapor tarihi',
    scanned: 'Tarama tarihi',
    score: 'Güvenlik skoru',
    risk: 'Risk seviyesi',
    mode: 'Tarama kipi',
    modePassive: 'pasif (yalnızca gözlem)',
    modeActive: 'etkin (onaylı)',
    summary: 'Bulgu özeti',
    none: 'Bu taramada kayıtlı bulgu yok.',
    evidence: 'Kanıt',
    fix: 'Düzeltme',
    severity: { critical: 'kritik', high: 'yüksek', medium: 'orta', low: 'düşük', info: 'bilgi' },
    riskLabel: { low: 'düşük', medium: 'orta', high: 'yüksek', critical: 'kritik' },
    footer: 'Bu rapor yalnızca kaydedilmiş tarama verisinden üretilmiştir.',
    maskNote: 'Kanıt satırlarındaki IP adresleri maskelenmiştir.',
    page: 'Sayfa'
  },
  en: {
    brand: 'CYBER LION AI',
    title: 'OWASP SECURITY REPORT',
    domain: 'Scanned domain',
    date: 'Report date',
    scanned: 'Scan date',
    score: 'Security score',
    risk: 'Risk level',
    mode: 'Scan mode',
    modePassive: 'passive (observation only)',
    modeActive: 'active (consented)',
    summary: 'Findings summary',
    none: 'No findings were recorded for this scan.',
    evidence: 'Evidence',
    fix: 'Remediation',
    severity: { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info' },
    riskLabel: { low: 'low', medium: 'medium', high: 'high', critical: 'critical' },
    footer: 'This report is generated solely from stored scan data.',
    maskNote: 'IP addresses in evidence lines are masked.',
    page: 'Page'
  }
};

/**
 * Kanıt metnindeki IP adreslerini maskeler.
 *
 * NEDEN: kanıt satırı hedefin çözülmüş adresini taşıyabiliyor. Rapor PDF'i
 * müşteri tarafında dolaşan, e-postayla iletilen bir dosya; altyapı adresini
 * oraya tam haliyle yazmak gereksiz bir yayma. Ağ bloğu teşhis için yeterli,
 * tam adres değil.
 *
 * IPv4'te son iki sekizli, IPv6'da ilk bloktan sonrası düşürülüyor. Maskeleme
 * metnin KALANINI bozmuyor: kanıt satırının biçimi aynı kalıyor.
 *
 * DÖRT PARÇALI SÜRÜM NUMARASI SORUNU
 *
 * "1.18.0.1" bir IPv4 adresinden ŞEKİLLE ayırt edilemez ve A06 (güncelliğini
 * yitirmiş bileşenler) kanıtlarında sürüm numarası geçiyor. İki yanlıştan
 * birini seçmek gerekiyordu: sürüm numarasını bozmak mı, adresi sızdırmak mı.
 *
 * Seçim: gizlilik kazanıyor, ama yaygın sürüm biçimi korunuyor. Ürün adına
 * bitişik yazılan sürümler ("nginx/1.18.0.1", "v1.18.0.1") maskelenmiyor,
 * çünkü onların önünde harf ya da eğik çizgi var ve bir IP adresi kanıt
 * satırında öyle yazılmıyor. Tek başına duran dört parçalı sayı ise
 * maskeleniyor — okunurluğu azaltıyor, ama yanlış tarafa düşmek adresi
 * yayınlamak olurdu. 0-255 dışındaki sekizli zaten IP olamaz.
 */
function maskIps(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    /* Önündeki harf / eğik çizgi / rakam / nokta dışlanıyor: hem
       "nginx/1.18.0.1" korunuyor hem "1.2.3.4.5" gibi daha uzun bir dizinin
       içinden parça koparılmıyor. */
    .replace(/(?<![A-Za-z\/\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g, function (m, a, b, c, d) {
      const gecerli = [a, b, c, d].every(function (p) { return Number(p) <= 255; });
      return gecerli ? a + '.' + b + '.x.x' : m;
    })
    .replace(/\b([0-9a-f]{1,4}):(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi, function (m, first) {
      return first + ':…:x';
    });
}

/** `fix_code` satır sonlarını koruyarak, kutuya sığacak satırlara böler. */
function codeLines(doc, code, size, maxWidth) {
  const out = [];
  String(code).split(/\r?\n/).forEach(function (raw) {
    if (!raw.trim()) { out.push(''); return; }
    /* Girintisi olan satırlar kodun anlamını taşıyor; `wrap` boşlukları
       yiyeceği için baştaki boşluk ayrı tutuluyor. */
    const indent = (raw.match(/^\s*/) || [''])[0].replace(/\t/g, '  ');
    const wrapped = doc.wrap(raw.trim(), size, maxWidth - doc.widthOf(indent, size, false));
    wrapped.forEach(function (line, i) { out.push((i === 0 ? indent : indent + '  ') + line); });
  });
  return out;
}

function fmtDate(iso, lang) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const ymd = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  return ymd + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC'
    + (lang === 'tr' ? '' : '');
}

/**
 * @param {object} detail  db.getJobWithFindings() çıktısı
 * @param {'tr'|'en'} lang
 * @returns {Buffer} PDF
 */
function buildOwaspReport(detail, lang) {
  const L = T[lang === 'en' ? 'en' : 'tr'];
  const names = OWASP_NAMES[lang === 'en' ? 'en' : 'tr'];
  const job = detail.job;
  const doc = new PdfDoc();

  let y = MARGIN;

  /* Sayfa taşması tek yerden yönetiliyor: her yazımdan önce gereken yüksekliği
     bildirip gerekirse yeni sayfaya geçiyoruz. Elle sayfa kırmak, bir bulgunun
     başlığını bir sayfada düzeltmesini öbüründe bırakıyordu. */
  function need(height) {
    if (y + height <= BOTTOM) return;
    doc.addPage();
    y = MARGIN;
  }

  /* ---- Başlık bandı ---- */
  doc.rect(0, 0, A4.width, 4, GOLD);
  doc.text(MARGIN, y + 12, L.brand, { size: 9, bold: true, color: GOLD });
  doc.text(MARGIN, y + 34, L.title, { size: 17, bold: true, color: INK });
  y += 50;
  doc.line(MARGIN, y, A4.width - MARGIN, y, HAIR, 0.8);
  y += 20;

  /* ---- Künye ---- */
  const risk = riskOf(job.score);
  const rows = [
    [L.domain, String(job.domain || '—')],
    [L.scanned, fmtDate(job.createdAt, lang)],
    [L.date, fmtDate(new Date().toISOString(), lang)],
    [L.score, typeof job.score === 'number' ? String(job.score) + ' / 100' : '—'],
    [L.risk, risk ? L.riskLabel[risk] : '—'],
    [L.mode, job.scannerMode === 'active' ? L.modeActive : L.modePassive]
  ];
  rows.forEach(function (r) {
    need(16);
    doc.text(MARGIN, y, r[0], { size: 9, color: MUTED });
    doc.text(MARGIN + 150, y, r[1], { size: 9, bold: true, color: INK });
    y += 16;
  });

  y += 10;

  /* ---- Bulgu özeti: önem derecesine göre sayılar ---- */
  need(40);
  doc.text(MARGIN, y, L.summary, { size: 11, bold: true, color: INK });
  y += 18;

  const counts = detail.severityCounts || {};
  let x = MARGIN;
  ['critical', 'high', 'medium', 'low', 'info'].forEach(function (sev) {
    const label = L.severity[sev] + ': ' + (counts[sev] || 0);
    const w = doc.widthOf(label, 9, true) + 16;
    if (x + w > A4.width - MARGIN) { x = MARGIN; y += 22; need(22); }
    doc.rect(x, y - 9, w, 15, SEV_COLOR[sev]);
    doc.text(x + 8, y + 2, label, { size: 9, bold: true, color: [1, 1, 1] });
    x += w + 8;
  });
  y += 30;

  /* ---- Bulgu yok ---- */
  if (!detail.totalFindings) {
    need(20);
    doc.text(MARGIN, y, L.none, { size: 10, color: MUTED });
    y += 20;
  }

  /* ---- OWASP kategorileri ---- */
  (detail.groups || []).forEach(function (group) {
    const heading = (group.category === 'other' ? '' : group.category + ' — ')
      + (names[group.category] || group.category);

    need(34);
    doc.rect(MARGIN, y - 10, 3, 16, GOLD);
    doc.text(MARGIN + 11, y + 2, heading, { size: 11, bold: true, color: INK });
    y += 22;

    group.findings.forEach(function (f) {
      const sevColor = SEV_COLOR[f.severity] || MUTED;
      const titleLines = doc.wrap(String(f.title || ''), 10, CONTENT_WIDTH - 70, true);

      need(titleLines.length * 14 + 22);

      /* Önem etiketi başlığın SOLUNDA sabit genişlikte: bulgular arasında
         gözle tarama yapılabilsin. */
      const sevText = L.severity[f.severity] || f.severity;
      doc.rect(MARGIN, y - 9, 56, 14, sevColor);
      doc.text(MARGIN + 5, y + 1, sevText, { size: 8, bold: true, color: [1, 1, 1] });

      titleLines.forEach(function (line, i) {
        doc.text(MARGIN + 66, y + 1 + i * 13, line, { size: 10, bold: true, color: INK });
      });
      y += Math.max(titleLines.length * 13, 14) + 8;

      if (f.description) {
        const lines = doc.wrap(String(f.description), 9, CONTENT_WIDTH - 66);
        lines.forEach(function (line) {
          need(12);
          doc.text(MARGIN + 66, y, line, { size: 9, color: INK });
          y += 12;
        });
        y += 4;
      }

      if (f.evidence) {
        const masked = maskIps(String(f.evidence));
        const lines = doc.wrap(masked, 8.5, CONTENT_WIDTH - 66);
        need(12);
        doc.text(MARGIN + 66, y, L.evidence, { size: 8, bold: true, color: MUTED });
        y += 12;
        lines.forEach(function (line) {
          need(11);
          doc.text(MARGIN + 66, y, line, { size: 8.5, color: MUTED });
          y += 11;
        });
        y += 4;
      }

      if (f.fixCode) {
        const size = 8.5;
        const boxWidth = CONTENT_WIDTH - 66;
        const lines = codeLines(doc, f.fixCode, size, boxWidth - 16);
        need(14);
        doc.text(MARGIN + 66, y, L.fix, { size: 8, bold: true, color: MUTED });
        y += 12;
        /* Kutu, içine sığacak kadar satırla birlikte TEK parça çiziliyor;
           sığmıyorsa satır satır bölünüyor ki arka plan yarım kalmasın. */
        lines.forEach(function (line) {
          need(12);
          doc.rect(MARGIN + 66, y - 8, boxWidth, 12, CODE_BG);
          doc.text(MARGIN + 74, y, line, { size: size, color: INK });
          y += 12;
        });
        y += 6;
      }

      need(10);
      doc.line(MARGIN + 66, y - 2, A4.width - MARGIN, y - 2, HAIR, 0.5);
      y += 10;
    });

    y += 6;
  });

  /* ---- Alt not ---- */
  need(28);
  y = Math.max(y, BOTTOM - 10);
  doc.line(MARGIN, y, A4.width - MARGIN, y, HAIR, 0.6);
  doc.text(MARGIN, y + 13, L.footer + ' ' + L.maskNote, { size: 7.5, color: MUTED });

  return doc.build();
}

function owaspReportFilename(job) {
  const host = String(job.domain || 'site').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 60);
  const d = new Date(job.createdAt);
  const date = isNaN(d.getTime()) ? 'tarihsiz'
    : d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  return 'cyberlionai-owasp-report-' + host + '-' + date + '.pdf';
}

module.exports = { buildOwaspReport, owaspReportFilename, maskIps, OWASP_NAMES };
