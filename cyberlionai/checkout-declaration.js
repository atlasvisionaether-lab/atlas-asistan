/* Ödeme öncesi iki zorunlu onay (fiyatlandırma sayfaları).
 *
 *   1) Tarama yetkisi beyanı
 *   2) Mesafeli Satış Sözleşmesi, Ön Bilgilendirme Formu ve iade koşulları
 *
 * <div data-checkout-declaration></div> yer tutucusuna çizilir.
 * /api/checkout?plan=… bağlantıları ikisi de işaretlenmeden çalışmaz;
 * işaretliyse bağlantıya declaration=1&agreements=1 eklenir. Sunucu da
 * onaylar olmadan ödemeyi BAŞLATMAZ (api/checkout.js). DOM yalnızca
 * textContent ile yazılır. */
(function () {
  'use strict';

  var T = {
    tr: {
      decl: 'Taranacak alan adlarının sahibi olduğumu veya tarama için yetkili olduğumu beyan ediyorum.',
      declLink: 'Tarama Yetkisi ve Seviyeleri',
      agr: 'Mesafeli Satış Sözleşmesi, Ön Bilgilendirme Formu ve Teslimat ve İade Şartları\'nı okudum, onaylıyorum.',
      agrLinks: [['Mesafeli Satış', '/pages/mesafeli-satis-sozlesmesi'], ['Ön Bilgilendirme', '/pages/on-bilgilendirme-formu'], ['İade', '/pages/teslimat-ve-iade-sartlari']],
      needed: 'Ödemeye geçmek için iki onay kutusunu da işaretleyin.'
    },
    en: {
      decl: 'I declare that I own, or am authorised to scan, the domains I will scan.',
      declLink: 'Scan Authorisation and Levels',
      agr: 'I have read and accept the Distance Sales Agreement, the Pre-Contractual Information Form and the Delivery & Returns terms.',
      agrLinks: [['Distance Sales', '/pages/mesafeli-satis-sozlesmesi'], ['Pre-Contractual Info', '/pages/on-bilgilendirme-formu'], ['Returns', '/pages/teslimat-ve-iade-sartlari']],
      needed: 'Please tick both boxes before checkout.'
    }
  };
  function lang() { return document.documentElement.lang === 'en' ? 'en' : 'tr'; }

  var boxes = { decl: null, agr: null }, msg = null;

  function link(text, href) {
    var a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text;
    return a;
  }

  function row(key, text, links, checked) {
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.id = key === 'decl' ? 'checkoutDeclaration' : 'checkoutAgreements';
    box.checked = checked;
    var span = document.createElement('span');
    span.textContent = text + ' (';
    links.forEach(function (l, i) {
      if (i) span.appendChild(document.createTextNode(' · '));
      span.appendChild(link(l[0], l[1]));
    });
    span.appendChild(document.createTextNode(')'));
    label.appendChild(box);
    label.appendChild(span);
    box.addEventListener('change', function () { if (ok()) msg.hidden = true; });
    boxes[key] = box;
    return label;
  }

  function ok() { return !!(boxes.decl && boxes.decl.checked && boxes.agr && boxes.agr.checked); }

  function render(host) {
    var L = T[lang()];
    var prev = { decl: boxes.decl ? boxes.decl.checked : false, agr: boxes.agr ? boxes.agr.checked : false };
    host.textContent = '';
    host.className = 'checkout-decl';
    host.appendChild(row('decl', L.decl, [[L.declLink, '/pages/tarama-yetkisi']], prev.decl));
    var second = row('agr', L.agr, L.agrLinks, prev.agr);
    second.style.marginTop = '8px';
    host.appendChild(second);
    msg = document.createElement('p');
    msg.className = 'checkout-decl__msg';
    msg.setAttribute('role', 'alert');
    msg.hidden = true;
    msg.textContent = L.needed;
    host.appendChild(msg);
  }

  function warn() {
    if (!msg) return;
    msg.hidden = false;
    var first = boxes.decl && !boxes.decl.checked ? boxes.decl : boxes.agr;
    if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var host = document.querySelector('[data-checkout-declaration]');
    if (!host) return;
    render(host);
    new MutationObserver(function () { render(host); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="/api/checkout?plan="]') : null;
      if (!a) return;
      if (!ok()) { e.preventDefault(); warn(); return; }
      var href = a.getAttribute('href').replace(/&(declaration|agreements)=1/g, '');
      a.setAttribute('href', href + '&declaration=1&agreements=1');
    }, true);

    try {
      var q = new URLSearchParams(location.search).get('checkout');
      if (q === 'declaration_required' || q === 'agreements_required') warn();
    } catch (err) { /* eski tarayıcı */ }
  });
})();
