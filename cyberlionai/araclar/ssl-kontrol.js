/* /araclar/ssl-kontrol — POST /api/tool-check { type: 'ssl' }.
   Harici dosya: satır içi script CSP hash'i gerektirirdi. Metin yalnızca
   textContent ile yazılır (sertifika alanları hedef sunucudan gelir). */
(function () {
  'use strict';

  var form = document.getElementById('form');
  var input = document.getElementById('site');
  var btn = document.getElementById('btn');
  var msg = document.getElementById('msg');
  var result = document.getElementById('result');

  var SEV = { critical: 'Kritik', high: 'Yüksek', medium: 'Orta', low: 'Düşük' };
  var NOT = {
    expired: 'Sertifikanın süresi dolmuş.',
    expiring_soon: 'Sertifikanın bitmesine 15 günden az kaldı.',
    chain_incomplete: 'Sunucu ara sertifikayı göndermiyor; zincir eksik.',
    self_signed: 'Sertifika kendinden imzalı; tarayıcılar güvenmez.',
    hostname_mismatch: 'Sertifika bu alan adını kapsamıyor.',
    revoked: 'Sertifika iptal edilmiş.',
    untrusted: 'Sertifika doğrulanamadı.'
  };
  var ZINCIR = {
    ok: ['ok', 'Tam ve güvenilir'],
    chain_incomplete: ['bad', 'Eksik — ara sertifika gönderilmiyor'],
    self_signed: ['bad', 'Kendinden imzalı'],
    untrusted: ['bad', 'Doğrulanamadı'],
    unknown: ['unk', 'Ölçülemedi (sertifika başka bir sebeple geçersiz)']
  };
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
    no_https: 'Bu adres HTTPS (443) üzerinden yanıt vermiyor. Siteniz yalnızca HTTP ile çalışıyorsa en önemli eksik budur: ücretsiz bir Let\'s Encrypt sertifikasıyla HTTPS açılabilir.',
    unreachable: 'Siteye ulaşılamadı.',
    rate_limited: 'Bugünkü ücretsiz kontrol hakkınız doldu. Yarın tekrar deneyin veya tam taramayı kullanın.'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function tl(n) { return '₺' + Number(n).toLocaleString('tr-TR'); }

  function tarih(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function satir(dl, ad, durum, metin) {
    dl.appendChild(el('dt', null, ad));
    dl.appendChild(el('dd', durum, metin));
  }

  function bilgiler(c) {
    var dl = document.getElementById('facts');
    dl.textContent = '';

    if (c.validTo) {
      var gun = c.daysLeft;
      var kalan = gun < 0 ? (-gun) + ' gün önce doldu' : gun + ' gün kaldı';
      satir(dl, 'Bitiş tarihi', gun < 15 ? 'bad' : 'ok', tarih(c.validTo) + ' (' + kalan + ')');
    } else {
      satir(dl, 'Bitiş tarihi', 'unk', 'Ölçülemedi');
    }

    var z = ZINCIR[c.chain] || ZINCIR.unknown;
    satir(dl, 'Sertifika zinciri', z[0], z[1] + (c.chainLength ? ' · ' + c.chainLength + ' sertifika' : '') +
      (c.issuer ? ' · ' + c.issuer : ''));

    satir(dl, 'Alan adı uyumu', c.hostnameMatch === true ? 'ok' : c.hostnameMatch === false ? 'bad' : 'unk',
      c.hostnameMatch === true ? 'Uyumlu (CN/SAN)' : c.hostnameMatch === false ? 'Uyumsuz — sertifika bu adı kapsamıyor' : 'Ölçülemedi');

    var tlsMetin;
    var tlsDurum;
    if (c.modernTls === true) {
      tlsMetin = c.protocol.replace('TLSv', 'TLS ') + ' destekleniyor';
      tlsDurum = c.legacyAccepted ? 'bad' : 'ok';
      tlsMetin += c.legacyAccepted === true ? ' · eski TLS 1.0/1.1 de açık'
        : c.legacyAccepted === false ? ' · eski TLS 1.0/1.1 kapalı' : '';
    } else if (c.modernTls === false) {
      tlsDurum = 'bad'; tlsMetin = 'TLS 1.2/1.3 desteklenmiyor';
    } else {
      tlsDurum = 'unk'; tlsMetin = 'Ölçülemedi';
    }
    satir(dl, 'TLS sürümü', tlsDurum, tlsMetin);

    satir(dl, 'HSTS', !c.hstsMeasured ? 'unk' : c.hsts ? 'ok' : 'bad',
      !c.hstsMeasured ? 'Ölçülemedi (sertifika geçersizken tarayıcı HSTS\'yi dikkate almaz)'
        : c.hsts ? c.hsts : 'Yok');
  }

  function goster(r) {
    var scoreBox = document.getElementById('score');
    var band = r.score == null ? 'mid' : r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'bad';
    scoreBox.className = 'score score--' + band;
    document.getElementById('scoreNum').textContent = r.score == null ? '–' : String(r.score);
    document.getElementById('scoreText').textContent = '/ 100 · ' + r.host + ' SSL/TLS puanı';
    var olculemeyen = r.summary.total - r.summary.pass - r.summary.fail;
    document.getElementById('summary').textContent =
      r.summary.total + ' kontrolden ' + r.summary.pass + ' geçti, ' + r.summary.fail + ' sorunlu' +
      (olculemeyen ? ', ' + olculemeyen + ' ölçülemedi.' : '.');

    bilgiler(r.cert);

    var box = document.getElementById('findings');
    box.textContent = '';
    r.top.forEach(function (f) {
      var item = el('div', 'finding');
      var head = el('div', 'finding__head');
      head.appendChild(el('strong', null, f.name));
      head.appendChild(el('span', 'sev sev--' + f.severity, SEV[f.severity] || f.severity));
      item.appendChild(head);
      if (f.note && NOT[f.note]) item.appendChild(el('p', null, NOT[f.note]));
      if (f.risk) item.appendChild(el('p', null, f.risk));
      if (f.fix) item.appendChild(el('code', null, f.fix));
      box.appendChild(item);
    });

    document.getElementById('passAll').hidden = r.top.length > 0 || r.summary.pass !== r.summary.total;
    document.getElementById('hidden').textContent = r.hiddenFailures > 0
      ? '+' + r.hiddenFailures + ' bulgu daha var. Hepsini, düzeltme kodlarıyla birlikte tam taramada görün.'
      : '';
    // Ana sayfa formu ?site= ile önceden dolar; tarama yine kullanıcıyla başlar.
    document.getElementById('ctaScan').href = '/?site=' + encodeURIComponent(r.host) + '#scanForm';

    var fix = document.getElementById('ctaFix');
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
    msg.textContent = 'Kontrol ediliyor… (birkaç saniye sürebilir)';
    fetch('/api/tool-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ssl', url: url })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (r) {
      if (!r.ok || !r.body || !r.body.cert) {
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
