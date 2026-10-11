'use strict';
/**
 * OWASP PDF raporunu ve kanıt maskelemesini sınar. Ağdan bağımsız.
 *
 *   node tools/owasp-report-test.js
 *
 * NEDEN
 *
 * Rapor müşterinin eline giden, e-postayla iletilen bir dosya. İki şey
 * sınanıyor:
 *
 *   1. KANIT MASKELEME. Kanıt satırı hedefin çözülmüş IP adresini
 *      taşıyabiliyor; PDF'e tam adres yazmak gereksiz bir yayma.
 *      Maskeleme fazla hevesli de olmamalı: sürüm numarasını ("nginx 1.18.0.1")
 *      ya da zaman damgasını bozmamalı, yoksa kanıt okunmaz hale gelir.
 *   2. PDF'in GERÇEKTEN üretildiği: geçerli bir PDF başlığı/sonu, tek
 *      sayfaya sığmayan bulgu listesinde sayfa kırılması ve Türkçe
 *      karakterlerin yazıcıyı patlatmaması (gömülü TrueType yolu).
 */

const { buildOwaspReport, owaspReportFilename, maskIps } = require('../api/_lib/report-owasp.js');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen)
              + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

console.log('OWASP raporu ve kanıt maskeleme');

/* ---- 1. Maskeleme ---- */
sina('IPv4 son iki sekizli maskeleniyor',
  maskIps('resolved=203.0.113.45'), 'resolved=203.0.x.x');
sina('aynı satırdaki iki adres de maskeleniyor',
  maskIps('a=10.1.2.3 b=192.168.44.9'), 'a=10.1.x.x b=192.168.x.x');
/* Ürün adına bitişik sürüm korunuyor; tek başına duran dört parçalı sayı
   ise maskeleniyor. İkisi arasındaki seçim report-owasp.js'te gerekçeli:
   şekille ayırt edilemiyorlar ve gizlilik kazanıyor. */
sina('ürüne bitişik sürüm numarası korunuyor',
  maskIps('nginx/1.18.0.1 sürümü'), 'nginx/1.18.0.1 sürümü');
sina('v öneki ile yazılan sürüm korunuyor',
  maskIps('v1.18.0.1'), 'v1.18.0.1');
sina('tek başına duran dört parçalı sayı maskeleniyor (gizlilik kazanıyor)',
  maskIps('nginx 1.18.0.1 sürümü'), 'nginx 1.18.x.x sürümü');
sina('daha uzun diziden parça koparılmıyor',
  maskIps('seq 1.2.3.4.5'), 'seq 1.2.3.4.5');
sina('255 üstü sekizli IP sayılmıyor',
  maskIps('build 999.1.2.3'), 'build 999.1.2.3');
sina('zaman damgası bozulmuyor',
  maskIps('fixedAt=2026-10-01T19:47:11.000Z'), 'fixedAt=2026-10-01T19:47:11.000Z');
sina('IPv6 kısaltılıyor',
  maskIps('addr=2a03:2880:f12f:83:face:b00c:0:25de'), 'addr=2a03:…:x');
sina('IP içermeyen kanıt aynı kalıyor',
  maskIps('zone=ornek.com; ruleId=abc123'), 'zone=ornek.com; ruleId=abc123');
sina('boş kanıt boş dönüyor', maskIps(null), '');

/* ---- 2. PDF üretimi ---- */
function fixture(findingCount) {
  const groups = [];
  const kategoriler = ['A01', 'A02', 'A05', 'A07', 'other'];
  kategoriler.forEach(function (cat, gi) {
    const findings = [];
    for (let i = 0; i < findingCount; i++) {
      findings.push({
        id: 'f' + gi + i,
        owaspCategory: cat === 'other' ? null : cat,
        severity: ['critical', 'high', 'medium', 'low', 'info'][i % 5],
        /* Türkçe karakterler bilerek: ı, İ, ş, ğ, ç, ö, ü yerleşik PDF
           fontlarında yok; gömülü font yolu çalışmıyorsa burada patlar. */
        title: 'Başlık ışığı — şifreleme gücü çok düşük (' + cat + '/' + i + ')',
        description: 'Açıklama: güvenlik başlığı eksik olduğu için tarayıcı '
          + 'içeriği güvenilmeyen bir kaynaktan yükleyebilir. '.repeat(3),
        evidence: 'observed=203.0.113.' + (10 + i) + '; header=missing',
        fixCode: 'add_header Strict-Transport-Security\n  "max-age=31536000" always;\n'
      });
    }
    groups.push({ category: cat, findings: findings });
  });

  return {
    job: {
      id: '11111111-2222-3333-4444-555555555555',
      domain: 'örnek-şirket.com.tr',
      url: 'https://örnek-şirket.com.tr',
      status: 'completed',
      score: 58,
      scannerMode: 'passive',
      country: 'TR',
      createdAt: '2026-10-01T09:30:00.000Z',
      completedAt: '2026-10-01T09:30:12.000Z',
      result: null
    },
    severityCounts: { critical: 5, high: 5, medium: 5, low: 5, info: 5 },
    totalFindings: findingCount * kategoriler.length,
    groups: groups
  };
}

const pdf = buildOwaspReport(fixture(5), 'tr');
sina('PDF üretildi (Buffer)', Buffer.isBuffer(pdf), true);
sina('PDF başlığı doğru', pdf.subarray(0, 8).toString('latin1'), '%PDF-1.7');
sina('PDF sonu doğru', pdf.subarray(-7).toString('latin1').trim(), '%%EOF');

/* Çok bulgu tek sayfaya sığmaz: birden fazla sayfa nesnesi beklenir.
   /Type /Page sayısı sayfa sayısıdır (/Pages ayrı yazılıyor). */
const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
sina('25 bulgu birden fazla sayfaya bölündü', pageCount > 1, true);

/* Boş bulgu listesi de rapor üretmeli: "bulgu yok" bir sonuçtur. */
const bos = buildOwaspReport({
  job: fixture(0).job, severityCounts: {}, totalFindings: 0, groups: []
}, 'en');
sina('bulgusuz rapor da üretiliyor', Buffer.isBuffer(bos) && bos.length > 1000, true);

/* Skoru olmayan (başarısız) tarama raporu da patlamamalı. */
const skorsuz = fixture(1);
skorsuz.job.score = null;
sina('skorsuz tarama raporu üretiliyor',
  Buffer.isBuffer(buildOwaspReport(skorsuz, 'tr')), true);

sina('dosya adı alan adını ve tarihi taşıyor',
  owaspReportFilename(fixture(1).job),
  'cyberlionai-owasp-report-rnek-irket.com.tr-2026-10-01.pdf');

console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
process.exit(hata === 0 ? 0 : 1);
