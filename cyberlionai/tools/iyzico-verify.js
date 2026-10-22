'use strict';

/**
 * Ödeme akışının canlı doğrulaması — KART GEREKTİRMEZ, VERİ YAZMAZ.
 *
 *   BASE=https://www.cyberlionai.com node cyberlionai/tools/iyzico-verify.js
 *
 * NEDEN VAR
 *
 * iyzico entegrasyonunun birim sınaması var (`tools/iyzico-test.js`: imza,
 * resmî vektörler, form adresi host doğrulaması). Ama o sınama ÜRETİMDEKİ
 * ucun davranışını ölçmüyor: anahtarlar Vercel'e girildi mi, plan referansı
 * tanımlı mı, kapılar (beyan, sözleşme onayı, giriş) gerçekten tutuyor mu,
 * webhook imzasız bir POST'u reddediyor mu. Bunların hepsi kart girilmeden
 * ölçülebiliyor — ve ölçülmediği sürece "ödeme hazır" bir tahmin.
 *
 * NE ÖLÇÜLMÜYOR (dürüstçe)
 *
 * Barındırılan formda KART GİRİLEN adım ve onun ardından gelen
 * `checkout-return` → webhook → `cl_subscriptions` yazımı buradan
 * ölçülemiyor: kartı bir insan giriyor. Betik o adıma kadar her şeyi ölçüp
 * nerede durduğunu söylüyor; kalan adımın elle yapılışı
 * `docs/iyzico-sandbox.md` içinde adım adım yazılı.
 *
 * SINIRLAR
 *
 * - Yalnızca GET/POST ile kapı davranışı okunuyor; hiçbir abonelik
 *   başlatılmıyor, hiçbir satır yazılmıyor, hiçbir hesap açılmıyor.
 * - Anahtar istemiyor: ödemenin açık olup olmadığını ucun KENDİ kamuya açık
 *   durum cevabından (`/api/checkout?mode`) okuyor.
 * - Önizleme hedefi için `BYPASS` (Vercel Protection Bypass) verilebilir.
 */

const BASE = (process.env.BASE || 'https://www.cyberlionai.com').replace(/\/+$/, '');
const BYPASS = (process.env.BYPASS || '').trim();

const KALIN = '\x1b[1m';
const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const SARI = '\x1b[33m';
const SIFIRLA = '\x1b[0m';

const ZAMAN_ASIMI = 15000;

let gecti = 0;
let kalan = 0;
let olculemedi = 0;

function sonuc(durum, ad, ek) {
  if (durum === true) { gecti++; process.stdout.write('  ' + YESIL + 'GEÇTİ' + SIFIRLA + '  ' + ad + (ek ? ' — ' + ek : '') + '\n'); }
  else if (durum === null) { olculemedi++; process.stdout.write('  ' + SARI + 'ÖLÇÜLEMEDİ' + SIFIRLA + '  ' + ad + (ek ? ' — ' + ek : '') + '\n'); }
  else { kalan++; process.stdout.write('  ' + KIRMIZI + 'KALDI' + SIFIRLA + '  ' + ad + (ek ? ' — ' + ek : '') + '\n'); }
}

async function istek(yol, secenek) {
  const ayar = secenek || {};
  const kontrolcu = new AbortController();
  const zamanlayici = setTimeout(function () { kontrolcu.abort(); }, ZAMAN_ASIMI);
  const basliklar = Object.assign({ 'Accept': 'application/json' }, ayar.headers || {});
  if (BYPASS) basliklar['x-vercel-protection-bypass'] = BYPASS;
  try {
    const y = await fetch(BASE + yol, {
      method: ayar.method || 'GET',
      /* Yönlendirme TAKİP EDİLMİYOR: ölçülen şeyin bir kısmı Location'ın
         kendisi (ör. giriş yoksa /panel'e gidiyor mu). */
      redirect: 'manual',
      signal: kontrolcu.signal,
      headers: basliklar,
      body: ayar.body
    });
    clearTimeout(zamanlayici);
    const metin = await y.text().catch(function () { return ''; });
    let govde = null;
    try { govde = metin ? JSON.parse(metin) : null; } catch (e) { govde = null; }
    return {
      ok: true, status: y.status, govde: govde,
      location: y.headers.get('location'),
      allow: y.headers.get('allow')
    };
  } catch (e) {
    clearTimeout(zamanlayici);
    return { ok: false, hata: e && e.name === 'AbortError' ? 'timeout' : (e.message || 'error') };
  }
}

