/* Silme sertifikası doğrulama sayfası (silme-sertifikasi.html).
   Kod adresten (?code=) ya da formdan alınır; /api/deletion-certificate'e
   sorulur. Tüm çıktı textContent ile yazılır. */
(function () {
  'use strict';

  var CODE_RE = /^DEL-[0-9A-HJKMNP-TV-Z]{8}$/;
  var SCOPE = { account: 'Hesap', conversations: 'Asistan konuşmaları', scans: 'Tarama geçmişi' };

  var form = document.getElementById('certForm');
  var input = document.getElementById('certCode');
  var btn = document.getElementById('certBtn');
  var out = document.getElementById('certResult');

  function el(tag, text) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function show(ok, title, rows) {
    while (out.firstChild) out.removeChild(out.firstChild);
    out.className = 'result ' + (ok ? 'result--ok' : 'result--bad');
    out.appendChild(el('h2', title));
    if (rows && rows.length) {
      var dl = el('dl');
      rows.forEach(function (r) { dl.appendChild(el('dt', r[0])); dl.appendChild(el('dd', r[1])); });
      out.appendChild(dl);
    }
    out.hidden = false;
  }

  function normalize(v) {
    var s = String(v || '').trim().toUpperCase().replace(/^#/, '');
    if (/^[0-9A-Z]{8}$/.test(s)) s = 'DEL-' + s;
    return s;
  }

  function verify(code) {
    if (!CODE_RE.test(code)) { show(false, 'Kod biçimi geçersiz. Örnek: DEL-7K3M9QX2'); return; }
    btn.disabled = true;
    fetch('/api/deletion-certificate?code=' + encodeURIComponent(code), {
      credentials: 'same-origin', headers: { Accept: 'application/json' }
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, data: d }; });
    }).then(function (r) {
      btn.disabled = false;
      if (r.status === 200 && r.data && r.data.valid) {
        var d = r.data;
        var counts = Object.keys(d.counts || {}).map(function (k) { return k + ': ' + d.counts[k]; }).join(', ');
        show(true, 'Geçerli sertifika', [
          ['Kod', '#' + d.code],
          ['Tarih', new Date(d.createdAt).toLocaleString('tr-TR')],
          ['Kapsam', (d.scopes || []).map(function (s) { return SCOPE[s] || s; }).join(', ')],
          ['Silinen kayıtlar', counts || '—']
        ]);
      } else if (r.status === 404) {
        show(false, 'Bu koda ait bir sertifika bulunamadı.');
      } else if (r.status === 429) {
        show(false, 'Çok fazla deneme. Bir dakika sonra tekrar deneyin.');
      } else {
        show(false, 'Doğrulama şu an yapılamıyor. Lütfen daha sonra tekrar deneyin.');
      }
    }).catch(function () {
      btn.disabled = false;
      show(false, 'Sunucuya ulaşılamadı.');
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = normalize(input.value);
    input.value = code;
    verify(code);
  });

  var fromUrl = new URLSearchParams(location.search).get('code');
  if (fromUrl) {
    input.value = normalize(fromUrl);
    verify(input.value);
  }
})();
