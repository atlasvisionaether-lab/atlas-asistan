/* Güven Damgası ön kontrol sayfası. POST /api/trust-precheck.
   DOM yalnızca textContent ile yazılır. */
(function () {
  'use strict';
  var T = {
    tr: {
      title: 'Güven Damgası Ön Kontrol',
      lead: 'E-ticaret sitenizde, Güven Damgası başvurularında sıkça istenen unsurların görünür olup olmadığını otomatik olarak işaretler: yasal sözleşmeler, KVKK metinleri, satıcı iletişim bilgileri ve çerez onayı.',
      disclaimer: 'Bu araç resmi bir değerlendirme değildir; TOBB veya ETBİS ile bağlantımız yoktur. Sonuçlar başvurunuzun kabul edileceği anlamına gelmez. Yalnızca sitenizin herkese açık sayfaları okunur.',
      loginNeeded: 'Bu araç Enterprise planına dahildir. Devam etmek için giriş yapın.', login: 'Giriş Yap',
      planNeeded: 'Güven Damgası ön kontrolü Enterprise planına dahildir.', seePlans: 'Planları Gör',
      domain: 'Alan adı', run: 'Kontrol Et', running: 'Kontrol ediliyor…',
      tpTitle: 'Üçüncü taraf betikler',
      tpNote: 'Bu sunucular ziyaretçilerinizin tarayıcısından veri alabilir; KVKK aydınlatma metninizde ve çerez onayınızda yer almaları gerekir.',
      tpNone: 'Ana sayfada üçüncü taraf betik bulunmadı.',
      result: '{domain}: {pass}/{total} unsur bulundu',
      invalid: 'Geçerli bir alan adı girin.', unreachable: 'Siteye HTTPS üzerinden ulaşılamadı.',
      tooMany: 'Çok fazla kontrol. Bir saat sonra tekrar deneyin.', error: 'Kontrol tamamlanamadı.',
      pass: 'Var', fail: 'Bulunamadı', warn: 'Kontrol edin',
      i_https: 'HTTPS ile erişim',
      i_distance_sales: 'Mesafeli satış sözleşmesi bağlantısı',
      i_pre_information: 'Ön bilgilendirme formu bağlantısı',
      i_returns: 'İade / cayma / teslimat koşulları bağlantısı',
      i_kvkk_notice: 'KVKK aydınlatma metni bağlantısı',
      i_privacy: 'Gizlilik politikası bağlantısı',
      i_cookie_policy: 'Çerez politikası bağlantısı',
      i_contact: 'İletişim sayfası bağlantısı',
      i_contact_email: 'Ana sayfada e-posta adresi',
      i_contact_phone: 'Ana sayfada telefon numarası',
      i_contact_taxId: 'Ana sayfada VKN / MERSİS numarası',
      i_contact_address: 'Ana sayfada açık adres',
      i_cookie_banner: 'Çerez onay bildirimi'
    },
    en: {
      title: 'Trust Stamp Pre-Check',
      lead: 'Automatically flags whether your e-commerce site shows the items commonly requested in Turkish e-commerce Trust Stamp (Güven Damgası) applications: legal agreements, KVKK notices, seller contact details and cookie consent.',
      disclaimer: 'This tool is not an official assessment and we are not affiliated with TOBB or ETBİS. Results do not mean your application will be accepted. Only your site\'s public pages are read.',
      loginNeeded: 'This tool is included in the Enterprise plan. Sign in to continue.', login: 'Sign In',
      planNeeded: 'The Trust Stamp pre-check is included in the Enterprise plan.', seePlans: 'See Plans',
      domain: 'Domain', run: 'Check', running: 'Checking…',
      tpTitle: 'Third-party scripts',
      tpNote: 'These servers can receive data from your visitors\' browsers; they must be covered by your KVKK notice and cookie consent.',
      tpNone: 'No third-party scripts were found on the home page.',
      result: '{domain}: {pass}/{total} items found',
      invalid: 'Enter a valid domain.', unreachable: 'The site could not be reached over HTTPS.',
      tooMany: 'Too many checks. Try again in an hour.', error: 'The check could not be completed.',
      pass: 'Present', fail: 'Not found', warn: 'Review',
      i_https: 'Reachable over HTTPS',
      i_distance_sales: 'Distance sales agreement link',
      i_pre_information: 'Pre-contractual information form link',
      i_returns: 'Returns / withdrawal / delivery terms link',
      i_kvkk_notice: 'KVKK privacy notice link',
      i_privacy: 'Privacy policy link',
      i_cookie_policy: 'Cookie policy link',
      i_contact: 'Contact page link',
      i_contact_email: 'Email address on the home page',
      i_contact_phone: 'Phone number on the home page',
      i_contact_taxId: 'Tax ID / MERSİS number on the home page',
      i_contact_address: 'Street address on the home page',
      i_cookie_banner: 'Cookie consent notice'
    }
  };
  var lang = 'tr';
  try {
    var saved = localStorage.getItem('cl_lang');
    lang = saved === 'en' || saved === 'tr' ? saved : ((navigator.language || '').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en');
  } catch (e) { /* TR */ }
  function t(k, p) {
    var s = (T[lang] && T[lang][k]) || T.tr[k] || k;
    return s.replace(/\{(\w+)\}/g, function (m, n) { return p && p[n] !== undefined ? p[n] : m; });
  }
  function $(id) { return document.getElementById(id); }
  var last = null;

  function applyLang() {
    document.documentElement.lang = lang;
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.textContent = t(el.getAttribute('data-t')); });
    Array.prototype.forEach.call(document.querySelectorAll('.lang button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang));
    });
    if (last) render(last);
  }

  function render(r) {
    last = r;
    $('resultTitle').textContent = t('result', { domain: r.domain, pass: r.summary.pass, total: r.summary.total });
    var ul = $('items'); ul.textContent = '';
    r.items.forEach(function (it) {
      var li = document.createElement('li');
      var name = document.createElement('span'); name.textContent = t('i_' + it.id);
      var st = document.createElement('span'); st.className = 'st st--' + it.status; st.textContent = t(it.status);
      li.appendChild(name); li.appendChild(st); ul.appendChild(li);
    });
    var tp = $('tp'); tp.textContent = '';
    var list = r.thirdPartyScripts || [];
    if (!list.length) { var n = document.createElement('li'); n.textContent = t('tpNone'); tp.appendChild(n); }
    list.forEach(function (h) { var li = document.createElement('li'); li.textContent = h; tp.appendChild(li); });
    $('resultCard').hidden = false;
  }

  function say(text, kind) { var m = $('msg'); m.textContent = text; m.className = 'msg' + (kind ? ' msg--' + kind : ''); }

  document.addEventListener('DOMContentLoaded', function () {
    applyLang();
    Array.prototype.forEach.call(document.querySelectorAll('.lang button'), function (b) {
      b.addEventListener('click', function () {
        lang = b.getAttribute('data-lang');
        try { localStorage.setItem('cl_lang', lang); } catch (e) { /* yok */ }
        applyLang();
      });
    });
    fetch('/api/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (me) {
        if (!me || me.authenticated !== true) { $('loginCard').hidden = false; return; }
        $('formCard').hidden = false;
      }, function () { $('loginCard').hidden = false; });

    $('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var d = $('domain').value.trim();
      if (!d) { say(t('invalid'), 'bad'); return; }
      $('btn').disabled = true; say(t('running'));
      fetch('/api/trust-precheck', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ domain: d })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) { return { s: r.status, b: b }; });
      }).then(function (x) {
        $('btn').disabled = false;
        if (x.s === 200) { say(''); render(x.b); return; }
        if (x.s === 402) { $('formCard').hidden = true; $('planCard').hidden = false; say(''); return; }
        if (x.s === 401) { $('formCard').hidden = true; $('loginCard').hidden = false; return; }
        say(x.s === 400 ? t('invalid') : x.s === 502 ? t('unreachable') : x.s === 429 ? t('tooMany') : t('error'), 'bad');
      }, function () { $('btn').disabled = false; say(t('error'), 'bad'); });
    });
  });
})();
