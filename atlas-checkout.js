/**
 * atlasasistan.com /checkout — sipariş formu.
 *
 * Kurallar /atlas-billing.js'te (sunucuyla ortak); burada yalnızca arayüz:
 *   - Ülke + telefon: intl-tel-input (bayrak, ad, kod; varsayılan TR; ülkeye
 *     göre örnek numara; yalnızca rakam). Gönderilen telefon E.164, ülke
 *     ISO 3166-1 alpha-2.
 *   - Fatura Bilgileri (Opsiyonel) akordeonu: Bireysel/Kurumsal; TR'de
 *     TC / VKN + vergi dairesi, TR dışında Tax/VAT ID (+ kurumsalsa sicil no).
 *   - Yurt dışı aktarım onayı yalnızca AB/AEA dışı ülkede görünür ve zorunlu.
 *   - Hata: kırmızı kenarlık + mesaj (TR/EN, ?lang=en); geçerli: yeşil ✓.
 *
 * Gönderim: ödeme ucu açıksa (GET /api/atlas-checkout?mode=1) iyzico'ya,
 * kapalıysa eskisi gibi WhatsApp mesajına.
 */
(function () {
  'use strict';

  var rules = window.atlasBilling;
  var form = document.getElementById('coForm');
  if (!form || !rules) return;

  var lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'tr';
  var plan = window.atlasPlan || { key: 'pro', name: '', price: '', period: '' };
  var WHATSAPP = '905344682769';

  var UI = {
    tr: {
      submitPay: 'Güvenli Ödemeye Geç', submitWa: 'WhatsApp ile Siparişi Tamamla', sending: 'Yönlendiriliyor…',
      payModeOn: 'Ödemeyi iyzico\'nun güvenli sayfasında tamamlarsınız.',
      payModeTest: 'TEST MODU: gerçek kart kullanmayın.',
      statusSuccess: 'Ödemeniz alındı, teşekkürler! Kurulum için kısa süre içinde sizinle iletişime geçeceğiz.',
      statusPending: 'Ödemeniz bankanız ya da iyzico tarafından inceleniyor. Sonuçlanınca size bilgi vereceğiz.',
      statusFailed: 'Ödeme tamamlanamadı; kartınızdan tutar çekilmedi. Bilgileri kontrol edip tekrar deneyebilirsiniz.'
    },
    en: {
      name: 'Full name', namePh: 'Your first and last name', clinic: 'Clinic / business name', clinicPh: 'Your business name',
      phone: 'Country and phone', phoneHint: 'Click the flag to choose your country; the code is added automatically.',
      email: 'Email', address: 'Billing address', addressPh: 'Street, number, district', city: 'City', cityPh: 'City',
      billingTitle: 'Billing details (optional)', billingType: 'Billing type', individual: 'Individual', corporate: 'Company',
      tcNo: 'Turkish ID number (TCKN)', tcPh: '11 digits', tcHint: 'Needed for the invoice; you can leave it blank.',
      taxNo: 'Tax number (VKN)', vknPh: '10 digits', taxOffice: 'Tax office', taxOfficePh: 'e.g. Kadıköy',
      vatId: 'Tax ID / VAT ID', companyRegNo: 'Company registration no',
      consentPpf: 'I have read and accept the <a href="pages/on-bilgilendirme-formu.html" target="_blank" rel="noopener">Pre-Information Form</a> and the <a href="pages/mesafeli-satis-sozlesmesi.html" target="_blank" rel="noopener">Distance Sales Agreement</a>.',
      consentTransfer: 'I explicitly consent to the transfer of my personal data to service providers abroad for payment and invoicing, as described in the <a href="pages/kvkk-aydinlatma-metni.html" target="_blank" rel="noopener">Privacy Notice</a>.',
      terms: 'By completing the order you accept the <a href="pages/kullanim-sartlari.html">Terms of Use</a> and the <a href="pages/teslimat-ve-iade-sartlari.html">Refund Policy</a>.',
      submitPay: 'Continue to secure payment', submitWa: 'Complete order on WhatsApp', sending: 'Redirecting…',
      payModeOn: 'You complete the payment on iyzico\'s secure page.',
      payModeTest: 'TEST MODE: do not use a real card.',
      statusSuccess: 'Payment received, thank you! We will contact you shortly to set things up.',
      statusPending: 'Your payment is being reviewed by your bank or iyzico. We will let you know the result.',
      statusFailed: 'Payment could not be completed and your card was not charged. Please check your details and try again.'
    }
  };
  function t(key) { return (UI[lang] && UI[lang][key]) || UI.tr[key] || ''; }

  /* --- Dil: TR sayfa varsayılanı; ?lang=en formu İngilizceye çevirir --- */
  if (lang === 'en') {
    form.querySelectorAll('[data-i18n]').forEach(function (el) { if (UI.en[el.dataset.i18n]) el.textContent = UI.en[el.dataset.i18n]; });
    form.querySelectorAll('[data-i18n-html]').forEach(function (el) { if (UI.en[el.dataset.i18nHtml]) el.innerHTML = UI.en[el.dataset.i18nHtml]; });
    form.querySelectorAll('[data-i18n-ph]').forEach(function (el) { if (UI.en[el.dataset.i18nPh]) el.placeholder = UI.en[el.dataset.i18nPh]; });
    form.querySelectorAll('[data-i18n-aria]').forEach(function (el) { if (UI.en[el.dataset.i18nAria]) el.setAttribute('aria-label', UI.en[el.dataset.i18nAria]); });
  }

  var $ = function (id) { return document.getElementById(id); };
  var phoneInput = $('co-phone');
  var submitBtn = $('co-submit');
  var submitErr = $('co-submit-err');
  var transferWrap = $('co-transfer-wrap');

  /* --- Ülke + telefon --- */
  var iti = window.intlTelInput ? window.intlTelInput(phoneInput, {
    initialCountry: 'tr',
    countryOrder: ['tr', 'de', 'gb', 'us', 'nl', 'fr', 'at', 'be', 'ch', 'az', 'cy'],
    countryNameLocale: lang,
    separateDialCode: true,
    strictMode: true,
    formatAsYouType: true,
    placeholderNumberPolicy: 'AGGRESSIVE',
    numberDisplayFormat: 'NATIONAL',
    allowedNumberTypes: ['MOBILE', 'FIXED_LINE'],
    uiTranslations: lang === 'tr' ? { searchPlaceholder: 'Ülke ara', searchEmptyState: 'Sonuç bulunamadı' } : {}
  }) : null;

  function country() {
    var c = iti && iti.getSelectedCountry();
    return c && c.iso2 ? c.iso2.toUpperCase() : 'TR';
  }
  function billingType() {
    var r = form.querySelector('input[name="billingType"]:checked');
    return r ? r.value : 'individual';
  }

  /* --- Alan eşlemesi: doğrulama kodu → giriş kutusu --- */
  var FIELDS = {
    name: 'co-name', clinic: 'co-clinic', phone: 'co-phone', email: 'co-email', address: 'co-address',
    city: 'co-city', tcNo: 'co-tc', taxNo: 'co-vkn', taxOffice: 'co-taxoffice', vatId: 'co-vat',
    companyRegNo: 'co-reg', consentPpf: 'co-consent', consentTransfer: 'co-transfer'
  };
  var touched = {};
  var pressingSubmit = false;
  submitBtn.addEventListener('pointerdown', function () { pressingSubmit = true; });
  document.addEventListener('pointerup', function () {
    /* click (ve submit) pointerup'tan sonra gelir; bayrak o tur bitince iner. */
    if (pressingSubmit) setTimeout(function () { pressingSubmit = false; validate(false); }, 0);
  });

  function collect() {
    return {
      plan: plan.key,
      lang: lang,
      name: $('co-name').value,
      clinic: $('co-clinic').value,
      email: $('co-email').value,
      country: country(),
      /* E.164 (iti doğrulamasından bağımsız; asıl karar libphonenumber-js). */
      phone: iti ? (iti.getNumber() || phoneInput.value) : phoneInput.value,
      address: $('co-address').value,
      city: $('co-city').value,
      billing: {
        type: billingType(),
        tcNo: $('co-tc').value,
        taxNo: $('co-vkn').value,
        taxOffice: $('co-taxoffice').value,
        vatId: $('co-vat').value,
        companyRegNo: $('co-reg').value
      },
      consentPpf: $('co-consent').checked,
      consentTransfer: !transferWrap.hidden && $('co-transfer').checked
    };
  }

  function fieldBox(name) {
    return form.querySelector('[data-field="' + name + '"]');
  }

  function paint(name, code) {
    var box = fieldBox(name);
    var input = $(FIELDS[name]);
    if (!box || !input || box.hidden) return;
    var err = box.querySelector('.err');
    var filled = input.type === 'checkbox' ? input.checked : input.value.trim() !== '';
    box.classList.toggle('invalid', !!code);
    box.classList.toggle('valid', !code && filled && input.type !== 'checkbox');
    input.setAttribute('aria-invalid', code ? 'true' : 'false');
    if (err) { err.textContent = code ? rules.msg(lang, code) : ''; err.hidden = !code; }
  }

  /* Yalnızca dokunulmuş alanlar boyanır; gönderimde hepsi. */
  function validate(all) {
    var res = rules.validateOrder(collect());
    Object.keys(FIELDS).forEach(function (name) {
      if (all || touched[name]) paint(name, res.errors[name]);
    });
    return res;
  }

  /* --- Görünürlük: ülke ve fatura tipine göre --- */
  function applyVisibility() {
    var tr = country() === 'TR';
    var type = billingType();
    form.querySelectorAll('[data-show]').forEach(function (box) {
      var tokens = box.dataset.show.split(' ');
      var show = tokens.every(function (tok) {
        if (tok === 'tr') return tr;
        if (tok === 'intl') return !tr;
        return tok === type;
      });
      box.hidden = !show;
    });
    transferWrap.hidden = !rules.needsTransferConsent(country());
  }

  Object.keys(FIELDS).forEach(function (name) {
    var input = $(FIELDS[name]);
    if (!input) return;
    var mark = function () {
      touched[name] = true;
      /* Gönder'e basılırken kutudan çıkılıyorsa boyama gönderime kalır: hata
         mesajı belirip düzeni kaydırırsa buton imlecin altından kayar ve
         tıklama hiç gerçekleşmez. */
      if (!pressingSubmit) validate(false);
    };
    input.addEventListener(input.type === 'checkbox' ? 'change' : 'blur', mark);
    /* Hatalı alan düzeldikçe hata hemen kalksın. */
    input.addEventListener('input', function () { if (touched[name]) validate(false); });
  });
  /* TC / VKN kutularına yalnızca rakam. */
  ['co-tc', 'co-vkn'].forEach(function (id) {
    $(id).addEventListener('input', function (e) {
      var v = e.target.value.replace(/\D/g, '');
      if (v !== e.target.value) e.target.value = v;
    });
  });
  form.querySelectorAll('input[name="billingType"]').forEach(function (r) {
    r.addEventListener('change', function () { applyVisibility(); validate(false); });
  });
  phoneInput.addEventListener('countrychange', function () { applyVisibility(); validate(false); });
  applyVisibility();

  /* --- Ödeme modu --- */
  var mode = { enabled: false, testMode: null };
  function applyMode() {
    submitBtn.textContent = mode.enabled ? t('submitPay') : t('submitWa');
    var pm = $('co-pay-mode');
    if (pm && mode.enabled) pm.textContent = t('payModeOn') + (mode.testMode ? ' ' + t('payModeTest') : '');
  }
  fetch('/api/atlas-checkout?mode=1', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d) { mode = d; applyMode(); } })
    .catch(function () { /* uç yok/kapalı: WhatsApp */ });

  /* --- iyzico dönüşü: ?status=success|pending|failed --- */
  var status = new URLSearchParams(location.search).get('status');
  if (['success', 'pending', 'failed'].indexOf(status) !== -1) {
    var box = $('co-status');
    box.className = 'co-status ' + status;
    box.textContent = t('status' + status.charAt(0).toUpperCase() + status.slice(1));
    box.hidden = false;
  }

  function whatsappUrl(v) {
    var b = v.billing;
    var lines = [
      'Merhaba, ' + plan.name + ' (' + plan.price + ' ' + plan.period + ') satın almak istiyorum.', '',
      'Ad Soyad: ' + v.name, 'Klinik: ' + v.clinic, 'Telefon: ' + v.phoneE164, 'E-posta: ' + v.email,
      'Ülke: ' + v.country, 'Adres: ' + v.address + ', ' + v.city
    ];
    var fatura = [];
    if (b.tcNo) fatura.push('TC: ' + b.tcNo);
    if (b.taxNo) fatura.push('VKN: ' + b.taxNo);
    if (b.taxOffice) fatura.push('Vergi Dairesi: ' + b.taxOffice);
    if (b.vatId) fatura.push('VAT ID: ' + b.vatId);
    if (b.companyRegNo) fatura.push('Sicil No: ' + b.companyRegNo);
    if (fatura.length) lines.push('Fatura (' + (b.type === 'corporate' ? 'Kurumsal' : 'Bireysel') + '): ' + fatura.join(', '));
    return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(lines.join('\n'));
  }

  function showSubmitError(text) {
    submitErr.textContent = text;
    submitErr.hidden = !text;
  }

  function focusFirstInvalid(errors) {
    var order = Object.keys(FIELDS);
    for (var i = 0; i < order.length; i += 1) {
      if (errors[order[i]]) {
        var box = fieldBox(order[i]);
        if (box && box.closest('details') && !box.closest('details').open) box.closest('details').open = true;
        $(FIELDS[order[i]]).focus();
        return;
      }
    }
  }

  function busy(on) {
    submitBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    submitBtn.disabled = on;
    submitBtn.textContent = on ? t('sending') : (mode.enabled ? t('submitPay') : t('submitWa'));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    showSubmitError('');
    var res = validate(true);
    if (!res.ok) { focusFirstInvalid(res.errors); return; }

    if (!mode.enabled) {
      window.open(whatsappUrl(res.value), '_blank', 'noopener');
      return;
    }

    busy(true);
    fetch('/api/atlas-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(collect())
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; });
    }).then(function (r) {
      if (r.status === 200 && r.data.url) { location.assign(r.data.url); return; }
      busy(false);
      if (r.status === 400 && r.data.errors) {
        Object.keys(r.data.errors).forEach(function (k) { paint(k, r.data.errors[k]); });
        focusFirstInvalid(r.data.errors);
        return;
      }
      if (r.status === 503) {
        /* Ödeme kapandı: sipariş WhatsApp'tan tamamlansın (yeni sekme değil,
           açılır pencere engelleyicisi await sonrası window.open'ı keser). */
        mode.enabled = false; applyMode();
        showSubmitError(rules.msg(lang, 'unavailable'));
        location.href = whatsappUrl(res.value);
        return;
      }
      showSubmitError(rules.msg(lang, (r.data.error && r.data.error.code) === 'plan' ? 'plan' : 'payment'));
    }).catch(function () {
      busy(false);
      showSubmitError(rules.msg(lang, 'payment'));
    });
  });

  applyMode();
})();
