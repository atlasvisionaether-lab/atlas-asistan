'use strict';
/**
 * Şifre sıfırlama modalının durum sınamaları. Ağdan bağımsız.
 *
 *   node tools/authmodal-test.js
 *
 * NEDEN
 *
 * Hata şuydu: sıfırlama isteği gönderildikten sonra e-posta alanı ve gönder
 * düğmesi ekranda kalıyor, tek değişen formun ÜSTÜNDEKİ yeşil satır oluyordu.
 * Modal kapanıp yeniden açıldığında da o satır silinmediği için mesaj "baştan
 * oradaydı" gibi görünüyordu. İkisi birlikte, kullanıcının mailin gidip
 * gitmediğini anlayamaması demekti (ve saatte 5 isteklik sınırın boşa gitmesi).
 *
 * Bu sınamalar üç kuralı koruyor:
 *   1. Açılışta mesaj satırı GİZLİ (markup'ta `hidden`).
 *   2. Başarılı istek formu kapatıyor, görünüme dönüş formu geri açıyor.
 *   3. Modal kapanışı geçici durumu siliyor (kanca bağlı ve çağrılıyor).
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

/* ---- 1. Markup: mesaj satırı başta gizli, form parçaları yerinde ---- */

const msgEtiketi = (html.match(/<p class="auth__msg" id="authMsg"[^>]*>/) || [''])[0];
sina('authMsg satırı var', msgEtiketi !== '', true);
sina('authMsg açılışta hidden', /\bhidden\b/.test(msgEtiketi), true);
sina('authMsg aria-live polite', /aria-live="polite"/.test(msgEtiketi), true);

const forgotFormu = (html.match(/<form id="viewForgot"[\s\S]*?<\/form>/) || [''])[0];
sina('viewForgot formu var', forgotFormu !== '', true);
/* forgotSent() bu üç parçayı gizliyor; biri kaybolursa sınama uyarsın. */
sina('forgot formunda ipucu satırı var', /class="auth__hint"/.test(forgotFormu), true);
sina('forgot formunda alan var', /class="field"/.test(forgotFormu), true);
sina('forgot formunda submit düğmesi var',
  /<button type="submit"/.test(forgotFormu), true);
/* "Girişe dön" GİZLENMEMELİ: form kapandığında kullanıcının tek çıkışı o. */
sina('girişe dön bağlantısı auth__links içinde',
  /class="auth__links"[\s\S]*data-view="login"/.test(forgotFormu), true);

/* ---- 2. forgotSent: hangi parçaları gizliyor ---- */

const forgotSentGovde = (html.match(/function forgotSent\(on\)\s*\{[\s\S]*?\n      \}/) || [''])[0];
sina('forgotSent tanımlı', forgotSentGovde !== '', true);
sina('forgotSent yalnızca forgot görünümünde çalışıyor',
  /VIEWS\.forgot\.querySelectorAll/.test(forgotSentGovde), true);
sina('forgotSent ipucu, alan ve submit düğmesini kapsıyor',
  /\.auth__hint,\s*\.field,\s*button\[type="submit"\]/.test(forgotSentGovde), true);
sina('forgotSent auth__links seçmiyor', /auth__links/.test(forgotSentGovde), false);

/* ---- 3. Başarılı istek formu kapatıyor ---- */

const recoverDali = (html.match(/API\.auth\.recover\([\s\S]*?\}\);\n        \}\);/) || [''])[0];
sina('recover çağrısı bulundu', recoverDali !== '', true);
sina('başarıda form kapanıyor', /forgotSent\(true\)/.test(recoverDali), true);
sina('başarıda yeşil mesaj gösteriliyor',
  /showMsg\(t\('auth\.msg\.resetSent'\), 'success'\)/.test(recoverDali), true);
/* Hata dalı formu KAPATMAMALI: kullanıcı aynı adresi düzeltip tekrar denesin. */
const hataDali = recoverDali.slice(recoverDali.indexOf('}, function (err)'));
sina('hata dalında form açık kalıyor', /forgotSent\(true\)/.test(hataDali), false);
sina('hata dalında kırmızı mesaj', /showMsg\(errText\(err\), 'error'\)/.test(hataDali), true);

/* ---- 4. Görünüm değişimi ve modal kapanışı durumu siliyor ---- */

const setViewGovde = (html.match(/function setView\(name\)\s*\{[\s\S]*?\n      \}/) || [''])[0];
sina('setView mesajı siliyor', /clearMsg\(\);/.test(setViewGovde), true);
sina('setView formu geri açıyor', /forgotSent\(false\)/.test(setViewGovde), true);

const resetGovde = (html.match(/function resetTransient\(\)\s*\{[\s\S]*?\n      \}/) || [''])[0];
sina('resetTransient tanımlı', resetGovde !== '', true);
sina('resetTransient mesajı siliyor', /clearMsg\(\)/.test(resetGovde), true);
sina('resetTransient formu geri açıyor', /forgotSent\(false\)/.test(resetGovde), true);

const closeGovde = (html.match(/function close\(\)\s*\{[\s\S]*?\n      \}/) || [''])[0];
sina('modal kapanışı kancayı çağırıyor',
  /api\.onClose === 'function'/.test(closeGovde), true);
sina('kanca kimlik modülüne bağlı',
  /authModal\.onClose = function \(\) \{ authManager\.resetTransient\(\); \}/.test(html), true);
sina('resetTransient dışa açılmış', /resetTransient: resetTransient/.test(html), true);

console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
process.exit(hata === 0 ? 0 : 1);
