'use strict';

/**
 * AI analist raporunun PDF'i (`ai_reports` kaydından).
 *
 * `report-owasp.js` ile ilişkisi: o dosya kontrol kontrol tüm bulguları
 * listeliyor — teknik okuyucunun raporu. Bu dosya aynı taramanın ANLATIMINI
 * basıyor: risk seviyesi, puan, Türkçe özet ve önce yapılacak üç iş. Müşteriye
 * e-postayla gidecek olan, WORKFLOW 3'ün Storage'a koyduğu kopya bu.
 *
 * İkisi aynı yazıcıyı (`pdf.js`), aynı renkleri ve aynı risk bantlarını
 * paylaşıyor; ikinci bir PDF kütüphanesi girmiyor.
 *
 * GÖSTERİLEN PUAN MOTORUN PUANI. `scanner_score` basılıyor, modelin kendi
 * puanı değil (bkz. docs/ai-analyst.md). Modelin puanı rapora HİÇ girmiyor:
 * müşterinin elindeki kâğıtta iki farklı sayı olması, hangisinin ölçüm
 * olduğunu belirsizleştirirdi.
 *
 * Rapor YALNIZCA veritabanındaki kayıttan üretiliyor. Model metni güvenilmez
 * veri olarak basılıyor: uzunluk sınırlı, kontrol karakterleri atılıyor
 * (`aianalyst.dogrula` zaten daraltıyor, burada ikinci kapı).
 */

const { PdfDoc, A4 } = require('./pdf.js');
const { maskIps } = require('./report-owasp.js');

const GOLD = [0.831, 0.686, 0.216];
const INK = [0.09, 0.09, 0.11];
const MUTED = [0.42, 0.44, 0.48];
const HAIR = [0.85, 0.86, 0.88];
const CARD_BG = [0.97, 0.97, 0.98];

/* Risk renkleri `report-owasp.js`'in önem derecesi renkleriyle AYNI aileden:
   müşteri iki raporu yan yana koyduğunda kırmızı iki belgede aynı şeyi
   anlatmalı. */
const RISK_COLOR = {
  low: [0.18, 0.49, 0.30],
  medium: [0.72, 0.53, 0.04],
  high: [0.85, 0.40, 0.05],
  critical: [0.80, 0.16, 0.13]
};

const RISK_LABEL = {
  tr: { low: 'DÜŞÜK RİSK', medium: 'ORTA RİSK', high: 'YÜKSEK RİSK', critical: 'KRİTİK RİSK' },
  en: { low: 'LOW RISK', medium: 'MEDIUM RISK', high: 'HIGH RISK', critical: 'CRITICAL RISK' }
};

const T = {
  tr: {
    brand: 'CyberLion AI',
    title: 'Güvenlik Değerlendirmesi',
    domain: 'Alan adı',
    date: 'Rapor tarihi',
    score: 'Güvenlik puanı',
    summaryHead: 'Durum özeti',
    actionsHead: 'Önce bunları yapın',
    findingsHead: 'Öne çıkan bulgular',
    noActions: 'Öncelikli bir aksiyon üretilmedi.',
    footer: 'Bu rapor otomatik tarama sonuçlarının özetidir; sızma testi yerine geçmez.',
    scoreNote: 'Puan, tarayıcı motorlarının ölçümünden gelir.'
  },
  en: {
    brand: 'CyberLion AI',
    title: 'Security Assessment',
    domain: 'Domain',
    date: 'Report date',
    score: 'Security score',
    summaryHead: 'Summary',
    actionsHead: 'Do these first',
    findingsHead: 'Key findings',
    noActions: 'No priority action was produced.',
    footer: 'This report summarises automated scan results; it is not a penetration test.',
    scoreNote: 'The score comes from the scanner engines.'
  }
};

const MARGIN = 46;
const CONTENT_WIDTH = A4.width - MARGIN * 2;
const BOTTOM = A4.height - 56;

/* Spesifikasyon "3 aksiyon" diyor. Daha fazlası basılmıyor: öncelik listesi
   on madde olduğunda öncelik olmaktan çıkıyor. */
const MAX_ACTIONS = 3;
const MAX_FINDINGS = 5;

/** Model metni: kontrol karakterleri atılır, uzunluk kırpılır, IP maskelenir. */
function temiz(metin, enCok) {
  const s = (metin === null || metin === undefined ? '' : String(metin))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const kirpik = s.length > enCok ? s.slice(0, enCok - 1) + '…' : s;
  return maskIps(kirpik);
}

/** Bulgu ya da öneri, dizgeye indirilir: model ikisini de nesne döndürebiliyor. */
function maddeMetni(m) {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    const bas = m.title || m.name || m.id || '';
    const aciklama = m.description || m.detail || m.recommendation || '';
    return [bas, aciklama].filter(Boolean).join(' — ');
  }
  return '';
}

function fmtDate(iso, lang) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return '—';
  const iki = function (n) { return n < 10 ? '0' + n : String(n); };
  const g = iki(d.getUTCDate()), a = iki(d.getUTCMonth() + 1), y = d.getUTCFullYear();
  return lang === 'en' ? y + '-' + a + '-' + g : g + '.' + a + '.' + y;
}

/**
 * @param {object} rapor `ai_reports` satırı (risk_level, scanner_score,
 *   summary_tr, findings, recommendations, domain, created_at)
 * @param {'tr'|'en'} lang
 * @returns {Buffer}
 */
