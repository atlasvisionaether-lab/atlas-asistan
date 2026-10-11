'use strict';
/**
 * "Pro'ya Geç" düğmelerinin oturum durumuna göre davranışı. Ağdan bağımsız.
 *
 *   node tools/procta-test.js
 *
 * NEDEN
 *
 * Hata şuydu: menüdeki ve hero'daki "Pro'ya Geç" düğmeleri `data-open-modal`
 * taşıdığı için, oturum durumuna HİÇ bakmayan tek bir dinleyici hepsinde
 * "Hesap Oluştur" modalını açıyordu. Giriş yapmış kullanıcı fiyatları hiç
 * göremiyor, zaten sahip olduğu hesabı yeniden kurması isteniyordu.
 *
 * Bu sınamalar dört kuralı koruyor:
 *   1. Fiyatlandırma herkese açık: yükseltme çağrısı fiyat bölümüne götürüyor.
 *   2. Kayıt modalı yalnızca oturumu OLMAYAN kullanıcıda açılıyor.
 *   3. Ücretli plandaki kullanıcıda menü/hero çağrıları gizleniyor, fiyat
 *      tablosundaki satır gizlenmiyor.
 *   4. Fiyat bölümünün çapası (#pricing) ve Pro satırının ödeme bağlantısı
 *      yerinde duruyor.
 */

const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) {
    hata++;
    console.log('  BAŞARISIZ  ' + ad + '\n    bulunan:  ' + JSON.stringify(bulunan)
      + '\n    beklenen: ' + JSON.stringify(beklenen));
  } else {
    console.log('  ok    ' + ad);
  }
}

/* ---- 1. Markup: çapa ve düğmeler ---- */

sina('fiyat bölümünün çapası var', /<section class="section" id="pricing">/.test(html), true);
const proCtalar = html.match(/data-pro-intent/g) || [];
sina('en az üç yükseltme çağrısı var', proCtalar.length >= 3, true);
/* Pro satırı önce /odeme özet ve onay sayfasına gider; oradaki "Güvenli Öde"
   düğmesi /api/checkout'a yönlendirir (odeme.js). */
sina('Pro satırı ödeme sayfasına bakıyor',
  /href="\/odeme\?plan=pro"[^>]*data-pro-intent/.test(html), true);
sina('ödeme sayfası beyan ve sözleşme onayını gönderiyor',
  /&declaration=1&agreements=1/.test(fs.readFileSync(path.join(__dirname, '..', 'odeme.js'), 'utf8')), true);
sina('ödeme sayfası ödeme ucuna gidiyor',
  /\/api\/checkout\?plan=/.test(fs.readFileSync(path.join(__dirname, '..', 'odeme.js'), 'utf8')), true);

/* ---- 2. Tıklama yönlendirmesi ---- */

const dinleyici = (html.match(/var openers = document\.querySelectorAll[\s\S]*?\n    \}/) || [''])[0];
sina('opener dinleyicisi bulundu', dinleyici !== '', true);
sina('yükseltme çağrısı fiyat bölümüne gidiyor',
  /hasAttribute\('data-pro-intent'\)\) return goToPricing\(\)/.test(dinleyici), true);
sina('oturum açıkken kayıt modalı açılmıyor',
  /authManager\.isSignedIn\(\)\) return goToPricing\(\)/.test(dinleyici), true);
/* Kayıt modalı satırı iki erken dönüşün ARDINDAN gelmeli; önce gelirse
   oturum kontrolü hiç çalışmaz. */
const modalDizin = dinleyici.indexOf("authManager.open('register')");
const oturumDizin = dinleyici.indexOf('isSignedIn()');
sina('kayıt modalı oturum kontrolünden sonra geliyor',
  modalDizin > oturumDizin && oturumDizin !== -1, true);

const gotoGovde = (html.match(/function goToPricing\(\)\s*\{[\s\S]*?\n    \}/) || [''])[0];
sina('goToPricing tanımlı', gotoGovde !== '', true);
sina('goToPricing #pricing bölümünü arıyor',
  /getElementById\('pricing'\)/.test(gotoGovde), true);
sina('bölüm yoksa /pricing sayfasına düşüyor',
  /window\.location\.href = '\/pricing'/.test(gotoGovde), true);

/* ---- 3. Ücretli planda gizleme ---- */

const applyGovde = (html.match(/function applyUser\(user\)\s*\{[\s\S]*?\n      \}/) || [''])[0];
sina('applyUser bulundu', applyGovde !== '', true);
sina('oturum yokken çağrı görünür', /showProCta\(true\)/.test(applyGovde), true);
sina('plan sunucudan okunuyor', /API\.subscription\(\)/.test(applyGovde), true);
sina('pro ve enterprise ücretli sayılıyor',
  /plan === 'pro' \|\| plan === 'enterprise'/.test(applyGovde), true);

const showGovde = (html.match(/function showProCta\(on\)\s*\{[\s\S]*?\n      \}/) || [''])[0];
sina('showProCta tanımlı', showGovde !== '', true);
sina('fiyat tablosundaki satır gizlenmiyor',
  /closest\('#pricing'\)\) continue/.test(showGovde), true);

/* ---- 4. Abonelik okuması oturumla ve sessiz ---- */

const subsGovde = (html.match(/subscription: function \(\)\s*\{[\s\S]*?\n      \},/) || [''])[0];
sina('subscription okuyucusu tanımlı', subsGovde !== '', true);
sina('istek oturum çerezini taşıyor',
  /credentials: 'same-origin'/.test(subsGovde), true);
sina('uç cevap vermezse plan bilinmiyor sayılıyor',
  /if \(!res\.ok\) return null;/.test(subsGovde), true);

/* ---- Girişten sonra ödemeye dönüş ----
   /api/checkout oturumsuz isteği /panel?checkout=<plan>'a gönderiyor. Panel
   planı localStorage'a yazıyor (giriş bağlantısı yeni sekmede açılır), ana
   sayfa bağlantıyı doğrulayınca /odeme'ye dönüyor. Eskiden panel parametreyi
   hiç okumuyordu ve ana sayfa ön kayıt formuna (/checkout) gidiyordu. */
const panel = fs.readFileSync(path.join(__dirname, '..', 'panel.html'), 'utf8');
sina('panel checkout parametresini okuyor',
  /URLSearchParams\(location\.search\)\.get\('checkout'\)/.test(panel), true);
sina('panel planı localStorage\'a yazıyor',
  /localStorage\.setItem\(CHECKOUT_KEY/.test(panel), true);
sina('oturumlu panel /odeme\'ye dönüyor',
  /location\.replace\('\/odeme\?plan=' \+ plan\)/.test(panel), true);
const devamGovde = (html.match(/function continueCheckout\(\)\s*\{[\s\S]*?\n      \}/) || [''])[0];
sina('continueCheckout tanımlı', devamGovde.length > 0, true);
sina('continueCheckout aynı anahtarı okuyor', /cl_checkout_plan/.test(devamGovde), true);
sina('continueCheckout /odeme\'ye gidiyor', /'\/odeme\?plan=' \+ plan/.test(devamGovde), true);
sina('e-posta bağlantısı doğrulanınca ödemeye dönülüyor',
  /t\('auth\.toast\.verified'\), 'success'\);\s*\/\/[^\n]*\n\s*continueCheckout\(\);/.test(html), true);
sina('ön kayıt formuna (/checkout) yönlendirme kalmadı',
  /location\.href = '\/checkout'/.test(html), false);

console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
process.exit(hata === 0 ? 0 : 1);
