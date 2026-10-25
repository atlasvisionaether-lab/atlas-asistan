/* Yönetim: dönüşüm hunisi. GET /api/admin/funnel. Metin yalnızca textContent ile. */
(function () {
  'use strict';
  var AD = { headers: 'Güvenlik başlıkları', email: 'SPF / DMARC', ssl: 'SSL', blacklist: 'Kara liste', direct: 'Doğrudan' };
  var OLAY = { tool_use: 'Araç kullanımı', scan: 'Tam tarama', checkout_start: 'Abonelik formu', checkout_success: 'Abonelik ödendi',
    fix_checkout_start: 'Düzeltme formu', fix_paid: 'Düzeltme ödendi' };
  var msg = document.getElementById('msg');

  function hucre(tr, tag, text, cls) {
    var c = document.createElement(tag);
    c.textContent = text;
    if (cls) c.className = cls;
    tr.appendChild(c);
  }
  function oran(pay, payda) { return payda > 0 ? '%' + Math.round(pay * 100 / payda) : '–'; }

  function ozet(r) {
    var t = document.getElementById('tablo');
    t.textContent = '';
    var bas = document.createElement('tr');
    ['Kaynak', OLAY.tool_use, OLAY.scan, 'Araç → tarama', OLAY.checkout_start, OLAY.checkout_success,
      OLAY.fix_checkout_start, OLAY.fix_paid, 'Araç → herhangi bir ödeme']
      .forEach(function (h) { hucre(bas, 'th', h); });
    t.appendChild(bas);
    r.sources.forEach(function (s) {
      var x = r.totals;
      var tr = document.createElement('tr');
      hucre(tr, 'td', AD[s] || s);
      hucre(tr, 'td', s === 'direct' ? '–' : String(x.tool_use[s]));
      hucre(tr, 'td', String(x.scan[s]));
      hucre(tr, 'td', s === 'direct' ? '–' : oran(x.scan[s], x.tool_use[s]), 'oran');
      hucre(tr, 'td', String(x.checkout_start[s]));
      hucre(tr, 'td', String(x.checkout_success[s]));
      hucre(tr, 'td', String(x.fix_checkout_start[s]));
      hucre(tr, 'td', String(x.fix_paid[s]));
      hucre(tr, 'td', s === 'direct' ? '–' : oran(x.checkout_success[s] + x.fix_paid[s], x.tool_use[s]), 'oran');
      t.appendChild(tr);
    });
  }

  function gunluk(r) {
    var t = document.getElementById('gunluk');
    t.textContent = '';
    var bas = document.createElement('tr');
    ['Gün'].concat(r.events.map(function (e) { return OLAY[e] || e; })).forEach(function (h) { hucre(bas, 'th', h); });
    t.appendChild(bas);
    r.daily.slice().reverse().forEach(function (d) {
      var tr = document.createElement('tr');
      hucre(tr, 'td', d.day);
      r.events.forEach(function (e) {
        var top = 0;
        r.sources.forEach(function (s) { top += d.counts[e][s]; });
        hucre(tr, 'td', String(top));
      });
      t.appendChild(tr);
    });
  }

  function yukle() {
    msg.className = 'msg'; msg.textContent = 'Yükleniyor…';
    fetch('/api/admin/funnel?days=' + document.getElementById('days').value, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; }); })
      .then(function (r) {
        if (!r.ok) {
          msg.className = 'msg msg--bad';
          msg.textContent = r.status === 401 ? 'Önce giriş yapın.' : r.status === 403 ? 'Bu sayfa yalnızca yöneticiler içindir.' : 'Veri okunamadı.';
          return;
        }
        msg.textContent = '';
        ozet(r.body); gunluk(r.body);
      })
      .catch(function () { msg.className = 'msg msg--bad'; msg.textContent = 'Bağlantı hatası.'; });
  }
  document.getElementById('reload').addEventListener('click', yukle);
  document.getElementById('days').addEventListener('change', yukle);
  yukle();
})();
