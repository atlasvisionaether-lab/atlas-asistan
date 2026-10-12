'use strict';

/**
 * iyzico sandbox'ında ürün + fiyat planı oluşturur ve REFERANS KODLARINI yazar.
 *
 *   IYZICO_API_KEY=… IYZICO_SECRET_KEY=… IYZICO_BASE_URL=https://sandbox-api.iyzipay.com \
 *   CONFIRM=evet node cyberlionai/tools/iyzico-plan-setup.js
 *
 * NEDEN VAR
 *
 * `/api/checkout` ödeme formunu `pricingPlanReferenceCode` ile başlatıyor ve
 * bu kod kodda SABİT DEĞİL: env'den geliyor (`IYZICO_PRICING_PLAN_PRO`,
 * `IYZICO_PRICING_PLAN_ENTERPRISE`). Referans yoksa uç 503
 * `checkout_unconfigured` dönüyor — yani anahtarlar girilse bile ödeme
 * açılmıyor. Kod iyzico panelinden elle de alınabilir; bu betik aynı şeyi
 * API'den yapıyor ve fiyatı `api/_lib/plans.js`'ten OKUYOR, elle yazmıyor:
 * panelde yanlış tutar girmek, sözleşme metnindeki fiyatla sitedeki fiyatın
 * ayrışması demekti.
 *
 * GÜVENLİK
 *
 * - Anahtarlar ortam değişkeninden okunuyor, ASLA basılmıyor ve hiçbir
 *   dosyaya yazılmıyor.
 * - Varsayılan olarak YALNIZCA SANDBOX. Taban adres canlıysa betik durur;
 *   canlı plan oluşturmak ayrı ve bilinçli bir karar (`CONFIRM=evet-canli`).
 * - `CONFIRM` yoksa hiçbir çağrı yapılmaz; ne yapacağını yazar ve çıkar.
 * - Basılan şey yalnızca REFERANS KODLARI: bunlar sır değil, ödeme formunu
 *   başlatmak için kullanılan plan kimlikleri. Yine de doğrudan Vercel'e
 *   girilir, sohbete yapıştırılmaz.
 *
 * TEKRAR ÇALIŞTIRMA
 *
 * iyzico aynı adla ikinci bir ürün/plan oluşturabilir. Betik bunu bilmiyor
 * ve var olanı aramıyor; tekrar koşarsanız YENİ referanslar üretir ve
 * eskiler iyzico panelinde durur. Bu yüzden çıktıdaki kodu env'e yazmak
 * koşunun parçası.
 */

const path = require('path');
const iyzico = require(path.join(__dirname, '..', 'api', '_lib', 'iyzico.js'));
const { PLANS } = require(path.join(__dirname, '..', 'api', '_lib', 'plans.js'));

const KALIN = '\x1b[1m';
const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const SARI = '\x1b[33m';
const SIFIRLA = '\x1b[0m';

const CONFIRM = process.env.CONFIRM || '';
const URUN_ADI = process.env.IYZICO_PRODUCT_NAME || 'Cyber Lion AI';

/* Plan başına: iyzico'daki ad ve hangi env değişkenine yazılacağı. */
const PLANLAR = [
  { id: 'pro', ad: 'Cyber Lion AI Pro (aylık)', env: 'IYZICO_PRICING_PLAN_PRO' },
  { id: 'enterprise', ad: 'Cyber Lion AI Enterprise (aylık)', env: 'IYZICO_PRICING_PLAN_ENTERPRISE' }
];

function referansOf(data) {
  const r = data && (data.referenceCode || data.pricingPlanReferenceCode || data.productReferenceCode);
  return typeof r === 'string' && r.trim() ? r.trim() : null;
}

