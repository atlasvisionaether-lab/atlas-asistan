/* Huni kaynağı (bkz. api/_lib/funnel.js).
   Ücretsiz araç sayfalarındaki bağlantılar `kaynak=<araç>` taşır; değer İZİNLİ
   LİSTEDEN doğrulanır.

   ONAY: kaynağı sayfalar arasında taşımak için o sekmenin oturum belleğine
   (sessionStorage, `cl_kaynak`) yazmak bir ölçüm kaydıdır; bu yüzden YALNIZCA
   çerez bildiriminde "Kabul" verildiyse (`cookieConsent2 === 'accepted'`)
   yazılır (Çerez Politikası §3, §6). Onay yoksa değer yalnızca o sayfanın
   adresinden okunur — araçtan gelip aynı sayfada tarama yapan yine doğru
   sayılır, ama değer saklanmaz. Çerez değil, kimlik değil, sekme kapanınca
   silinir; sunucu yalnızca günlük toplamı sayar. */
(function () {
  'use strict';
  var IZINLI = ['headers', 'email', 'ssl', 'blacklist'];
  var ANAHTAR = 'cl_kaynak';
  var ONAY = 'cookieConsent2';

  function gecerli(v) { return IZINLI.indexOf(v) !== -1 ? v : ''; }
  function onayVar() { try { return localStorage.getItem(ONAY) === 'accepted'; } catch (e) { return false; } }
  function adrestekiKaynak() {
    try { return gecerli(new URLSearchParams(window.location.search).get('kaynak') || ''); } catch (e) { return ''; }
  }
  function sakla(v) {
    if (!v || !onayVar()) return;
    try { sessionStorage.setItem(ANAHTAR, v); } catch (e) { /* oturum belleği kapalı */ }
  }
  function saklanan() {
    if (!onayVar()) return '';
    try { return gecerli(sessionStorage.getItem(ANAHTAR) || ''); } catch (e) { return ''; }
  }

  sakla(adrestekiKaynak());

  /* Önce bu sayfanın adresi, sonra (onay varsa) oturum belleği. */
  window.clKaynak = function () { return adrestekiKaynak() || saklanan(); };
  /* Bildirimde "Kabul" verildiği anda adresteki kaynağı da sakla (index.html). */
  window.clKaynakOnay = function () { sakla(adrestekiKaynak()); };

  function formuDoldur() {
    var alan = document.getElementById('kaynakInput');
    if (alan) alan.value = window.clKaynak();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', formuDoldur);
  else formuDoldur();
})();
