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

  /* Sunucunun (api/_lib/billing-details.js) kurallarının aynısı: tarayıcıda
     erken uyarı. Son karar sunucuda. */
  function gsmOk(v) {
    var d = v.replace(/[\s\-().]/g, '');
    if (/^\+?(90)?0?5\d{9}$/.test(d)) return true;
    return /^\+[1-9]\d{7,14}$/.test(d) && !/^\+90/.test(d);
  }
  function tcknOk(v) {
    if (!/^[1-9]\d{10}$/.test(v)) return false;
    var d = v.split('').map(Number);
    var d10 = (((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10 + 10) % 10;
    var top = 0; for (var i = 0; i < 10; i += 1) top += d[i];
    return d[9] === d10 && d[10] === top % 10;
  }
  var ALAN_MESAJ = {
    ad: ['adSoyad', 'Lütfen adınızı ve soyadınızı yazın.'],
    gsm: ['gsm', 'Lütfen geçerli bir cep telefonu yazın (ör. 0555 444 33 33).'],
    adres: ['adres', 'Lütfen fatura adresinizi yazın (en az 10 karakter).'],
    il: ['il', 'Lütfen ilinizi yazın.'],
    ilce: ['ilce', 'İlçe adı geçersiz.'],
    ulke: ['ulke', 'Lütfen ülkenizi yazın.'],
    tckn: ['tckn', 'TC kimlik numarası geçersiz. Boş bırakabilirsiniz.']
  };

  function fail(msg, el) {
    err.textContent = msg;
    err.hidden = false;
    if (el) el.focus();
  }

  /* Sunucu bir fatura alanını reddettiyse (/odeme?checkout=details_required&field=gsm). */
  if (params.get('checkout') === 'details_required') {
    var hata = ALAN_MESAJ[params.get('field')] || ['adSoyad', 'Lütfen fatura bilgilerinizi kontrol edin.'];
    fail(hata[1], $(hata[0]));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;

    var ad = $('adSoyad').value.trim().replace(/\s+/g, ' ');
    var eposta = $('eposta').value.trim();

    if (ad.length < 3 || ad.indexOf(' ') === -1) return fail('Lütfen adınızı ve soyadınızı yazın.', $('adSoyad'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) return fail('Lütfen geçerli bir e-posta adresi yazın.', $('eposta'));
    if (!gsmOk($('gsm').value.trim())) return fail(ALAN_MESAJ.gsm[1], $('gsm'));
    if ($('adres').value.trim().replace(/\s+/g, ' ').length < 10) return fail(ALAN_MESAJ.adres[1], $('adres'));
    if ($('il').value.trim().length < 2) return fail(ALAN_MESAJ.il[1], $('il'));
    if ($('ulke').value.trim().length < 2) return fail(ALAN_MESAJ.ulke[1], $('ulke'));
    var tckn = $('tckn').value.replace(/\s+/g, '');
    if (tckn && !tcknOk(tckn)) return fail(ALAN_MESAJ.tckn[1], $('tckn'));
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

    /* POST: fatura bilgileri URL'ye düşmesin. form.submit() submit olayını
       yeniden tetiklemez. */
    $('adSoyad').value = ad;
    $('fPlan').value = planKey;
    $('fDeclaration').value = '1';
    $('fAgreements').value = '1';
    form.submit();
  });

  /* Geri tuşuyla (bfcache) dönülürse buton kilitli kalmasın. */
  window.addEventListener('pageshow', function () {
    var btn = $('payBtn');
    btn.disabled = false;
    btn.textContent = 'Güvenli Öde - iyzico ile';
  });
})();
