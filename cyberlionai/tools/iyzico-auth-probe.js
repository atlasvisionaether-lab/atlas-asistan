'use strict';

/**
 * iyzico kimlik doğrulama tanısı: anahtarlar + imza iyzico'da geçiyor mu?
 *
 * Canlıda ödeme başlatma "8 | Authentication token is not verified" ile
 * düştü. Üç olası sebep: anahtar yanlış, anahtar başka ortamın (sandbox ↔
 * canlı), ya da imza (IYZWSv2) hesabı yanlış. Bu araç üçünü ayırır:
 *
 *   1) Standart API'de BIN sorgusu (kart/para yok): anahtarlar hesapta geçerli mi?
 *   2) Ödeme formunu VAR OLMAYAN bir fiyat planı referansıyla başlatmayı dener.
 *   1 geçip 2 geçmezse anahtarlar doğru, abonelik ürünü hesapta yetkili değil.
 *   Kimlik hatası kodları uca göre değişiyor (1001 standart API'de 200
 *   içinde; 5/8 abonelikte 401 ile): "geçti" yalnızca olumlu kanıtla.
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

/* iyzico kimlik hatasını uca göre farklı bildiriyor (sahte anahtarlarla
   ölçüldü): standart API 200 içinde 1001 "api bilgileri bulunamadı";
   abonelik API'si 401 ile 5 ya da 8 ("Authentication token is not
   verified"). "Geçti" yalnızca olumlu kanıtla söylenir. */
const AUTH_HATA_KODLARI = ['1000', '1001', '5', '8'];
function kimlikHatasi(r) {
  return r.reason === 'iyzico_http_401' || AUTH_HATA_KODLARI.indexOf(String(r.errorCode)) !== -1;
}
/* Kimlik hakkında HİÇBİR şey söylemeyen sonuç: bağlantı yok, zaman aşımı,
   iyzico 5xx (PR #111 incelemesi: bunlar "geçti" ya da "anahtar yanlış"
   sayılıyordu). */
function belirsiz(r) {
  return r.reason === 'iyzico_unreachable' || r.reason === 'iyzico_timeout'
    || /^iyzico_http_5\d\d$/.test(String(r.reason || ''));
}

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

  /* 1. Standart API (BIN sorgusu): kart istemez, para çekmez. Anahtarlar
        hesapta geçerli mi? Abonelik ürününden bağımsız. */
  const bin = await iyzico.request('POST', '/payment/bin/check',
    { locale: 'tr', conversationId: 'cyberlion-auth-probe', binNumber: '554960' });
  /* Geçerli anahtarla bu BIN sorgusu başarılı döner; başka her şey geçmedi. */
  const binGecti = bin.ok === true;
  console.log('\n1) Standart API (BIN sorgusu): ' + (binGecti ? 'KİMLİK DOĞRULAMA GEÇTİ' : 'GEÇMEDİ (' + (bin.errorCode || bin.reason) + ')'));

  /* 2. Abonelik API'si: var olmayan planla form başlatma (hiçbir şey oluşmaz). */
  const r = await iyzico.request('POST', '/v2/subscription/checkoutform/initialize', {
    locale: 'tr',
    callbackUrl: 'https://www.cyberlionai.com/api/checkout-return',
    pricingPlanReferenceCode: 'cyberlion-auth-probe-olmayan-plan',
    subscriptionInitialStatus: 'PENDING',
    customer: { name: 'Tani', surname: 'Probe', email: 'probe@cyberlionai.com' }
  });
  const abHata = kimlikHatasi(r);
  /* Var olmayan planla başarılı olmamalı; kimlik hatası dışı bir hata "büyük
     olasılıkla geçti" ama kodu bilinmiyorsa belirsiz sayılır. */
  const abGecti = !abHata && !r.ok && r.reason !== 'iyzico_unreachable' && r.reason !== 'iyzico_timeout';
  console.log('2) Abonelik API (var olmayan plan): ' + (abHata
    ? 'GEÇMEDİ (' + (r.errorCode || r.reason) + ')'
    : 'kimlik hatası değil (' + (r.errorCode || r.reason || 'başarılı') + ') — yukarıdaki iyzico satırına bak'));

  console.log('');
  if (belirsiz(bin) || belirsiz(r)) {
    console.log('SONUÇ: BELİRSİZ — iyzico\'ya ulaşılamadı ya da iyzico sunucu hatası verdi ('
      + (belirsiz(bin) ? bin.reason : r.reason) + '). Anahtarlar hakkında bir şey söylenemez.');
    console.log('→ Birkaç dakika sonra yeniden deneyin; sürerse taban adresi ve ağı kontrol edin.');
    process.exit(2);
  }
  if (!binGecti && !kimlikHatasi(bin)) {
    console.log('SONUÇ: BELİRSİZ — standart API kimlik hatası dışında bir sonuç verdi ('
      + (bin.errorCode || bin.reason) + '). Yukarıdaki iyzico satırını bana iletin.');
    process.exit(2);
  }
  if (!binGecti) {
    console.log('SONUÇ: Anahtarlar bu taban adreste HİÇ geçmiyor (abonelikten bağımsız).');
    console.log('→ Yanlış anahtar ya da yanlış ortam. Biçim satırlarına bak: "sandbox-" ise canlı');
    console.log('  adrese sandbox anahtarı gidiyor; "sk_live_" ise bu Stripe anahtarı.');
    console.log('  Canlı panel: merchant.iyzipay.com → Ayarlar → API Anahtarları.');
    process.exit(1);
  }
  if (abHata) {
    console.log('SONUÇ: Anahtarlar DOĞRU (standart API geçti) ama Abonelik API\'si bu anahtarları kabul etmiyor.');
    console.log('→ Abonelik ürünü hesapta canlıda açık değil: iyzico\'dan açılmasını isteyin.');
    process.exit(1);
  }
  if (!abGecti) {
    console.log('SONUÇ: BELİRSİZ. Standart API geçti; abonelik adımı beklenmedik sonuç verdi.');
    console.log('→ Yukarıdaki "iyzico failure/http error" satırını bana iletin (anahtar içermez).');
    process.exit(1);
  }
  console.log('SONUÇ: Anahtarlar ve imza DOĞRU, abonelik API\'si de yetkili.');
  console.log('→ Vercel\'deki değerler bunlardan farklı: aynı iki değeri Vercel\'e girip redeploy edin.');
  process.exit(0);
})().catch(function (e) { console.error('HATA', e && e.message); process.exit(1); });
