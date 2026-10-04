/* Ödeme öncesi tarama yetkisi beyanı (fiyatlandırma sayfaları).
 *
 * <div data-checkout-declaration></div> yer tutucusuna onay kutusunu çizer.
 * /api/checkout?plan=… bağlantıları beyan işaretlenmeden çalışmaz; işaretliyse
 * bağlantıya declaration=1 eklenir. Sunucu da beyan olmadan ödemeyi BAŞLATMAZ
 * (api/checkout.js) — bu betik yalnızca kullanıcıya nedenini gösteriyor.
 * DOM yalnızca textContent ile yazılır. */
(function () {
  'use strict';

  var T = {
    tr: {
      label: 'Taranacak alan adlarının sahibi olduğumu veya tarama için yetkili olduğumu beyan ediyorum.',
      link: 'Tarama Yetkisi ve Seviyeleri',
      needed: 'Ödemeye geçmek için önce tarama yetkisi beyanını işaretleyin.'
    },
    en: {
      label: 'I declare that I own, or am authorised to scan, the domains I will scan.',
      link: 'Scan Authorisation and Levels',
      needed: 'Please tick the scan authorisation declaration before checkout.'
    }
  };
  function lang() { return document.documentElement.lang === 'en' ? 'en' : 'tr'; }

  var box = null, msg = null;

  function render(host) {
    var L = T[lang()];
    var checked = box ? box.checked : false;
    host.textContent = '';
    host.className = 'checkout-decl';

    var label = document.createElement('label');
    box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'checkoutDeclaration';
    box.checked = checked;
    var text = document.createElement('span');
    text.textContent = L.label + ' ';
    var a = document.createElement('a');
    a.href = '/pages/tarama-yetkisi';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '(' + L.link + ')';
    text.appendChild(a);
    label.appendChild(box);
    label.appendChild(text);

    msg = document.createElement('p');
    msg.className = 'checkout-decl__msg';
    msg.setAttribute('role', 'alert');
    msg.hidden = true;
    msg.textContent = L.needed;

    box.addEventListener('change', function () { if (box.checked) msg.hidden = true; });
    host.appendChild(label);
    host.appendChild(msg);
  }

  function warn() {
    if (!msg) return;
    msg.hidden = false;
    if (box) { box.focus(); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var host = document.querySelector('[data-checkout-declaration]');
    if (!host) return;
    render(host);
    new MutationObserver(function () { render(host); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    document.addEventListener('click', function (e) {
      var link = e.target && e.target.closest ? e.target.closest('a[href^="/api/checkout?plan="]') : null;
      if (!link) return;
      if (!box || !box.checked) { e.preventDefault(); warn(); return; }
      var href = link.getAttribute('href');
      if (!/[?&]declaration=1\b/.test(href)) link.setAttribute('href', href + '&declaration=1');
    }, true);

    try {
      if (new URLSearchParams(location.search).get('checkout') === 'declaration_required') warn();
    } catch (err) { /* eski tarayıcı */ }
  });
})();
