/* Ödeme öncesi iki zorunlu onay (fiyatlandırma sayfaları).
 *
 *   1) Tarama yetkisi beyanı
 *   2) Mesafeli Satış Sözleşmesi, Ön Bilgilendirme Formu ve iade koşulları
 *
 * <div data-checkout-declaration></div> yer tutucusuna çizilir.
 * /api/checkout?plan=… bağlantıları ikisi de işaretlenmeden çalışmaz;
 * işaretliyse bağlantıya declaration=1&agreements=1 eklenir. Sunucu da
 * onaylar olmadan ödemeyi BAŞLATMAZ (api/checkout.js). DOM yalnızca
 * textContent ile yazılır.
 *
 * ÖDEME KAPALIYKEN: /api/checkout?mode=1 ödemenin açık olmadığını ya da bu
 * planın tanımlı olmadığını söylüyorsa düğme /api/checkout'a GİTMEZ (gitse
 * sunucu tarayıcıyı sessizce /pricing'e geri yollar ve kullanıcı "hiçbir şey
 * olmadı" sanır — üretimde yaşandı). Onun yerine düğmenin yanında açık bir
 * mesaj ve ön kayıt bağlantısı çıkar. Canlı anahtarlar eklendiğinde aynı
 * kod, değişiklik gerektirmeden iyzico'ya yönlendirir. */
(function () {
  'use strict';

  var T = {
    tr: {
      decl: 'Taranacak alan adlarının sahibi olduğumu veya tarama için yetkili olduğumu beyan ediyorum.',
      declLink: 'Tarama Yetkisi ve Seviyeleri',
      agr: 'Mesafeli Satış Sözleşmesi, Ön Bilgilendirme Formu ve Teslimat ve İade Şartları\'nı okudum, onaylıyorum.',
      agrLinks: [['Mesafeli Satış', '/pages/mesafeli-satis-sozlesmesi'], ['Ön Bilgilendirme', '/pages/on-bilgilendirme-formu'], ['İade', '/pages/teslimat-ve-iade-sartlari']],
      needed: 'Ödemeye geçmek için iki onay kutusunu da işaretleyin.',
      closed: 'Çevrimiçi ödeme şu an açık değil: iyzico onay süreci sürüyor. Ön kayıt bırakın, ödeme açılınca size ilk biz dönelim; ya da destek@cyberlionai.com adresine yazın.',
      closedLink: 'Ön kayıt bırak'
    },
    en: {
      decl: 'I declare that I own, or am authorised to scan, the domains I will scan.',
      declLink: 'Scan Authorisation and Levels',
      agr: 'I have read and accept the Distance Sales Agreement, the Pre-Contractual Information Form and the Delivery & Returns terms.',
      agrLinks: [['Distance Sales', '/pages/mesafeli-satis-sozlesmesi'], ['Pre-Contractual Info', '/pages/on-bilgilendirme-formu'], ['Returns', '/pages/teslimat-ve-iade-sartlari']],
      needed: 'Please tick both boxes before checkout.',
      closed: 'Online payment is not open yet: our iyzico approval is in progress. Leave a pre-registration and we will contact you first when it opens, or email destek@cyberlionai.com.',
      closedLink: 'Pre-register'
    }
  };
  function lang() { return document.documentElement.lang === 'en' ? 'en' : 'tr'; }

  var boxes = { decl: null, agr: null }, msg = null, closedMsg = null;
  /* null: henüz bilinmiyor (istek sürüyor ya da düştü) → sunucuya bırakılır. */
  var payMode = null;

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
    box.addEventListener('change', function () { if (ok()) msg.hidden = true; syncLinks(); });
    boxes[key] = box;
    return label;
  }

  function ok() { return !!(boxes.decl && boxes.decl.checked && boxes.agr && boxes.agr.checked); }

  function planOf(a) {
    var m = /[?&]plan=([a-z]+)/.exec(a.getAttribute('href') || '');
    return m ? m[1] : null;
  }

  /** Ödeme bu plan için açık mı (bilinmiyorsa true: sunucu karar versin). */
  function payOpen(plan) {
    if (!payMode) return true;
    return payMode.enabled === true && (payMode.plans || []).indexOf(plan) !== -1;
  }

  /** Onaylar eksikken düğmeler kilitli görünür (yine tıklanabilir: tıklayınca neden söylenir). */
  function syncLinks() {
    var on = ok();
    Array.prototype.forEach.call(document.querySelectorAll('a[href^="/api/checkout?plan="]'), function (a) {
      a.setAttribute('aria-disabled', on ? 'false' : 'true');
      a.style.opacity = on ? '' : '0.55';
      a.style.filter = on ? '' : 'grayscale(0.4)';
    });
  }

  function showClosed(plan) {
    if (!closedMsg) return;
    var L = T[lang()];
    closedMsg.textContent = L.closed + ' ';
    var a = document.createElement('a');
    a.href = '/checkout' + (plan ? '?plan=' + encodeURIComponent(plan) : '');
    a.textContent = L.closedLink + ' →';
    closedMsg.appendChild(a);
    closedMsg.hidden = false;
    closedMsg.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

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
    closedMsg = document.createElement('p');
    closedMsg.className = 'checkout-decl__msg';
    closedMsg.setAttribute('role', 'status');
    closedMsg.hidden = true;
    host.appendChild(closedMsg);
    syncLinks();
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
      var plan = planOf(a);
      if (!payOpen(plan)) { e.preventDefault(); showClosed(plan); return; }
      var href = a.getAttribute('href').replace(/&(declaration|agreements)=1/g, '');
      a.setAttribute('href', href + '&declaration=1&agreements=1');
    }, true);

    var q = null, qPlan = null;
    try {
      var params = new URLSearchParams(location.search);
      q = params.get('checkout'); qPlan = params.get('plan');
    } catch (err) { /* eski tarayıcı */ }
    if (q === 'declaration_required' || q === 'agreements_required') warn();
    /* Sunucu ödemeyi açamayıp geri gönderdiyse mesaj düğmelerin yanında. */
    if (q === 'unavailable') showClosed(qPlan);

    fetch('/api/checkout?mode=1', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m && typeof m.enabled === 'boolean') payMode = m; })
      .catch(function () { /* bilinmiyor: sunucu karar verir */ });
  });
})();