(async function () {
  process.stdout.write(KALIN + 'iyzico ürün + fiyat planı oluşturma' + SIFIRLA + '\n');

  if (!iyzico.isConfigured()) {
    process.stdout.write('\nÖLÇÜLEMEDİ — IYZICO_API_KEY, IYZICO_SECRET_KEY ve IYZICO_BASE_URL gerekli.\n');
    process.stdout.write('Anahtarlar iyzico sandbox panelinden alınır ve ortam değişkeni olarak\n');
    process.stdout.write('verilir; bu betik onları hiçbir yere yazmaz. Tahmin edilmiyor.\n');
    process.exit(2);
  }

  const ortam = iyzico.environmentName();
  process.stdout.write('Ortam : ' + ortam + '\n');
  process.stdout.write('Ürün  : ' + URUN_ADI + '\n');
  PLANLAR.forEach(function (p) {
    process.stdout.write('        ' + p.id + ' → ' + PLANS[p.id].priceTry + ' TRY/ay (KDV hariç, plans.js)\n');
  });

  if (ortam !== 'sandbox' && CONFIRM !== 'evet-canli') {
    process.stdout.write('\n' + KIRMIZI + 'DURDU' + SIFIRLA + ' — taban adres CANLI görünüyor.\n');
    process.stdout.write('Canlı ürün/plan oluşturmak ayrı bir karar: CONFIRM=evet-canli ile koşun.\n');
    process.exit(1);
  }

  if (CONFIRM !== 'evet' && CONFIRM !== 'evet-canli') {
    process.stdout.write('\nONAY YOK — hiçbir çağrı yapılmadı.\n\n');
    process.stdout.write('Bu betik iyzico tarafında KAYIT OLUŞTURUR:\n');
    process.stdout.write('  1. "' + URUN_ADI + '" adlı bir abonelik ürünü\n');
    PLANLAR.forEach(function (p, i) {
      process.stdout.write('  ' + (i + 2) + '. "' + p.ad + '" fiyat planı — ' + PLANS[p.id].priceTry
        + ' TRY, MONTHLY, RECURRING → ' + p.env + '\n');
    });
    process.stdout.write('\nOnaylıyorsanız CONFIRM=evet ile tekrar koşun.\n');
    process.exit(0);
  }

  /* --- Ürün --- */
  const urun = await iyzico.createProduct(URUN_ADI, 'Web sitesi güvenlik taraması ve izleme aboneliği');
  if (!urun.ok) {
    process.stdout.write('\n' + KIRMIZI + 'Ürün oluşturulamadı' + SIFIRLA + ' — ' + urun.reason
      + (urun.errorCode ? ' (errorCode=' + urun.errorCode + ')' : '') + '\n');
    process.exit(1);
  }
  const urunRef = referansOf(urun.data && (urun.data.data || urun.data));
  if (!urunRef) {
    process.stdout.write('\n' + KIRMIZI + 'Ürün referansı okunamadı' + SIFIRLA
      + ' — yanıt alanları: ' + Object.keys((urun.data && urun.data.data) || urun.data || {}).join(',') + '\n');
    process.exit(1);
  }
  process.stdout.write('\n' + YESIL + 'Ürün oluşturuldu' + SIFIRLA + ' — referans: ' + urunRef + '\n');

  /* --- Planlar --- */
  const sonuclar = [];
  for (const p of PLANLAR) {
    const r = await iyzico.createPricingPlan(urunRef, { name: p.ad, priceTry: PLANS[p.id].priceTry });
    if (!r.ok) {
      process.stdout.write(KIRMIZI + p.id + ' planı oluşturulamadı' + SIFIRLA + ' — ' + r.reason
        + (r.errorCode ? ' (errorCode=' + r.errorCode + ')' : '') + '\n');
      continue;
    }
    const ref = referansOf(r.data && (r.data.data || r.data));
    if (!ref) {
      process.stdout.write(KIRMIZI + p.id + ' plan referansı okunamadı' + SIFIRLA + '\n');
      continue;
    }
    sonuclar.push({ env: p.env, ref: ref, id: p.id });
    process.stdout.write(YESIL + p.id + ' planı oluşturuldu' + SIFIRLA + ' — referans: ' + ref + '\n');
  }

  if (!sonuclar.length) {
    process.stdout.write('\nHiçbir plan oluşturulamadı.\n');
    process.exit(1);
  }

  process.stdout.write('\n' + KALIN + 'Vercel ortam değişkenlerine girilecekler' + SIFIRLA + '\n');
  sonuclar.forEach(function (s) {
    process.stdout.write('  ' + s.env + ' = ' + s.ref + '\n');
  });
  process.stdout.write('\n' + SARI + 'Not' + SIFIRLA + ': bu değerler doğrudan Vercel\'e girilir.\n');
  process.stdout.write('Girdikten sonra `GET /api/checkout?mode` cevabında plans listesinde\n');
  process.stdout.write('"' + sonuclar.map(function (s) { return s.id; }).join('", "') + '" görünmeli;\n');
  process.stdout.write('ölçmek için: tools/iyzico-verify.js\n');
})();
