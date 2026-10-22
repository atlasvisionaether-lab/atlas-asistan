'use strict';

/**
 * iyzico kimlik doğrulama tanısı: anahtarlar + imza iyzico'da geçiyor mu?
 *
 * Canlıda ödeme başlatma "8 | Authentication token is not verified" ile
 * düştü. Üç olası sebep: anahtar yanlış, anahtar başka ortamın (sandbox ↔
 * canlı), ya da imza (IYZWSv2) hesabı yanlış. Bu araç üçünü ayırır:
 *
 *   Ödeme formunu VAR OLMAYAN bir fiyat planı referansıyla başlatmayı dener.
 *   - Kimlik doğrulama geçerse iyzico bir İŞ hatası döner (plan bulunamadı
 *     vb., errorCode ≠ 8): anahtarlar ve imza doğru, hiçbir şey oluşmaz.
 *   - Geçmezse yine errorCode 8: sorun anahtarda/ortamda (ya da imzada).
 *
 * Anahtarlar yazdırılmaz; yalnızca biçimleri (uzunluk, önek türü, görünmez
 * karakter) gösterilir. Kart, müşteri ya da abonelik oluşturulmaz.
 *
 *   read -rsp 'API anahtarı: ' IYZICO_API_KEY; echo; export IYZICO_API_KEY
 *   read -rsp 'Güvenlik anahtarı: ' IYZICO_SECRET_KEY; echo; export IYZICO_SECRET_KEY
 *   IYZICO_BASE_URL=https://api.iyzipay.com node tools/iyzico-auth-probe.js
 *   unset IYZICO_API_KEY IYZICO_SECRET_KEY
 */

const iyzico = require('../api/_lib/iyzico.js');

function bicim(ad, deger) {
  const v = String(deger || '');
  const t = v.trim();
  let onek = 'diğer';
  if (/^sandbox-/i.test(t)) onek = 'sandbox- (SANDBOX anahtarı)';
  else if (/^sk_(live|test)_/i.test(t)) onek = 'sk_live_/sk_test_ (bu bir STRIPE anahtarı biçimi, iyzico değil)';
  else if (/^pk_/i.test(t)) onek = 'pk_ (Stripe açık anahtarı biçimi)';
  const gorunmez = /[^\x21-\x7e]/.test(t);
  const kenar = v !== t;
  console.log('  ' + ad + ': uzunluk ' + t.length + ', önek: ' + onek
    + (gorunmez ? ', ⚠ içinde boşluk/görünmez/ASCII dışı karakter var' : '')
    + (kenar ? ' (baştaki/sondaki boşluk kırpıldı — kod da kırpıyor)' : ''));
}

(async function () {
  const base = String(process.env.IYZICO_BASE_URL || '').trim();
  console.log('Taban adres: ' + (base || '(yok)') + ' → ortam: ' + (iyzico.environmentName() || 'bilinmiyor'));
  bicim('IYZICO_API_KEY   ', process.env.IYZICO_API_KEY);
  bicim('IYZICO_SECRET_KEY', process.env.IYZICO_SECRET_KEY);
  if (!iyzico.isConfigured()) {
    console.log('\nYAPILANDIRILMAMIŞ: anahtarlardan biri 20 karakterden kısa ya da taban adres https değil.');
    process.exit(2);
  }

  const r = await iyzico.request('POST', '/v2/subscription/checkoutform/initialize', {
    locale: 'tr',
    callbackUrl: 'https://www.cyberlionai.com/api/checkout-return',
    pricingPlanReferenceCode: 'cyberlion-auth-probe-olmayan-plan',
    subscriptionInitialStatus: 'PENDING',
    customer: { name: 'Tani', surname: 'Probe', email: 'probe@cyberlionai.com' }
  });

  console.log('');
  if (r.ok) {
    console.log('BEKLENMEDİK: iyzico var olmayan planı kabul etti. Kimlik doğrulama GEÇTİ.');
    process.exit(0);
  }
  if (r.reason === 'iyzico_http_401' || String(r.errorCode) === '8') {
    console.log('KİMLİK DOĞRULAMA GEÇMEDİ (errorCode 8). Bu anahtarlar bu taban adreste geçerli değil.');
    console.log('→ Biçim satırlarına bak: "sandbox-" ise canlı adrese sandbox anahtarı gidiyor;');
    console.log('  "sk_live_" ise bu iyzico değil Stripe anahtarı. Panelde: Ayarlar → API Anahtarları.');
    process.exit(1);
  }
  console.log('KİMLİK DOĞRULAMA GEÇTİ: iyzico bir iş hatası döndü (' + (r.errorCode || r.reason)
    + '), beklenen bu — var olmayan plan. Anahtarlar ve imza doğru.');
  console.log('→ Bu anahtarlarla Vercel\'deki değerler farklı demektir: Vercel\'e aynen bunları gir.');
  process.exit(0);
})().catch(function (e) { console.error('HATA', e && e.message); process.exit(1); });
