/* Cyber Lion AI — alan adı doğrulama sayfası (/verify).
   Sunucu: /api/verify/init, /api/verify/check, /api/verify/list.
   DOM yalnızca textContent ile yazılır; innerHTML yok. */
(function () {
  'use strict';

  var T = {
    tr: {
      title: 'Alan Adı Doğrulama',
      lead: 'Aktif güvenlik testleri (XSS/SQLi yoklaması, hassas dosya kontrolü) ve Cloudflare ile otomatik düzeltme yalnızca sahipliği doğrulanmış alan adlarında çalışır. Pasif tarama için doğrulama gerekmez.',
      loginNeeded: 'Doğrulama hesabınıza bağlanır. Devam etmek için giriş yapın.', login: 'Giriş Yap',
      step1: '1. Alan adı', domain: 'Alan adı', start: 'Doğrulamayı Başlat',
      step2: '2. Yöntem seçin ve ekleyin', mDns: 'DNS TXT', mFile: 'Dosya', mMeta: 'Meta etiketi',
      dnsName: 'Kayıt adı (Host)', dnsType: 'Tür', value: 'Değer', copy: 'Kopyala', copied: 'Kopyalandı',
      dnsNote: 'DNS ile doğrulama alt alan adlarını da kapsar. Kaydın yayılması birkaç dakika sürebilir.',
      fileUrl: 'Dosya adresi', fileContent: 'Dosya içeriği',
      fileNote: 'Dosya HTTPS üzerinden erişilebilir olmalı. Yalnızca bu alan adını kapsar (www ayrı doğrulanır).',
      metaTag: 'Ana sayfanın <head> bölümüne ekleyin',
      metaNote: "Yalnızca bu alan adını kapsar. Etiket sunucunun döndürdüğü HTML'de olmalı (JavaScript ile eklenen etiket görülmez).",
      verify: 'Doğrula', mine: 'Alan adlarım',
      legal: 'Doğrulamanın neden gerektiğini ve hangi testin ne yaptığını', legalLink: 'Tarama Yetkisi ve Seviyeleri', legal2: 'sayfasında açıklıyoruz.',
      invalid: 'Geçerli bir alan adı girin. Örnek: ornek.com',
      verified: 'Doğrulandı. Bu alan adında aktif testler ve otomatik düzeltme artık kullanılabilir.',
      already: 'Bu alan adı zaten doğrulanmış.',
      notFound: 'Kayıt bulunamadı. Ekledikten sonra birkaç dakika bekleyip tekrar deneyin. Kalan deneme: {n}',
      cooldown: 'Çok fazla başarısız deneme. {m} dakika sonra tekrar deneyin.',
      error: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      stVerified: 'Doğrulandı', stPending: 'Bekliyor', none: 'Henüz alan adı yok.'
    },
    en: {
      title: 'Domain Verification',
      lead: 'Active security tests (XSS/SQLi probes, sensitive file checks) and automatic fixes via Cloudflare only run on domains whose ownership is verified. Passive scanning needs no verification.',
      loginNeeded: 'Verification is tied to your account. Sign in to continue.', login: 'Sign In',
      step1: '1. Domain', domain: 'Domain', start: 'Start Verification',
      step2: '2. Choose a method and add it', mDns: 'DNS TXT', mFile: 'File', mMeta: 'Meta tag',
      dnsName: 'Record name (Host)', dnsType: 'Type', value: 'Value', copy: 'Copy', copied: 'Copied',
      dnsNote: 'DNS verification also covers subdomains. The record may take a few minutes to propagate.',
      fileUrl: 'File URL', fileContent: 'File content',
      fileNote: 'The file must be reachable over HTTPS. It covers this host only (www is verified separately).',
      metaTag: 'Add this to the <head> of your home page',
      metaNote: 'It covers this host only. The tag must be in the HTML the server returns (tags added by JavaScript are not seen).',
      verify: 'Verify', mine: 'My domains',
      legal: 'Why verification is needed and what each test does is explained on the', legalLink: 'Scan Authorisation and Levels', legal2: 'page.',
      invalid: 'Enter a valid domain. Example: example.com',
      verified: 'Verified. Active tests and automatic fixes are now available for this domain.',
      already: 'This domain is already verified.',
      notFound: 'Record not found. Wait a few minutes after adding it and try again. Attempts left: {n}',
      cooldown: 'Too many failed attempts. Try again in {m} minutes.',
      error: 'The request could not be completed. Please try again.',
      stVerified: 'Verified', stPending: 'Pending', none: 'No domains yet.'
    }
  };

  var lang = 'tr';
  try {
    var q = new URLSearchParams(location.search).get('lang');
    var saved = localStorage.getItem('cl_lang');
    lang = q === 'en' || q === 'tr' ? q : (saved === 'en' || saved === 'tr' ? saved
      : (navigator.language || '').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en');
  } catch (e) { /* depo yok: TR */ }

  function t(k, p) {
    var s = (T[lang] && T[lang][k]) || T.tr[k] || '';
    return s.replace(/\{(\w+)\}/g, function (m, n) { return p && p[n] !== undefined ? p[n] : m; });
  }
  function $(id) { return document.getElementById(id); }

  function applyLang() {
    document.documentElement.lang = lang;
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.textContent = t(el.getAttribute('data-t')); });
    Array.prototype.forEach.call(document.querySelectorAll('.lang button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang));
    });
  }

  function api(path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; });
    });
  }

  function say(el, text, kind) { el.textContent = text; el.className = 'msg' + (kind ? ' msg--' + kind : ''); }

  var current = null;   // { domain, methods }
  var method = 'dns';

  function showMethods(d) {
    current = d;
    $('dnsName').textContent = d.methods.dns.name;
    $('dnsValue').textContent = d.methods.dns.value;
    $('fileUrl').textContent = d.methods.file.url;
    $('fileContent').textContent = d.methods.file.content;
    $('metaTag').textContent = d.methods.meta.tag;
    $('methodCard').hidden = false;
    say($('checkMsg'), d.status === 'verified' ? t('already') : '', d.status === 'verified' ? 'ok' : '');
  }

  function selectMethod(m) {
    method = m;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-method') === m));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (p) {
      p.hidden = p.getAttribute('data-panel') !== m;
    });
  }

  function loadList() {
    api('/api/verify/list').then(function (r) {
      if (r.status !== 200) return;
      var ul = $('list');
      ul.textContent = '';
      var items = r.data.items || [];
      if (!items.length) {
        var li0 = document.createElement('li');
        li0.textContent = t('none');
        ul.appendChild(li0);
      }
      items.forEach(function (it) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.textContent = it.domain + (it.method ? ' · ' + it.method.toUpperCase() : '');
        var b = document.createElement('span');
        b.className = 'badge ' + (it.status === 'verified' ? 'badge--ok' : 'badge--wait');
        b.textContent = it.status === 'verified' ? t('stVerified') : t('stPending');
        li.appendChild(name);
        li.appendChild(b);
        ul.appendChild(li);
      });
      $('listCard').hidden = false;
    });
  }

  function start(domain) {
    var btn = $('startBtn');
    btn.disabled = true;
    api('/api/verify/init', { domain: domain }).then(function (r) {
      btn.disabled = false;
      if (r.status === 200) { say($('startMsg'), ''); showMethods(r.data); loadList(); return; }
      if (r.status === 401) { showLogin(); return; }
      say($('startMsg'), r.status === 400 ? t('invalid') : t('error'), 'bad');
    }, function () { btn.disabled = false; say($('startMsg'), t('error'), 'bad'); });
  }

  function check() {
    if (!current) return;
    var btn = $('checkBtn');
    btn.disabled = true;
    api('/api/verify/check', { domain: current.domain, method: method }).then(function (r) {
      btn.disabled = false;
      var e = (r.data && r.data.error) || {};
      if (r.status === 200) { say($('checkMsg'), t('verified'), 'ok'); loadList(); return; }
      if (r.status === 409) { say($('checkMsg'), t('notFound', { n: e.attemptsLeft }), 'warn'); return; }
      if (r.status === 429) { say($('checkMsg'), t('cooldown', { m: Math.ceil((e.retryAfter || 3600) / 60) }), 'bad'); return; }
      if (r.status === 401) { showLogin(); return; }
      say($('checkMsg'), t('error'), 'bad');
    }, function () { btn.disabled = false; say($('checkMsg'), t('error'), 'bad'); });
  }

  function showLogin() {
    $('startCard').hidden = true;
    $('methodCard').hidden = true;
    $('listCard').hidden = true;
    /* Panelde dönüş adresi parametresi yok: giriş sonrası bu sayfaya geri gelinir. */
    $('loginLink').href = '/panel';
    $('loginCard').hidden = false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyLang();
    Array.prototype.forEach.call(document.querySelectorAll('.lang button'), function (b) {
      b.addEventListener('click', function () {
        lang = b.getAttribute('data-lang');
        try { localStorage.setItem('cl_lang', lang); } catch (e) { /* yok */ }
        applyLang();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      b.addEventListener('click', function () { selectMethod(b.getAttribute('data-method')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (b) {
      b.addEventListener('click', function () {
        var text = $(b.getAttribute('data-copy')).textContent;
        var done = function () { b.textContent = t('copied'); setTimeout(function () { b.textContent = t('copy'); }, 1500); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
      });
    });
    $('startForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('domainInput').value.trim();
      if (!v) { say($('startMsg'), t('invalid'), 'bad'); return; }
      start(v);
    });
    $('checkBtn').addEventListener('click', check);

    /* Oturum yoksa giriş kartı; varsa başlat kartı + liste. */
    api('/api/auth/me').then(function (r) {
      if (r.status !== 200 || !r.data || r.data.authenticated !== true) { showLogin(); return; }
      $('startCard').hidden = false;
      loadList();
      var pre = new URLSearchParams(location.search).get('domain');
      if (pre) { $('domainInput').value = pre; start(pre); }
    }, showLogin);
  });
})();