function kod(y) { return y.govde && y.govde.error ? y.govde.error.code : null; }

(async function () {
  process.stdout.write(KALIN + 'Ödeme akışı — canlı kapı ölçümü (kart gerekmez)' + SIFIRLA + '\n');
  process.stdout.write('Hedef : ' + BASE + '\n');
  process.stdout.write('Zaman : ' + new Date().toISOString() + '\n');

  /* ------------------------------------------------- 1. Ödemenin durumu */
  process.stdout.write('\n' + KALIN + '1. Ödemenin durumu (kamuya açık cevap)' + SIFIRLA + '\n');

  const durum = await istek('/api/checkout?mode=1');
  if (!durum.ok) {
    sonuc(null, 'durum ucu okunamadı', durum.hata + ' — bu kaptan ağ çıkışı kapalıysa Actions üzerinden koşun');
    process.stdout.write('\nÖLÇÜLEMEDİ: hedefe erişilemedi, hiçbir şey tahmin edilmedi.\n');
    process.exit(2);
  }

  sonuc(durum.status === 200, 'GET /api/checkout?mode → 200', 'HTTP ' + durum.status);
  const d = durum.govde || {};
  process.stdout.write('         enabled=' + JSON.stringify(d.enabled)
    + '  testMode=' + JSON.stringify(d.testMode)
    + '  plans=' + JSON.stringify(d.plans || []) + '\n');

  /* Anahtar sızdırmıyor mu: cevapta anahtar, referans ya da adres olmamalı. */
  const durumMetni = JSON.stringify(d);
  sonuc(!/sandbox-api|iyzipay|apiKey|secret|[A-Za-z0-9]{30,}/.test(durumMetni),
    'durum cevabı anahtar/adres/referans sızdırmıyor',
    'alanlar: ' + Object.keys(d).join(','));

  /* ÜÇ DURUM, ikisi değil. İlk sürüm yalnızca "açık / kapalı" biliyordu ve
     16.10.2026 canlı koşusunda (38983000527) dört satırda yanlış yerde KALDI
     dedi: anahtarlar girilmiş (`enabled: true`) ama plan referansı yokken
     (`plans: []`) uç 401 değil 503 döndürüyor — çünkü `api/checkout.js`
     sırası YAPILANDIRMA → PLAN REFERANSI → OTURUM. O hâli ayrı bir durum
     olarak adlandırmak gerekiyordu; uç doğru davranıyordu, ölçüt eksikti. */
  const acik = d.enabled === true;
  /* Durum ucu ödeme seçeneklerini listeler (pro_monthly, pro_yearly, …);
     eski sürüm yalnızca 'pro' diyordu. İkisi de "Pro ödenebilir" demek. */
  const planVar = Array.isArray(d.plans) && (d.plans.indexOf('pro_monthly') !== -1 || d.plans.indexOf('pro') !== -1);
  const hazir = acik && planVar;      /* ödeme gerçekten başlatılabilir */

  if (!acik) {
    process.stdout.write('\n' + SARI + 'Ödeme KAPALI' + SIFIRLA
      + ' — anahtar yok ya da kill switch kapalı.\n');
    process.stdout.write('Bu bir hata DEĞİL: kapılar aşağıda yine ölçülüyor, yalnızca form\n');
    process.stdout.write('başlatma adımı 503 `checkout_unconfigured` ile duracak.\n');
    process.stdout.write('Eksikleri girme sırası: docs/iyzico-sandbox.md\n');
  } else if (!planVar) {
    process.stdout.write('\n' + SARI + 'ANAHTAR VAR, PLAN REFERANSI YOK' + SIFIRLA
      + ' — `plans: ' + JSON.stringify(d.plans || []) + '`.\n');
    process.stdout.write('iyzico anahtarları çalışıyor ama IYZICO_PRICING_PLAN_PRO /\n');
    process.stdout.write('IYZICO_PRICING_PLAN_ENTERPRISE tanımlı değil: /odeme düğmesi kapalı\n');
    process.stdout.write('kalır ve /api/checkout 503 `checkout_unconfigured` döner.\n');
    process.stdout.write('Referans kodu iyzico panelinde ürün+plan oluşturularak alınır\n');
    process.stdout.write('(ya da tools/iyzico-plan-setup.js); ayrıntı: docs/iyzico-sandbox.md\n');
  } else if (d.testMode === true) {
    process.stdout.write('\n' + SARI + 'SANDBOX' + SIFIRLA
      + ' — taban adres sandbox; gerçek para çekilmez.\n');
  }

  /* ------------------------------------------------------- 2. Kapılar */
  process.stdout.write('\n' + KALIN + '2. Ödeme başlatma kapıları (hiçbir abonelik başlatılmıyor)' + SIFIRLA + '\n');

  const post = await istek('/api/checkout?plan=pro', { method: 'POST' });
  sonuc(post.status === 405 && post.allow === 'GET' && kod(post) === 'method_not_allowed',
    'POST /api/checkout → 405 + Allow: GET + method_not_allowed',
    'HTTP ' + post.status + ' Allow=' + post.allow + ' ' + kod(post));

  const plansiz = await istek('/api/checkout');
  sonuc(plansiz.status === 400 && kod(plansiz) === 'missing_plan', 'plan yok → 400 missing_plan',
    'HTTP ' + plansiz.status + ' ' + kod(plansiz));

  const free = await istek('/api/checkout?plan=free&declaration=1&agreements=1');
  sonuc(free.status === 400 && kod(free) === 'invalid_plan', 'free planın ödemesi yok → 400 invalid_plan',
    'HTTP ' + free.status + ' ' + kod(free));

  const uydurma = await istek('/api/checkout?plan=platinum&declaration=1&agreements=1');
  sonuc(uydurma.status === 400 && kod(uydurma) === 'invalid_plan', 'bilinmeyen plan → 400 invalid_plan',
    'HTTP ' + uydurma.status + ' ' + kod(uydurma));

  const beyansiz = await istek('/api/checkout?plan=pro');
  sonuc(beyansiz.status === 400 && kod(beyansiz) === 'declaration_required',
    'tarama yetkisi beyanı olmadan ödeme başlamıyor',
    'HTTP ' + beyansiz.status + ' ' + kod(beyansiz));

  const onaysiz = await istek('/api/checkout?plan=pro&declaration=1');
  sonuc(onaysiz.status === 400 && kod(onaysiz) === 'agreements_required',
    'sözleşme onayı olmadan ödeme başlamıyor (Mesafeli Sözleşmeler Yönetmeliği)',
    'HTTP ' + onaysiz.status + ' ' + kod(onaysiz));

  /* Her kapı geçildi, oturum yok: makine isteği 401, tarayıcı /panel'e. */
  const oturumsuz = await istek('/api/checkout?plan=pro&declaration=1&agreements=1');
  const beklenen = hazir ? 401 : 503;
  sonuc(oturumsuz.status === beklenen,
    hazir ? 'oturum yoksa 401 auth_required'
          : (acik ? 'plan referansı yokken 503 checkout_unconfigured'
                  : 'ödeme kapalıyken 503 checkout_unconfigured'),
    'HTTP ' + oturumsuz.status + ' ' + kod(oturumsuz));

  const tarayici = await istek('/api/checkout?plan=pro&declaration=1&agreements=1',
    { headers: { 'Accept': 'text/html' } });
  const panele = tarayici.status === 303 && /\/panel\?checkout=pro/.test(tarayici.location || '');
  const fiyata = tarayici.status === 303 && /\/pricing\?checkout=/.test(tarayici.location || '');
  sonuc(hazir ? panele : fiyata,
    hazir ? 'tarayıcı girişe yönlendiriliyor (/panel?checkout=pro)'
          : 'tarayıcı fiyat sayfasına geri gönderiliyor (ödeme başlatılamıyor)',
    'HTTP ' + tarayici.status + ' → ' + (tarayici.location || '(Location yok)'));

  /* ----------------------------------------------- 3. Ödeme dönüş ucu */
  process.stdout.write('\n' + KALIN + '3. Ödeme dönüşü (/api/checkout-return)' + SIFIRLA + '\n');

  /* Beklenen durum ödemenin AÇIK olup olmamasına göre değişiyor; ilk sürüm
     bunu atladı ve ölçüm (koşu 38186662506) kendi beklentisini düzeltti:
     anahtar yokken uç daha jetona bakmadan `unavailable` ile panele dönüyor
     (`if (!iyzico.isConfigured() || !db… ) backToPanel('unavailable')`).
     Yani "invalid" beklemek, ucun doğru davranışını KALDI göstermekti. */
  /* Dönüş ucunun sırası: yapılandırma → OTURUM → jeton. Anahtarlar girilince
     (plan referansı olmasa bile) jetonsuz istek artık `invalid` değil `login`
     ile dönüyor: oturum olmadan abonelik satırı zaten açılamaz. */
  const donusDurumu = !acik ? 'unavailable' : 'login';

  const jetonsuz = await istek('/api/checkout-return', { headers: { 'Accept': 'text/html' } });
  sonuc(jetonsuz.status === 303
      && new RegExp('/panel\\?checkout=' + donusDurumu).test(jetonsuz.location || ''),
    'jeton yoksa panele "' + donusDurumu + '" ile dönüyor (abonelik yazılmıyor)',
    'HTTP ' + jetonsuz.status + ' → ' + (jetonsuz.location || '(Location yok)'));

  const bozukJeton = await istek('/api/checkout-return?token=bu-jeton-gecersiz',
    { headers: { 'Accept': 'text/html' } });
  sonuc(bozukJeton.status === 303
      && new RegExp('/panel\\?checkout=' + donusDurumu).test(bozukJeton.location || ''),
    'biçimsiz jeton kabul edilmiyor (abonelik yazılmıyor)',
    'HTTP ' + bozukJeton.status + ' → ' + (bozukJeton.location || '(Location yok)'));

  const yanlisYontem = await istek('/api/checkout-return', { method: 'DELETE' });
  sonuc(yanlisYontem.status === 405, 'DELETE /api/checkout-return → 405',
    'HTTP ' + yanlisYontem.status + ' Allow=' + yanlisYontem.allow);

  /* --------------------------------------------------------- 4. Webhook */
  process.stdout.write('\n' + KALIN + '4. Webhook (/api/webhooks/iyzico)' + SIFIRLA + '\n');

  const getWebhook = await istek('/api/webhooks/iyzico');
  sonuc(getWebhook.status === 405 && getWebhook.allow === 'POST' && kod(getWebhook) === 'method_not_allowed',
    'GET → 405 + Allow: POST + method_not_allowed',
    'HTTP ' + getWebhook.status + ' Allow=' + getWebhook.allow + ' ' + kod(getWebhook));

  /* Aynı ayrım burada da var ve aynı ölçümde yakalandı: anahtar yokken
     webhook imzayı DOĞRULAYAMAZ, bu yüzden 401 değil 503
     `webhook_unconfigured` dönüyor. İkisi de "yazmıyor" demek; hangisinin
     beklendiği ödemenin açık olmasına bağlı. */
  const imzaRed = acik
    ? { status: 401, ad: '401 unauthorized' }
    : { status: 503, ad: '503 webhook_unconfigured' };

  const imzasiz = await istek('/api/webhooks/iyzico', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriptionReferenceCode: 'uydurma-referans', status: 'ACTIVE' })
  });
  sonuc(imzasiz.status === imzaRed.status,
    'imzasız POST reddediliyor — beklenen ' + imzaRed.ad + ' (durum uydurulamıyor)',
    'HTTP ' + imzasiz.status + ' ' + kod(imzasiz));

  const bozukImza = await istek('/api/webhooks/iyzico', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Iyz-Signature-V3': 'a'.repeat(64) },
    body: JSON.stringify({ subscriptionReferenceCode: 'uydurma-referans', status: 'ACTIVE' })
  });
  sonuc(bozukImza.status === imzaRed.status,
    'yanlış imzalı POST reddediliyor — beklenen ' + imzaRed.ad,
    'HTTP ' + bozukImza.status + ' ' + kod(bozukImza));

  /* --------------------------------------------------- 5. Kalan adım */
  process.stdout.write('\n' + KALIN + '5. Buradan sonrası ELLE' + SIFIRLA + '\n');
  process.stdout.write('Kart girilen barındırılan form adımı ve ardından gelen\n');
  process.stdout.write('checkout-return → webhook → cl_subscriptions yazımı bu betikten\n');
  process.stdout.write('ölçülemiyor: kartı bir insan giriyor. Sandbox adımları ve neyin\n');
  process.stdout.write('kontrol edileceği: docs/iyzico-sandbox.md\n');

  process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '   Ölçülemedi: ' + olculemedi + '\n');
  process.exit(kalan === 0 ? 0 : 1);
})();
