/* Düzeltme siparişi: özet + iyzico ödemesi (/fix-checkout?orderId=…).
   GET /api/fix-order okunur; ödeme POST /api/fix-pay (form) → iyzico.
   Gösterilen tutar KDV DAHİL ve iyzico'dan çekilen tutarın aynısı
   (fixpricing: KDV dahil, 50'nin katı). */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var ST = { pending: 'Ödeme bekleniyor / Awaiting payment', paid: 'Ödendi, hizmet başladı — en geç 3 iş günü / Paid, in progress — within 3 business days',
    done: 'Tamamlandı / Done', cancelled: 'İptal / Cancelled' };
  /* Dönüşte /fix-checkout?pay=… */
  var PAY = {
    success: 'Ödemeniz alındı, teşekkürler. Hizmet başladı. / Payment received, thank you. The service has started.',
    failed: 'Ödeme tamamlanamadı; kartınızdan çekim yapılmadı. Tekrar deneyebilirsiniz. / Payment could not be completed; you were not charged. You can try again.',
    pending: 'Ödeme sonucu doğrulanıyor; birkaç dakika içinde e-posta ile bilgi verilir. / Verifying the payment; you will be notified by email shortly.',
    unavailable: 'Çevrimiçi ödeme şu an başlatılamadı. destek@cyberlionai.com adresine yazın. / Online payment could not be started right now.',
    already: 'Bu sipariş için ödeme zaten alınmış. / This order has already been paid.',
    login: 'Ödeme için giriş yapın. / Please sign in to pay.',
    invalid: 'Ödeme oturumu bulunamadı; sayfayı yenileyip tekrar deneyin. / Payment session not found; please refresh and try again.'
  };
  var ALAN = {
    ad: ['adSoyad', 'Lütfen adınızı ve soyadınızı yazın.'],
    gsm: ['gsm', 'Lütfen geçerli bir cep telefonu yazın (ülke kodu otomatik eklenir; ör. 555 444 33 22). Listede olmayan ülkede numarayı +kodla yazın.'],
    adres: ['adres', 'Lütfen fatura adresinizi yazın (en az 10 karakter).'],
    il: ['il', 'Lütfen ilinizi yazın.'],
    ilce: ['ilce', 'İlçe adı geçersiz.'],
    ulke: ['ulke', 'Lütfen ülkenizi yazın.'],
    tckn: ['tckn', 'TC kimlik / vergi numarası geçersiz (11 haneli TC ya da 10 haneli vergi no). Boş bırakabilirsiniz.']
  };
  function tl(n) {
    var v = Number(n);
    var o = v % 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {};
    try { return '₺' + v.toLocaleString('tr-TR', o); } catch (e) { return '₺' + n; }
  }
  function row(k, v) {
    var li = document.createElement('li');
    var a = document.createElement('span'); a.textContent = k;
    var b = document.createElement('span'); b.textContent = v;
    li.appendChild(a); li.appendChild(b); return li;
  }
  /* Telefon ve kimlik kuralları sunucuyla ORTAK (/billing-form.js →
     window.clBilling); son karar yine sunucuda. */
  function ulkeAdi() {
    var u = $('ulke').value;
    return u === window.clBilling.OTHER ? $('ulkeDiger').value.trim() : u;
  }
  function gsmOk(v) {
    var B = window.clBilling;
    var diger = $('ulke').value === B.OTHER;
    if (diger && !/^\s*(\+|00)/.test(v)) return false;
    return !!B.normalizeGsm(v, diger ? null : B.dialOf($('ulke').value));
  }
  function tcknOk(v) { return window.clBilling.cleanIdentity(v) !== null; }
  function payMsg(text, el) {
    $('payMsg').textContent = text;
    $('payMsg').hidden = false;
    if (el) el.focus();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(location.search);
    var id = params.get('orderId') || '';
    var pay = params.get('pay');
    fetch('/api/fix-order?id=' + encodeURIComponent(id), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { s: r.status, b: b }; }); })
      .then(function (x) {
        if (x.s === 401) { $('msg').textContent = 'Siparişi görmek için giriş yapın. / Sign in to view the order.'; return; }
        if (x.s !== 200) { $('msg').textContent = 'Sipariş bulunamadı. / Order not found.'; return; }
        var o = x.b;
        $('msg').textContent = o.status === 'pending' ? 'Siparişiniz alındı; ödeme bekleniyor. / Order received; awaiting payment.'
          : 'Siparişiniz alındı. / Your order has been received.';
        var d = $('details');
        d.appendChild(row('Sipariş / Order', o.orderId));
        d.appendChild(row('Alan adı / Domain', o.domain));
        d.appendChild(row('Bulgular / Findings', (o.findingIds || []).join(', ')));
        d.appendChild(row('Paket / Package', o.type === 'full' ? 'Tam paket / Full package' : 'Seçili bulgular / Selected findings'));
        d.appendChild(row('Toplam / Total', tl(o.amountGross) + ' (KDV dahil / VAT incl.)'
          + (o.price !== o.priceDiscounted ? ' — liste / list ' + tl(o.listGross) : '')));
        d.appendChild(row('Durum / Status', ST[o.status] || o.status));
        d.hidden = false;

        if (o.status === 'pending') {
          $('fOrder').value = o.orderId;
          $('payBtn').textContent = 'Güvenli Öde - iyzico ile (' + tl(o.amountGross) + ')';
          $('payCard').hidden = false;
        }
        if (pay === 'details_required') {
          var h = ALAN[params.get('field')] || ['adSoyad', 'Lütfen fatura bilgilerinizi kontrol edin.'];
          payMsg(h[1], $(h[0]));
        } else if (pay && PAY[pay]) {
          if (o.status === 'pending') payMsg(PAY[pay]);
          else { $('msg').textContent = PAY[pay]; }
        }
      }, function () { $('msg').textContent = 'Sipariş okunamadı. / Could not load the order.'; });

    var form = $('payForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      $('payMsg').hidden = true;
      var ad = $('adSoyad').value.trim().replace(/\s+/g, ' ');
      if (ad.length < 3 || ad.indexOf(' ') === -1) return payMsg(ALAN.ad[1], $('adSoyad'));
      if (!gsmOk($('gsm').value.trim())) return payMsg(ALAN.gsm[1], $('gsm'));
      if ($('adres').value.trim().replace(/\s+/g, ' ').length < 10) return payMsg(ALAN.adres[1], $('adres'));
      if ($('il').value.trim().length < 2) return payMsg(ALAN.il[1], $('il'));
      if (ulkeAdi().length < 2) return payMsg(ALAN.ulke[1], $('ulke'));
      var tckn = $('tckn').value.replace(/[\s.-]+/g, '');
      if (tckn && !tcknOk(tckn)) return payMsg(ALAN.tckn[1], $('tckn'));
      $('adSoyad').value = ad;
      $('payBtn').disabled = true;
      $('payBtn').textContent = 'iyzico\'ya yönlendiriliyorsunuz… / Redirecting to iyzico…';
      form.submit();
    });
    /* Geri tuşuyla (bfcache) dönülürse düğme kilitli kalmasın. */
    window.addEventListener('pageshow', function () { $('payBtn').disabled = false; });
  });
})();
