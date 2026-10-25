/* /araclar/kara-liste — POST /api/tool-check { type: 'blacklist' }.
   Harici dosya: satır içi script CSP hash'i gerektirirdi. Metin yalnızca
   textContent ile yazılır.

   Google Web Risk koşulları: eşleşme kesin dille söylenmez ("olası"),
   "Advisory provided by Google" atfı ve tehdit türüne göre bilgi bağlantısı
   gösterilir; temiz sonuç "güvenli" değil "kayıt bulunamadı" der. */
(function () {
  'use strict';

  var form = document.getElementById('form');
  var input = document.getElementById('site');
  var btn = document.getElementById('btn');
  var msg = document.getElementById('msg');
  var result = document.getElementById('result');

  var HATA = {
    empty: 'Lütfen bir site adresi girin.',
    invalid_url: 'Bu adres geçerli görünmüyor. Örnek: ornek.com',
    too_long: 'Adres çok uzun.',
    bad_protocol: 'Yalnızca http ve https adresleri desteklenir.',
    credentials_not_allowed: 'Adreste kullanıcı adı veya şifre olmamalı.',
    blocked_port: 'Yalnızca standart portlar (80, 443, 8080, 8443) desteklenir.',
    unavailable: 'Kara liste kaynağına şu anda ulaşılamıyor. Biraz sonra tekrar deneyin.',
    rate_limited: 'Bugünkü ücretsiz kontrol hakkınız doldu. Yarın tekrar deneyin veya tam taramayı kullanın.'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function link(href, text) {
    var a = el('a', null, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  function tl(n) { return '₺' + Number(n).toLocaleString('tr-TR'); }

  function goster(r) {
    var verdict = document.getElementById('verdict');
    verdict.className = 'verdict verdict--' + (r.listed ? 'listed' : 'clean');
    document.getElementById('verdictText').textContent = r.listed
      ? 'Olası risk: Google Web Risk bu adresi işaretliyor'
      : 'Google Web Risk listelerinde bu adres için kayıt bulunamadı';
    var zaman = new Date(r.checkedAt);
    document.getElementById('checked').textContent = r.uri + ' · '
      + (isNaN(zaman) ? '' : zaman.toLocaleString('tr-TR') + ' itibarıyla');

    var box = document.getElementById('threats');
    box.textContent = '';
    r.threats.forEach(function (t) {
      var item = el('div', 'threat');
      item.appendChild(el('strong', null, 'Olası ' + t.label + ' kaynağı'));
      if (t.learnMore) {
        var p = el('p', 'note');
        p.appendChild(link(t.learnMore, 'Daha fazla bilgi →'));
        item.appendChild(p);
      }
      box.appendChild(item);
    });
    document.getElementById('fixBox').hidden = !r.listed;

    var atif = document.getElementById('attrib');
    atif.textContent = '';
    if (r.listed && r.advisoryUrl) {
      atif.appendChild(link(r.advisoryUrl, 'Advisory provided by Google'));
      atif.appendChild(document.createTextNode('. Google bilgilerinin eksiksiz ve hatasız olduğunu garanti edemez.'));
      atif.hidden = false;
    } else {
      atif.textContent = 'Bu sonuç sitenizin güvenli olduğu anlamına gelmez; yalnızca bu listede kayıt olmadığını gösterir. Genel güvenlik için tam taramayı kullanın.';
      atif.hidden = false;
    }

    // Ana sayfa formu ?site= ile önceden dolar; tarama yine kullanıcıyla başlar.
    document.getElementById('ctaScan').href = '/?site=' + encodeURIComponent(r.host) + '&kaynak=blacklist#scanForm';
    var fix = document.getElementById('ctaFix');
    fix.href = '/pricing?kaynak=blacklist';
    if (r.listed && r.fixPrice) {
      fix.textContent = 'Temizliği biz yapalım — ' + tl(r.fixPrice);
      fix.hidden = false;
    } else {
      fix.hidden = true;
    }
    result.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = input.value.trim();
    if (!url) { msg.className = 'msg msg--bad'; msg.textContent = HATA.empty; return; }
    btn.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Kontrol ediliyor…';
    fetch('/api/tool-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'blacklist', url: url })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (r) {
      if (!r.ok || !r.body || !r.body.threats) {
        var code = r.body && r.body.error && r.body.error.code;
        msg.className = 'msg msg--bad';
        msg.textContent = HATA[code] || 'Bir sorun oluştu. Lütfen tekrar deneyin.';
        return;
      }
      msg.textContent = '';
      goster(r.body);
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function () {
      msg.className = 'msg msg--bad';
      msg.textContent = 'Bağlantı hatası. Lütfen tekrar deneyin.';
    }).then(function () { btn.disabled = false; });
  });
})();
