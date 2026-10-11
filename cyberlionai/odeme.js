/* /odeme sayfasının davranışı.
 *
 * Satır içi değil, ayrı dosya: CSP script-src 'self' bunu hash gerektirmeden
 * kabul ediyor.
 *
 * Fiyatlar api/_lib/plans.js ile AYNI olmak zorunda (KDV hariç tutar);
 * tools/pricing-test.js bu dosyadaki NET_TRY değerlerini oradaki priceTry ile
 * karşılaştırıyor. KDV oranı da orada (VAT_RATE).
 *
 * /api/checkout üç onay olmadan ödemeyi başlatmaz: tarama yetkisi beyanı
 * (declaration=1) ve sözleşme onayları (agreements=1). Üçü de burada alınır.
 *
 * Kart bilgisi bu sayfada ALINMAZ. "Güvenli Öde" /api/checkout'a gider; o uç
 * oturumu doğrular ve tarayıcıyı iyzico'nun barındırılan ödeme formuna
 * yönlendirir. Oturum yoksa /panel'e (giriş) gönderir.
 */
(function () {
  'use strict';

  var VAT_RATE = 0.20;
  var NET_TRY = { pro: 299, enterprise: 2499 };
  var NAMES = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };

  function tl(n) {
    return '₺' + n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function $(id) { return document.getElementById(id); }

  var params = new URLSearchParams(location.search);
  var planId = String(params.get('plan') || 'pro').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(NAMES, planId)) planId = 'pro';

  $('planName').textContent = NAMES[planId];
  $('sumPlan').textContent = 'Cyber Lion AI ' + NAMES[planId];

  if (planId === 'free') {
    $('planPrice').textContent = '₺0';
    $('planSub').textContent = 'Süresiz ücretsiz · Ödeme gerekmez';
    $('sumNet').textContent = tl(0);
    $('sumVat').textContent = tl(0);
    $('sumTotal').textContent = tl(0);
    $('payForm').hidden = true;
    $('freeBox').hidden = false;
    return;
  }

  var net = NET_TRY[planId];
  /* Kuruş hesabı tam sayıyla: 299 × 1,20 kayan noktada 358,79999… çıkar. */
  var vat = Math.round(net * VAT_RATE * 100) / 100;
  var gross = Math.round((net * 100) + (vat * 100)) / 100;

  $('planPrice').textContent = tl(gross);
  $('planSub').textContent = 'Aylık · KDV dahil (' + tl(net) + ' + %20 KDV)';
  $('sumNet').textContent = tl(net);
  $('sumVat').textContent = tl(vat);
  $('sumTotal').textContent = tl(gross);
  document.title = NAMES[planId] + ' — Güvenli Ödeme | Cyber Lion AI';

  /* Giriş yapılmışsa e-posta hesabınkiyle sabitlenir: abonelik o hesaba
     bağlanıyor, başka bir adres yazmak yanıltıcı olurdu. */
  if (typeof fetch === 'function') {
    fetch('/api/auth/me', { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) {
        if (me && me.authenticated && me.user && me.user.email) {
          var input = $('eposta');
          input.value = me.user.email;
          input.readOnly = true;
          $('epostaHint').textContent = 'Abonelik bu hesaba bağlanır.';
        }
      })
      .catch(function () {});
  }

  /* Ödeme açık mı: kapalıysa düğme iyzico'ya gitmez (gitse sunucu tarayıcıyı
     /pricing'e geri yollar ve kullanıcı "hiçbir şey olmadı" sanır). Bilinmiyorsa
     (istek düştü) karar sunucuya bırakılır. */
  var payMode = null;
  if (typeof fetch === 'function') {
    fetch('/api/checkout?mode=1', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m && typeof m.enabled === 'boolean') payMode = m; })
      .catch(function () {});
  }
  function payOpen() {
    if (!payMode) return true;
    return payMode.enabled === true && (payMode.plans || []).indexOf(planId) !== -1;
  }
  $('payClosedLink').setAttribute('href', '/checkout?plan=' + encodeURIComponent(planId));

  var form = $('payForm');
  var err = $('formErr');

  function fail(msg, el) {
    err.textContent = msg;
    err.hidden = false;
    if (el) el.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;

    var ad = $('adSoyad').value.trim().replace(/\s+/g, ' ');
    var eposta = $('eposta').value.trim();

    if (ad.length < 3 || ad.indexOf(' ') === -1) return fail('Lütfen adınızı ve soyadınızı yazın.', $('adSoyad'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) return fail('Lütfen geçerli bir e-posta adresi yazın.', $('eposta'));
    if (!$('onayYetki').checked) return fail('Devam etmek için tarama yetkisi beyanını onaylayın.', $('onayYetki'));
    if (!$('onayOnBilgi').checked) return fail('Devam etmek için Ön Bilgilendirme Formu\'nu onaylayın.', $('onayOnBilgi'));
    if (!$('onaySozlesme').checked) return fail('Devam etmek için Mesafeli Satış Sözleşmesi ve Gizlilik Politikası\'nı onaylayın.', $('onaySozlesme'));

    if (!payOpen()) {
      $('payClosed').hidden = false;
      $('payClosed').scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    var btn = $('payBtn');
    btn.disabled = true;
    btn.textContent = 'iyzico\'ya yönlendiriliyorsunuz…';

    window.location.href = '/api/checkout?plan=' + encodeURIComponent(planId)
      + '&declaration=1&agreements=1'
      + '&ad=' + encodeURIComponent(ad);
  });

  /* Geri tuşuyla (bfcache) dönülürse buton kilitli kalmasın. */
  window.addEventListener('pageshow', function () {
    var btn = $('payBtn');
    btn.disabled = false;
    btn.textContent = 'Güvenli Öde - iyzico ile';
  });
})();
