/* Yönetim: düzeltme siparişleri. GET/POST /api/admin/fix-orders. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function load() {
    var st = $('status').value;
    fetch('/api/admin/fix-orders' + (st ? '?status=' + st : ''), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { s: r.status, b: b }; }); })
      .then(function (x) {
        var ul = $('orders'); ul.textContent = '';
        if (x.s !== 200) { $('msg').textContent = x.s === 403 ? 'Yetkiniz yok.' : x.s === 401 ? 'Giriş yapın.' : 'Okunamadı (' + x.s + ').'; return; }
        $('msg').textContent = (x.b.items || []).length + ' sipariş';
        (x.b.items || []).forEach(function (o) {
          var li = document.createElement('li');
          li.style.flexWrap = 'wrap';
          var info = document.createElement('span');
          info.textContent = new Date(o.created_at).toLocaleString('tr-TR') + ' · ' + o.domain + ' · ' + (o.finding_ids || []).join(', ')
            + ' · ₺' + o.price_discounted + ' (' + o.plan + ') · ' + o.status + ' · ' + o.id;
          li.appendChild(info);
          var acts = document.createElement('span');
          ['paid', 'done', 'cancelled'].forEach(function (s) {
            if (o.status === s) return;
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'btn btn--ghost'; b.style.marginLeft = '6px';
            b.textContent = s === 'paid' ? 'Ödendi' : s === 'done' ? 'Tamamlandı' : 'İptal';
            b.addEventListener('click', function () {
              if (!window.confirm(o.domain + ' → ' + b.textContent + '?')) return;
              fetch('/api/admin/fix-orders', { method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ id: o.id, status: s }) }).then(load);
            });
            acts.appendChild(b);
          });
          li.appendChild(acts);
          ul.appendChild(li);
        });
      });
  }
  document.addEventListener('DOMContentLoaded', function () {
    $('status').addEventListener('change', load);
    $('reload').addEventListener('click', load);
    load();
  });
})();