function buildAiReport(rapor, lang) {
  const dil = lang === 'en' ? 'en' : 'tr';
  const L = T[dil];
  const r = rapor || {};
  const doc = new PdfDoc();
  let y = MARGIN;

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
  y += 22;

  /* ---- Risk bandı + puan ---- */
  const seviye = RISK_COLOR[r.risk_level] ? r.risk_level : null;
  const etiket = seviye ? RISK_LABEL[dil][seviye] : '—';
  const bantW = doc.widthOf(etiket, 11, true) + 24;
  need(30);
  doc.rect(MARGIN, y - 11, bantW, 20, seviye ? RISK_COLOR[seviye] : MUTED);
  doc.text(MARGIN + 12, y + 3, etiket, { size: 11, bold: true, color: [1, 1, 1] });

  /* Puan motorun puanı: `scanner_score`. Modelin puanı basılmıyor. */
  const puan = typeof r.scanner_score === 'number' ? String(r.scanner_score) + ' / 100' : '—';
  doc.text(MARGIN + bantW + 20, y + 3, L.score + ': ' + puan, { size: 11, bold: true, color: INK });
  y += 30;

  doc.text(MARGIN, y, L.scoreNote, { size: 8, color: MUTED });
  y += 20;

  /* ---- Künye ---- */
  [[L.domain, temiz(r.domain, 253) || '—'],
   [L.date, fmtDate(r.created_at, dil)]].forEach(function (satir) {
    need(16);
    doc.text(MARGIN, y, satir[0], { size: 9, color: MUTED });
    doc.text(MARGIN + 150, y, satir[1], { size: 9, bold: true, color: INK });
    y += 16;
  });
  y += 14;

  /* ---- Türkçe özet ---- */
  const ozet = temiz(r.summary_tr || r.summary, 1200);
  if (ozet) {
    need(26);
    doc.text(MARGIN, y, L.summaryHead, { size: 11, bold: true, color: INK });
    y += 18;
    doc.wrap(ozet, 10, CONTENT_WIDTH - 20).forEach(function (satir) {
      need(15);
      doc.text(MARGIN + 10, y, satir, { size: 10, color: INK });
      y += 15;
    });
    y += 14;
  }

  /* ---- Üç aksiyon ---- */
  const aksiyonlar = (Array.isArray(r.recommendations) ? r.recommendations : [])
    .map(maddeMetni).map(function (m) { return temiz(m, 300); })
    .filter(Boolean).slice(0, MAX_ACTIONS);

  need(26);
  doc.text(MARGIN, y, L.actionsHead, { size: 11, bold: true, color: INK });
  y += 20;

  if (!aksiyonlar.length) {
    need(16);
    doc.text(MARGIN + 10, y, L.noActions, { size: 10, color: MUTED });
    y += 16;
  } else {
    aksiyonlar.forEach(function (metin, i) {
      const satirlar = doc.wrap(metin, 10, CONTENT_WIDTH - 48);
      const yukseklik = satirlar.length * 15 + 14;
      need(yukseklik);
      doc.rect(MARGIN, y - 11, CONTENT_WIDTH, yukseklik, CARD_BG);
      doc.rect(MARGIN, y - 11, 3, yukseklik, GOLD);
      doc.text(MARGIN + 14, y + 2, String(i + 1) + '.', { size: 10, bold: true, color: GOLD });
      satirlar.forEach(function (satir, j) {
        doc.text(MARGIN + 34, y + 2 + j * 15, satir, { size: 10, color: INK });
      });
      y += yukseklik + 8;
    });
  }
  y += 10;

  /* ---- Öne çıkan bulgular ---- */
  const bulgular = (Array.isArray(r.findings) ? r.findings : [])
    .map(maddeMetni).map(function (m) { return temiz(m, 300); })
    .filter(Boolean).slice(0, MAX_FINDINGS);

  if (bulgular.length) {
    need(26);
    doc.text(MARGIN, y, L.findingsHead, { size: 11, bold: true, color: INK });
    y += 18;
    bulgular.forEach(function (metin) {
      const satirlar = doc.wrap(metin, 10, CONTENT_WIDTH - 24);
      need(satirlar.length * 15 + 4);
      doc.text(MARGIN + 6, y, '•', { size: 10, color: GOLD });
      satirlar.forEach(function (satir, j) {
        doc.text(MARGIN + 20, y + j * 15, satir, { size: 10, color: INK });
      });
      y += satirlar.length * 15 + 4;
    });
    y += 10;
  }

  /* ---- Alt not ---- */
  need(24);
  doc.line(MARGIN, y, A4.width - MARGIN, y, HAIR, 0.8);
  y += 14;
  doc.wrap(L.footer, 8, CONTENT_WIDTH).forEach(function (satir) {
    doc.text(MARGIN, y, satir, { size: 8, color: MUTED });
    y += 11;
  });

  return doc.build();
}

/** `cyberlion-ai-<alan>-<tarih>.pdf`; alan adı dosya adı için sadeleştirilir. */
function aiReportFilename(rapor) {
  const alan = String((rapor && rapor.domain) || 'rapor')
    .toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-').slice(0, 60);
  const t = new Date().toISOString().slice(0, 10);
  return 'cyberlion-ai-' + alan + '-' + t + '.pdf';
}

/**
 * Storage içindeki yol. Aynı iş için aynı yol: yeniden üretim üzerine yazıyor,
 * kova her denemede bir kopya daha biriktirmiyor.
 */
function aiReportStorageKey(jobId) {
  return 'ai/' + String(jobId) + '.pdf';
}

module.exports = {
  buildAiReport, aiReportFilename, aiReportStorageKey,
  temiz, maddeMetni, RISK_COLOR, MAX_ACTIONS, MAX_FINDINGS
};
