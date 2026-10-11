/* /hesap-silme sayfasının silme düğmesi.
 *
 * Panelin düğmesiyle AYNI uca gidiyor: DELETE /api/panel/account. İki ayrı
 * silme yolu yazmak, birinin eksik silmesi demek olurdu; burada yalnızca
 * arayüz var.
 *
 * Harici dosya olmasının sebebi CSP: script-src 'self' + hash, satır içi
 * script her değiştiğinde hash yenilemek gerekmesin (bkz. dashboard.js).
 *
 * Oturum HttpOnly çerezde: bu dosyada token yok, kimlik yok. Oturum yoksa uç
 * 401 döner ve kullanıcı giriş sayfasına yönlendirilir — silinecek hesabı
 * sayfanın bilmesi gerekmiyor, sunucu çözüyor.
 */
(function () {
  'use strict';

  var METIN = {
    tr: {
      working: 'Hesap siliniyor…',
      done: 'Hesabınız ve verileriniz silindi. Ana sayfaya yönlendiriliyorsunuz.',
      auth: 'Silmek için giriş yapmanız gerekiyor. Panele yönlendiriliyorsunuz.',
      partial: 'Verileriniz silindi ama hesap kaydı kapatılamadı. Lütfen birkaç dakika sonra tekrar deneyin.',
      down: 'Silme işlemi şu an yapılamıyor. Lütfen daha sonra tekrar deneyin ya da destek@cyberlionai.com adresine yazın.',
      failed: 'İşlem tamamlanamadı. Birazdan tekrar deneyin.'
    },
    en: {
      working: 'Deleting your account…',
      done: 'Your account and data have been deleted. Redirecting to the home page.',
      auth: 'You need to sign in to delete your account. Redirecting to the panel.',
      partial: 'Your data was deleted but the account record could not be closed. Please try again in a few minutes.',
      down: 'Deletion is unavailable right now. Please try again later or write to destek@cyberlionai.com.',
      failed: 'Could not complete. Please try again shortly.'
    }
  };

  function dil() {
    return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'tr';
  }
  function t(anahtar) { return METIN[dil()][anahtar]; }

  function bagla(btnId, msgId) {
    var btn = document.getElementById(btnId);
    var msg = document.getElementById(msgId);
    if (!btn || !msg) return;

    btn.addEventListener('click', function () {
      /* Tarayıcının kendi onayı: sayfada ikinci bir pencere kurmak yerine,
         geri alınamayan işlem için tek ve net bir soru. */
      if (!window.confirm(dil() === 'en'
        ? 'Your entire scan history and your subscription will be deleted. This cannot be undone. Continue?'
        : 'Tüm tarama geçmişiniz ve aboneliğiniz silinecek. Bu işlem geri alınamaz. Devam edilsin mi?')) return;

      btn.disabled = true;
      msg.textContent = t('working');

      /* Onay dizgesi sunucudaki listeyle (ONAY) aynı olmalı. */
      fetch('/api/panel/account', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ confirm: 'HESABIMI SIL' })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) {
          btn.disabled = false;
          if (r.ok) {
            msg.textContent = t('done');
            setTimeout(function () { location.href = '/'; }, 2500);
            return;
          }
          var code = d && d.error && d.error.code;
          if (r.status === 401) {
            msg.textContent = t('auth');
            setTimeout(function () { location.href = '/dashboard#security'; }, 2000);
          } else if (code === 'account_delete_partial') {
            msg.textContent = t('partial');
          } else if (r.status === 503) {
            msg.textContent = t('down');
          } else {
            msg.textContent = t('failed');
          }
        });
      }).catch(function () {
        btn.disabled = false;
        msg.textContent = t('failed');
      });
    });
  }

  bagla('delBtn', 'delMsg');     /* TR bloğu */
  bagla('delBtnEn', 'delMsgEn'); /* EN bloğu */
})();
