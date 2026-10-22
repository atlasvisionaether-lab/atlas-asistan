/**
 * Fiyat kartlarında Aylık / Yıllık seçici (ana sayfa ve /pricing).
 *
 * Her iki dönemin fiyatı ve ödeme düğmesi sayfada hazır; hangisinin
 * görüneceğini CSS belirliyor:
 *   [data-period-root][data-period="monthly"] [data-period-only="yearly"] → gizli
 * Bu betik yalnızca kökün `data-period`'unu ve düğmelerin `aria-pressed`'ini
 * değiştiriyor. Betik yüklenmezse sayfa aylık fiyatla doğru görünür; seçici
 * de `hidden` kalır (işlemeyen bir düğme gösterilmez).
 *
 * Satır içi değil ayrı dosya: CSP'de yeni hash gerekmesin, iki sayfa aynı
 * kodu kullansın.
 */
(function () {
  'use strict';

  var PERIODS = ['monthly', 'yearly'];
  var switches = document.querySelectorAll('[data-period-switch]');
  if (!switches.length) return;

  function set(period) {
    if (PERIODS.indexOf(period) === -1) return;
    var roots = document.querySelectorAll('[data-period-root]');
    for (var i = 0; i < roots.length; i += 1) roots[i].setAttribute('data-period', period);
    var btns = document.querySelectorAll('[data-period-btn]');
    for (var j = 0; j < btns.length; j += 1) {
      btns[j].setAttribute('aria-pressed', btns[j].getAttribute('data-period-btn') === period ? 'true' : 'false');
    }
  }

  for (var s = 0; s < switches.length; s += 1) {
    switches[s].hidden = false;
    switches[s].addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-period-btn]') : null;
      if (btn) set(btn.getAttribute('data-period-btn'));
    });
  }

  /* /pricing#yillik ya da ?period=yearly ile doğrudan yıllık açılabilir. */
  var q = new URLSearchParams(location.search).get('period');
  if (q === 'yearly' || location.hash === '#yillik') set('yearly');
})();
