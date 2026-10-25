/* /araclar/spf-dmarc — POST /api/tool-check { type: 'email' }.
   Harici dosya: satır içi script CSP hash'i gerektirirdi. Metin yalnızca
   textContent ile yazılır (kayıtlar hedef alan adının DNS'inden gelir). */
(function () {
  'use strict';

  var form = document.getElementById('form');
  var input = document.getElementById('site');
  var btn = document.getElementById('btn');
  var msg = document.getElementById('msg');
  var result = document.getElementById('result');

  var DURUM = { pass: 'Geçti', fail: 'Sorunlu', skipped: 'Ölçülemedi' };
  var HATA = {
    empty: 'Lütfen bir alan adı girin.',
    invalid_url: 'Bu adres geçerli görünmüyor. Örnek: ornek.com',
    too_long: 'Adres çok uzun.',
    bad_protocol: 'Yalnızca alan adı girin. Örnek: ornek.com',
    credentials_not_allowed: 'Adreste kullanıcı adı veya şifre olmamalı.',
    blocked_port: 'Yalnızca alan adı girin. Örnek: ornek.com',
    bad_domain: 'IP adresinin SPF/DMARC kaydı olmaz; alan adı girin. Örnek: ornek.com',
    domain_not_found: 'Alan adı DNS\'te bulunamadı. Yazımı kontrol edin.',
    dns_failed: 'DNS sorgusu tamamlanamadı. Biraz sonra tekrar deneyin.',
    rate_limited: 'Bugünkü ücretsiz kontrol hakkınız doldu. Yarın tekrar deneyin veya tam taramayı kullanın.'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function tl(n) { return '₺' + Number(n).toLocaleString('tr-TR'); }

  function goster(r) {
    var s = r.summary;
    var band = s.fail === 0 && s.pass === s.total ? 'good' : s.pass > 0 ? 'mid' : 'bad';
    document.getElementById('score').className = 'score score--' + band;
    document.getElementById('scoreNum').textContent = s.pass + '/' + s.total;
    document.getElementById('scoreText').textContent = r.host + ' e-posta kimlik doğrulaması';
    var olculemeyen = s.total - s.pass - s.fail;
    document.getElementById('summary').textContent =
      s.total + ' kontrolden ' + s.pass + ' geçti, ' + s.fail + ' sorunlu' +
      (olculemeyen ? ', ' + olculemeyen + ' ölçülemedi.' : '.');

    var box = document.getElementById('findings');
    box.textContent = '';
    r.checks.forEach(function (c) {
      var item = el('div', 'finding');
      var head = el('div', 'finding__head');
      head.appendChild(el('strong', null, c.name));
      head.appendChild(el('span', 'st st--' + c.status, DURUM[c.status] || c.status));
      item.appendChild(head);
      if (c.problem) item.appendChild(el('p', null, c.problem));
      else if (c.status === 'pass' && c.detail) item.appendChild(el('p', null, 'Politika: ' + c.detail));
      if (c.records && c.records.length) {
        item.appendChild(el('p', 'rec-label', c.id === 'dmarc' && r.dmarcName ? r.dmarcName + ' kaydı:' : 'Yayındaki kayıt:'));
        c.records.forEach(function (k) { item.appendChild(el('code', 'rec', k)); });
      }
      if (c.risk) item.appendChild(el('p', null, c.risk));
      if (c.fix) {
        item.appendChild(el('p', 'rec-label', 'Öneri:'));
        item.appendChild(el('code', null, c.fix));
      }
      box.appendChild(item);
    });

    document.getElementById('passAll').hidden = s.pass !== s.total;
    // Ana sayfa formu ?site= ile önceden dolar; tarama yine kullanıcıyla başlar.
    document.getElementById('ctaScan').href = '/?site=' + encodeURIComponent(r.host) + '&kaynak=email#scanForm';

    var fix = document.getElementById('ctaFix');
    fix.href = '/pricing?kaynak=email';
    var fiyatlar = r.checks.map(function (c) { return c.fixPrice; }).filter(Boolean);
    if (fiyatlar.length) {
      fix.textContent = 'Bunu biz düzeltelim — ' + tl(Math.min.apply(null, fiyatlar)) + '’den başlayan fiyatlarla';
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
      body: JSON.stringify({ type: 'email', url: url })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (r) {
      if (!r.ok || !r.body || !r.body.checks) {
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
