/* /odeme sayfasının davranışı.
 *
 * Satır içi değil, ayrı dosya: CSP script-src 'self' bunu hash gerektirmeden
 * kabul ediyor.
 *
 * Fiyatlar api/_lib/plans.js ile AYNI olmak zorunda (KDV DAHİL tutar);
 * tools/pricing-test.js bu dosyadaki GROSS_TRY değerlerini oradaki priceTry ile
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
  /* Ödeme seçeneği (plan_dönem) → KDV dahil tutar. Eski `plan=pro` aylık. */
  var GROSS_TRY = { pro_monthly: 249, pro_yearly: 2490, enterprise_monthly: 1990, enterprise_yearly: 19900 };
  var NAMES = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };
  var PERIOD_TR = { monthly: 'Aylık', yearly: 'Yıllık · 2 ay bedava' };

  function tl(n) {
    return '₺' + n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function $(id) { return document.getElementById(id); }

  var params = new URLSearchParams(location.search);
  var raw = String(params.get('plan') || 'pro').trim().toLowerCase();
  if (raw === 'pro' || raw === 'enterprise') raw += '_monthly';
  var planKey = Object.prototype.hasOwnProperty.call(GROSS_TRY, raw) || raw === 'free' ? raw : 'pro_monthly';
  var planId = planKey === 'free' ? 'free' : planKey.split('_')[0];
  var period = planKey === 'free' ? null : planKey.split('_')[1];

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

  var gross = GROSS_TRY[planKey];
  /* Fiyat KDV dahil; döküm ondan türetilir: net + KDV = gross tam tutar. */
  var net = Math.round(gross / (1 + VAT_RATE) * 100) / 100;
  var vat = Math.round((gross * 100) - (net * 100)) / 100;

  $('planPrice').textContent = tl(gross);
  $('planSub').textContent = PERIOD_TR[period] + ' · KDV dahil (' + tl(net) + ' + %20 KDV)';
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
    return payMode.enabled === true && (payMode.plans || []).indexOf(planKey) !== -1;
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

    window.location.href = '/api/checkout?plan=' + encodeURIComponent(planKey)
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
