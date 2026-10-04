/* Düzeltme siparişi özeti (/fix-checkout?orderId=…). GET /api/fix-order. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var ST = { pending: 'Ödeme bekleniyor / Awaiting payment', paid: 'Ödendi, hizmet başladı / Paid, in progress',
    done: 'Tamamlandı / Done', cancelled: 'İptal / Cancelled' };
  function tl(n) {
    try { return '₺' + Number(n).toLocaleString('tr-TR'); } catch (e) { return '₺' + n; }
  }
  function row(k, v) {
    var li = document.createElement('li');
    var a = document.createElement('span'); a.textContent = k;
    var b = document.createElement('span'); b.textContent = v;
    li.appendChild(a); li.appendChild(b); return li;
  }
  document.addEventListener('DOMContentLoaded', function () {
    var id = new URLSearchParams(location.search).get('orderId') || '';
    fetch('/api/fix-order?id=' + encodeURIComponent(id), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { s: r.status, b: b }; }); })
      .then(function (x) {
        if (x.s === 401) { $('msg').textContent = 'Siparişi görmek için giriş yapın. / Sign in to view the order.'; return; }
        if (x.s !== 200) { $('msg').textContent = 'Sipariş bulunamadı. / Order not found.'; return; }
        var o = x.b;
        $('msg').textContent = 'Siparişiniz alındı. / Your order has been received.';
        var d = $('details');
        d.appendChild(row('Sipariş / Order', o.orderId));
        d.appendChild(row('Alan adı / Domain', o.domain));
        d.appendChild(row('Bulgular / Findings', (o.findingIds || []).join(', ')));
        d.appendChild(row('Paket / Package', o.type === 'full' ? 'Tam paket / Full package' : 'Seçili bulgular / Selected findings'));
        d.appendChild(row('Tutar / Amount', tl(o.priceDiscounted) + (o.price !== o.priceDiscounted ? ' (liste / list ' + tl(o.price) + ')' : '') + ' + KDV / VAT'));
        d.appendChild(row('Durum / Status', ST[o.status] || o.status));
        d.hidden = false;
      }, function () { $('msg').textContent = 'Sipariş okunamadı. / Could not load the order.'; });
  });
})();
