/**
 * atlasasistan.com sipariş formu — doğrulama kuralları ve hata metinleri.
 * TEK KAYNAK: tarayıcıda window.atlasBilling, sunucuda require
 * (api/atlas-checkout.js). İki taraf aynı kuralla karar verir.
 *
 * TC kimlik ve VKN sağlama algoritmaları burada YAZILMAZ: cyberlionai'nin
 * /billing-form.js'inden gelir (tarayıcıda window.clBilling, sunucuda
 * require). Telefon libphonenumber-js ile (tarayıcıda window.libphonenumber).
 *
 * Telefon E.164 (+905321234567), ülke ISO 3166-1 alpha-2 (TR, DE, US).
 * Fatura alanlarının hepsi isteğe bağlı; doluysa biçimi denetlenir.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cyberlionai/billing-form.js'), require('libphonenumber-js/max'));
  } else {
    root.atlasBilling = factory(root.clBilling, root.libphonenumber);
  }
})(typeof window !== 'undefined' ? window : this, function (cl, phoneLib) {
  'use strict';

  /* AB + AEA (GDPR). Bu ülkelerde yurt dışı aktarım onayı kutusu gösterilmez. */
  var EU_EEA = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO'];
  /* AB KDV numarasında Yunanistan'ın öneki EL. */
  var VAT_PREFIX = { GR: 'EL' };

  var MESSAGES = {
    tr: {
      required: 'Bu alan zorunludur.',
      name: 'Ad ve soyadınızı yazın.',
      clinic: 'İşletme adı 2–120 karakter olmalı.',
      email: 'Geçerli bir e-posta adresi yazın.',
      country: 'Ülke seçin.',
      phone: 'Bu ülke için geçerli bir telefon numarası yazın.',
      address: 'Açık adres 10–250 karakter olmalı.',
      city: 'Şehir adını yazın.',
      tcNo: 'TC Kimlik No geçersiz: 11 hane olmalı, 0 ile başlamamalı.',
      taxNo: 'Vergi No (VKN) geçersiz: 10 haneli olmalı.',
      taxOffice: 'Vergi dairesi adı 2–60 harf olmalı.',
      vatId: 'Vergi / KDV numarası geçersiz.',
      companyRegNo: 'Şirket sicil numarası 2–30 karakter olmalı.',
      consentPpf: 'Devam etmek için ön bilgilendirme formunu ve mesafeli satış sözleşmesini onaylayın.',
      consentTransfer: 'Verilerinizin yurt dışına aktarımı için onay gerekiyor.',
      plan: 'Paket bulunamadı.',
      unavailable: 'Çevrimiçi ödeme şu an kapalı. Lütfen biraz sonra tekrar deneyin.',
      payment: 'Ödeme sayfası açılamadı. Lütfen tekrar deneyin.'
    },
    en: {
      required: 'This field is required.',
      name: 'Enter your first and last name.',
      clinic: 'Business name must be 2–120 characters.',
      email: 'Enter a valid email address.',
      country: 'Select a country.',
      phone: 'Enter a valid phone number for this country.',
      address: 'Address must be 10–250 characters.',
      city: 'Enter your city.',
      tcNo: 'Invalid Turkish ID number: 11 digits, cannot start with 0.',
      taxNo: 'Invalid tax number (VKN): must be 10 digits.',
      taxOffice: 'Tax office must be 2–60 letters.',
      vatId: 'Invalid tax / VAT ID.',
      companyRegNo: 'Company registration number must be 2–30 characters.',
      consentPpf: 'Please accept the pre-information form and distance sales agreement.',
      consentTransfer: 'Consent to transfer your data abroad is required.',
      plan: 'Package not found.',
      unavailable: 'Online payment is currently unavailable. Please try again shortly.',
      payment: 'Could not open the payment page. Please try again.'
    }
  };

  function msg(lang, code) {
    var table = MESSAGES[lang === 'en' ? 'en' : 'tr'];
    return table[code] || table.required;
  }

  function clean(v, max) {
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 500);
  }

  function digits(v) {
    return typeof v === 'string' ? v.replace(/[\s.-]/g, '') : '';
  }

  /* RFC 5322'nin pratik alt kümesi: tek @, boşluk yok, alan adında nokta. */
  function isValidEmail(s) {
    return typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  }

  function isIso2(s) {
    return /^[A-Z]{2}$/.test(String(s || '')) && !!phoneLib && phoneLib.isSupportedCountry(s);
  }

  /** Telefonu ülkeye göre E.164'e çevirir; geçersizse null. */
  function toE164(raw, iso2) {
    if (!phoneLib || typeof raw !== 'string' || !raw.trim()) return null;
    try {
      var p = phoneLib.parsePhoneNumberFromString(raw, iso2);
      return p && p.isValid() ? p.number : null;
    } catch (e) {
      return null;
    }
  }

  /** TC Kimlik No: 11 hane, ilk hane 0 değil; (tekler×7 − çiftler) mod 10 = 10. hane, ilk 10 toplamı mod 10 = 11. hane. */
  function isValidTckn(s) { return cl.isValidTckn(s); }

  /** VKN: 10 hane, son hane GİB mod-10 sağlaması. */
  function isValidVkn(s) { return cl.isValidVkn(s); }

  /** Yabancı vergi / KDV numarası. AB'de ülke önekiyle (DE123456789), başka yerde serbest biçim. */
  function isValidVatId(s, iso2) {
    var v = String(s || '').toUpperCase().replace(/[\s.-]/g, '');
    if (EU_EEA.indexOf(iso2) !== -1 && ['IS', 'LI', 'NO'].indexOf(iso2) === -1) {
      var prefix = VAT_PREFIX[iso2] || iso2;
      return new RegExp('^' + prefix + '[0-9A-Z]{2,12}$').test(v);
    }
    return /^[0-9A-Z]{2,20}$/.test(v);
  }

  function needsTransferConsent(iso2) {
    return EU_EEA.indexOf(iso2) === -1;
  }

  /**
   * Formu doğrular ve normalleştirir.
   *   input: { name, clinic, email, country, phone, address, city, billing: {type, tcNo, taxNo,
   *           taxOffice, vatId, companyRegNo}, consentPpf, consentTransfer }
   *   → { ok, errors: { alan: kod }, value }
   */
  function validateOrder(input) {
    var src = input || {};
    var b = src.billing || {};
    var errors = {};
    var value = {};

    value.name = clean(src.name, 100);
    if (!value.name) errors.name = 'required';
    else if (value.name.length < 3 || value.name.split(' ').length < 2
      || !/^[\p{L}][\p{L}' .-]*$/u.test(value.name)) errors.name = 'name';

    value.clinic = clean(src.clinic, 120);
    if (!value.clinic) errors.clinic = 'required';
    else if (value.clinic.length < 2) errors.clinic = 'clinic';

    value.email = clean(src.email, 254).toLowerCase();
    if (!value.email) errors.email = 'required';
    else if (!isValidEmail(value.email)) errors.email = 'email';

    value.country = String(src.country || '').toUpperCase();
    if (!isIso2(value.country)) errors.country = 'country';

    value.phoneE164 = errors.country ? null : toE164(String(src.phone || ''), value.country);
    if (!clean(src.phone)) errors.phone = 'required';
    else if (!value.phoneE164) errors.phone = 'phone';

    value.address = clean(src.address, 250);
    if (!value.address) errors.address = 'required';
    else if (value.address.length < 10) errors.address = 'address';

    value.city = clean(src.city, 50);
    if (!value.city) errors.city = 'required';
    else if (value.city.length < 2 || !/^[\p{L}][\p{L}' .-]*$/u.test(value.city)) errors.city = 'city';

    var tr = value.country === 'TR';
    var type = b.type === 'corporate' ? 'corporate' : 'individual';
    var billing = { type: type, tcNo: '', taxNo: '', taxOffice: '', country: value.country, vatId: '', companyRegNo: '' };

    /* Ülkeye ve tipe göre görünmeyen alanlar yok sayılır: TR dışında TC/VKN,
       TR'de VAT ID gönderilse bile kaydedilmez. */
    if (tr && type === 'individual') {
      billing.tcNo = digits(b.tcNo);
      if (billing.tcNo && !isValidTckn(billing.tcNo)) errors.tcNo = 'tcNo';
    }
    if (tr && type === 'corporate') {
      billing.taxNo = digits(b.taxNo);
      if (billing.taxNo && !isValidVkn(billing.taxNo)) errors.taxNo = 'taxNo';
      billing.taxOffice = clean(b.taxOffice, 60);
      if (billing.taxOffice && (billing.taxOffice.length < 2 || !/^[\p{L}][\p{L}' .-]*$/u.test(billing.taxOffice))) {
        errors.taxOffice = 'taxOffice';
      }
    }
    if (!tr) {
      billing.vatId = clean(b.vatId, 30).toUpperCase().replace(/[\s.-]/g, '');
      if (billing.vatId && !isValidVatId(billing.vatId, value.country)) errors.vatId = 'vatId';
      if (type === 'corporate') {
        billing.companyRegNo = clean(b.companyRegNo, 30);
        if (billing.companyRegNo && billing.companyRegNo.length < 2) errors.companyRegNo = 'companyRegNo';
      }
    }
    value.billing = billing;

    value.consentPpf = src.consentPpf === true;
    if (!value.consentPpf) errors.consentPpf = 'consentPpf';
    value.consentTransfer = src.consentTransfer === true;
    if (!errors.country && needsTransferConsent(value.country) && !value.consentTransfer) {
      errors.consentTransfer = 'consentTransfer';
    }

    return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
  }

  return {
    EU_EEA: EU_EEA, MESSAGES: MESSAGES, msg: msg,
    isValidEmail: isValidEmail, isValidTckn: isValidTckn, isValidVkn: isValidVkn,
    isValidVatId: isValidVatId, toE164: toE164, needsTransferConsent: needsTransferConsent,
    validateOrder: validateOrder
  };
});
