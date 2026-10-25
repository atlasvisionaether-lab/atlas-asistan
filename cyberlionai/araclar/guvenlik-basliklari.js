/* /araclar/guvenlik-basliklari — POST /api/tool-check { type: 'headers' }.
   Harici dosya: satır içi script CSP hash'i gerektirirdi. Metin yalnızca
   textContent ile yazılır (başlık değerleri hedef siteden gelir). */
(function () {
  'use strict';

  var form = document.getElementById('form');
  var input = document.getElementById('site');
  var btn = document.getElementById('btn');
  var msg = document.getElementById('msg');
  var result = document.getElementById('result');

  var SEV = { critical: 'Kritik', high: 'Yüksek', medium: 'Orta', low: 'Düşük' };
  var HATA = {
    empty: 'Lütfen bir site adresi girin.',
    invalid_url: 'Bu adres geçerli görünmüyor. Örnek: ornek.com',
    too_long: 'Adres çok uzun.',
    bad_protocol: 'Yalnızca http ve https adresleri desteklenir.',
    credentials_not_allowed: 'Adreste kullanıcı adı veya şifre olmamalı.',
    blocked_port: 'Yalnızca standart portlar (80, 443, 8080, 8443) desteklenir.',
    blocked_target: 'Bu adres özel veya yerel bir ağa çıkıyor; kontrol edilemez.',
    dns_failed: 'Alan adı çözülemedi. Yazımı kontrol edin.',
    timeout: 'Site zamanında yanıt vermedi. Biraz sonra tekrar deneyin.',
    unreachable: 'Siteye ulaşılamadı.',
    cert_invalid: 'Sitenizin SSL sertifikası geçersiz; tarayıcılar ziyaretçilere uyarı gösteriyor. Önce sertifikayı düzeltin: SSL kontrolü sebebini ve çözümünü gösterir.',
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
    var scoreBox = document.getElementById('score');
    var band = r.score == null ? 'mid' : r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'bad';
    scoreBox.className = 'score score--' + band;
    document.getElementById('scoreNum').textContent = r.score == null ? '–' : String(r.score);
    document.getElementById('scoreText').textContent = '/ 100 · ' + r.host + ' başlık puanı';
    document.getElementById('summary').textContent =
      r.summary.total + ' kontrolden ' + r.summary.pass + ' geçti, ' + r.summary.fail + ' eksik.';

    var box = document.getElementById('findings');
    box.textContent = '';
    r.top.forEach(function (f) {
      var item = el('div', 'finding');
      var head = el('div', 'finding__head');
      head.appendChild(el('strong', null, f.name));
      head.appendChild(el('span', 'sev sev--' + f.severity, SEV[f.severity] || f.severity));
      item.appendChild(head);
      if (f.risk) item.appendChild(el('p', null, f.risk));
      if (f.fix) item.appendChild(el('code', null, f.fix));
      box.appendChild(item);
    });

    document.getElementById('passAll').hidden = r.top.length > 0;
    document.getElementById('hidden').textContent = r.hiddenFailures > 0
      ? '+' + r.hiddenFailures + ' bulgu daha var. Hepsini, düzeltme kodlarıyla birlikte tam taramada görün.'
      : '';

    // Ana sayfa formu ?site= ile önceden dolar; tarama yine kullanıcıyla başlar.
    document.getElementById('ctaScan').href = '/?site=' + encodeURIComponent(r.host) + '&kaynak=headers#scanForm';

    var fix = document.getElementById('ctaFix');
    fix.href = '/pricing?kaynak=headers';
    var fiyatlar = r.top.map(function (f) { return f.fixPrice; }).filter(Boolean);
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
      body: JSON.stringify({ type: 'headers', url: url })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (r) {
      if (!r.ok || !r.body || !r.body.top) {
        var code = r.body && r.body.error && r.body.error.code;
        msg.className = 'msg msg--bad';
        msg.textContent = HATA[code] || 'Bir sorun oluştu. Lütfen tekrar deneyin.';
        if (code === 'cert_invalid') {
          var link = el('a', null, ' SSL kontrolüne git →');
          link.href = '/araclar/ssl-kontrol';
          msg.appendChild(link);
        }
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
