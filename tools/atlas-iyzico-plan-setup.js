'use strict';

/**
 * iyzico'da "Atlas Asistan" ürünü + aylık fiyat planlarını oluşturur ve
 * REFERANS KODLARINI yazar (atlasasistan.com /api/atlas-checkout için).
 *
 *   IYZICO_API_KEY=… IYZICO_SECRET_KEY=… IYZICO_BASE_URL=https://sandbox-api.iyzipay.com \
 *   CONFIRM=evet node tools/atlas-iyzico-plan-setup.js
 *
 * cyberlionai/tools/iyzico-plan-setup.js ile aynı kurallar:
 *   - Anahtarlar env'den; basılmaz, dosyaya yazılmaz.
 *   - Varsayılan yalnız SANDBOX; canlı için CONFIRM=evet-canli.
 *   - CONFIRM yoksa hiçbir çağrı yapılmaz, ne yapacağını yazar.
 *   - Fiyatlar api/_atlas/plans.js'ten OKUNUR (elle yazılmaz).
 *   - Tekrar koşmak YENİ referanslar üretir; çıktıyı env'e yazmak koşunun parçası.
 *
 * Planlar: Standart ve Pro (formdan satılır) + Başlangıç ve VIP'in aylık
 * ücreti (teslimden sonra ayrı bağlantıyla başlatılır; formda kullanılmaz).
 */

const iyzico = require('../cyberlionai/api/_lib/iyzico.js');
const { PLANS } = require('../api/_atlas/plans.js');

const CONFIRM = process.env.CONFIRM || '';
const URUN_ADI = process.env.IYZICO_PRODUCT_NAME || 'Atlas Asistan';

const PLANLAR = [
  { ad: 'Atlas Standart Asistan (aylık)', fiyat: PLANS.standart.amountTry, env: PLANS.standart.refEnv },
  { ad: 'Atlas Pro Asistan (aylık)', fiyat: PLANS.pro.amountTry, env: PLANS.pro.refEnv },
  { ad: 'Atlas Dijital Başlangıç (aylık)', fiyat: PLANS.starter.monthlyTry, env: PLANS.starter.monthlyRefEnv },
  { ad: 'Atlas VIP Klinik (aylık)', fiyat: PLANS.vip.monthlyTry, env: PLANS.vip.monthlyRefEnv }
];

function referansOf(data) {
  const r = data && (data.referenceCode || data.pricingPlanReferenceCode || data.productReferenceCode);
  return typeof r === 'string' && r.trim() ? r.trim() : null;
}

function yaz(s) { process.stdout.write(s + '\n'); }
function hata(r) { return r.reason + (r.errorCode ? ' (errorCode=' + r.errorCode + ')' : ''); }

(async function () {
  yaz('iyzico: Atlas Asistan ürün + fiyat planları');
  if (!iyzico.isConfigured()) {
    yaz('\nIYZICO_API_KEY, IYZICO_SECRET_KEY ve IYZICO_BASE_URL gerekli (iyzico sandbox panelinden).');
    process.exit(2);
  }
  const ortam = iyzico.environmentName();
  yaz('Ortam : ' + ortam + '\nÜrün  : ' + URUN_ADI);
  PLANLAR.forEach(function (p) { yaz('        ' + p.ad + ' → ' + p.fiyat + ' TRY/ay (KDV dahil) → ' + p.env); });

  if (ortam !== 'sandbox' && CONFIRM !== 'evet-canli') {
    yaz('\nDURDU — taban adres CANLI. Canlı plan ayrı karar: CONFIRM=evet-canli.');
    process.exit(1);
  }
  if (CONFIRM !== 'evet' && CONFIRM !== 'evet-canli') {
    yaz('\nONAY YOK — hiçbir çağrı yapılmadı. Yukarıdakileri iyzico\'da oluşturmak için CONFIRM=evet ile koşun.');
    process.exit(0);
  }

  const urun = await iyzico.createProduct(URUN_ADI, 'Klinikler için WhatsApp/Instagram yapay zekâ asistanı aboneliği');
  const urunRef = urun.ok && referansOf(urun.data && (urun.data.data || urun.data));
  if (!urunRef) { yaz('\nÜrün oluşturulamadı — ' + (urun.ok ? 'referans okunamadı' : hata(urun))); process.exit(1); }
  yaz('\nÜrün oluşturuldu — referans: ' + urunRef);

  const sonuclar = [];
  for (const p of PLANLAR) {
    const r = await iyzico.createPricingPlan(urunRef, { name: p.ad, priceTry: p.fiyat });
    const ref = r.ok && referansOf(r.data && (r.data.data || r.data));
    if (!ref) { yaz(p.ad + ' oluşturulamadı — ' + (r.ok ? 'referans okunamadı' : hata(r))); continue; }
    sonuclar.push({ env: p.env, ref: ref });
  }
  if (!sonuclar.length) process.exit(1);

  yaz('\natlasasistan-static ortam değişkenleri (' + (ortam === 'sandbox' ? 'Preview' : 'Production') + '):');
  sonuclar.forEach(function (s) { yaz('  ' + s.env + ' = ' + s.ref); });
  process.exit(sonuclar.length === PLANLAR.length ? 0 : 1);
})();
