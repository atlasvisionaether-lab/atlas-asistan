/**
 * Ödeme formlarının (/odeme, /fix-checkout) fatura alanları — TEK KAYNAK.
 *
 * Hem tarayıcıda (<script src="/billing-form.js">, window.clBilling) hem
 * sunucuda (require, api/_lib/billing-details.js) çalışır: ülke tablosu,
 * telefon ve kimlik kuralları iki tarafta ayrışamaz.
 *
 * TELEFON: kullanıcı ülkeyi seçer, kutunun solunda kodu görür, yalnızca
 * numarayı yazar. Kod SUNUCUDA tablodan eklenir (tarayıcının gönderdiği
 * önek kullanılmaz). Listede olmayan ülke ("Diğer"): numara +kodla yazılır.
 *
 * KİMLİK: isteğe bağlı. 11 hane TC kimlik ya da 10 hane vergi no; ikisi de
 * resmi sağlama algoritmasıyla denetlenir. Boşsa iyzico'ya 11111111111.
 */
(function (root) {
  'use strict';

  /* [görünen ad (iyzico'ya giden ülke), telefon kodu]. Türkiye varsayılan. */
  var COUNTRIES = [
    ['Türkiye', '+90'], ['KKTC', '+90'], ['Almanya', '+49'], ['Birleşik Krallık', '+44'],
    ['ABD', '+1'], ['Kanada', '+1'], ['Hollanda', '+31'], ['Fransa', '+33'], ['Belçika', '+32'],
    ['Avusturya', '+43'], ['İsviçre', '+41'], ['İtalya', '+39'], ['İspanya', '+34'],
    ['İsveç', '+46'], ['Norveç', '+47'], ['Danimarka', '+45'], ['Yunanistan', '+30'],
    ['Bulgaristan', '+359'], ['Romanya', '+40'], ['Kıbrıs', '+357'], ['Azerbaycan', '+994'],
    ['Gürcistan', '+995'], ['Rusya', '+7'], ['Ukrayna', '+380'],
    ['Birleşik Arap Emirlikleri', '+971'], ['Suudi Arabistan', '+966'], ['Katar', '+974'],
    ['Avustralya', '+61']
  ];
  var OTHER = '__diger__';

  function dialOf(country) {
    for (var i = 0; i < COUNTRIES.length; i += 1) if (COUNTRIES[i][0] === country) return COUNTRIES[i][1];
    return null;
  }

  /**
   * Telefonu E.164'e çevirir; geçersizse null.
   *   dial '+90' (ya da verilmemiş): 5XX…, 05XX…, 905XX…, +905XX… → +905XXXXXXXXX
   *   başka kod: yerel numara (baştaki 0'lar atılır) → kod + numara
   *   + ya da 00 ile yazılmışsa: tam uluslararası numara (en çok 15 hane)
   */
  function normalizeGsm(raw, dial) {
    if (typeof raw !== 'string') return null;
    var s = raw.trim();
    var digits = s.replace(/[\s\-().]/g, '');
    /* "00" uluslararası önek = "+". */
    var plus = digits.charAt(0) === '+' || /^00[1-9]/.test(digits);
    digits = digits.replace(/^\+/, '').replace(/^00(?=[1-9])/, '');
    if (!/^\d+$/.test(digits)) return null;
    var tr = null;
    if (plus || !dial || dial === '+90') {
      if (/^5\d{9}$/.test(digits) && !plus) tr = digits;
      else if (/^05\d{9}$/.test(digits) && !plus) tr = digits.slice(1);
      else if (/^905\d{9}$/.test(digits)) tr = digits.slice(2);
      if (tr) return '+90' + tr;
    }
    if (plus) return /^[1-9]\d{7,14}$/.test(digits) && !/^90/.test(digits) ? '+' + digits : null;
    if (!dial || dial === '+90') return null;
    var code = dial.replace('+', '');
    /* Yurt içi önek (trunk prefix) atılır: çoğu ülkede 0 (Birleşik Krallık
       07… → 7…); Rusya'da 8 (8 912… → 912…), ABD/Kanada'da 1 (1 202… →
       202…); İtalya'da yok (0 numaranın parçası). PR #118 incelemesi:
       Rusya "8 912 345 67 89" → +789… gidiyordu. */
    var local = digits;
    if (code === '7') local = /^8\d{10}$/.test(local) ? local.slice(1) : local;
    else if (code === '1') local = /^1\d{10}$/.test(local) ? local.slice(1) : local;
    else if (code !== '39') local = local.replace(/^0+/, '');
    if (!/^\d{6,14}$/.test(local) || (code + local).length > 15) return null;
    return '+' + code + local;
  }

  /** TC kimlik: 11 hane, ilk hane 0 değil, iki sağlama hanesi. */
  function isValidTckn(s) {
    if (!/^[1-9]\d{10}$/.test(String(s))) return false;
    var d = String(s).split('').map(Number);
    var d10 = (((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10 + 10) % 10;
    var top = 0;
    for (var i = 0; i < 10; i += 1) top += d[i];
    return d[9] === d10 && d[10] === top % 10;
  }

  /** Vergi kimlik no (VKN): 10 hane, son hane sağlama (GİB algoritması). */
  function isValidVkn(s) {
    if (!/^\d{10}$/.test(String(s))) return false;
    var d = String(s).split('').map(Number);
    var top = 0;
    for (var i = 0; i < 9; i += 1) {
      var t = (d[i] + 9 - i) % 10;
      var v = (t * Math.pow(2, 9 - i)) % 9;
      if (t !== 0 && v === 0) v = 9;
      top += v;
    }
    return (10 - (top % 10)) % 10 === d[9];
  }

  /** İsteğe bağlı kimlik: boş → '', geçerli TC/VKN → rakamlar, geçersiz → null. */
  function cleanIdentity(raw) {
    var s = typeof raw === 'string' ? raw.replace(/[\s.-]/g, '') : '';
    if (!s) return '';
    if (s.length === 11) return isValidTckn(s) ? s : null;
    if (s.length === 10) return isValidVkn(s) ? s : null;
    return null;
  }

  var api = { COUNTRIES: COUNTRIES, OTHER: OTHER, dialOf: dialOf, normalizeGsm: normalizeGsm,
    isValidTckn: isValidTckn, isValidVkn: isValidVkn, cleanIdentity: cleanIdentity };

  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.clBilling = api;

  /* --- Tarayıcı: ülke listesi ve telefon öneki --- */
  function kur() {
    var sec = document.getElementById('ulke');
    var onek = document.getElementById('gsmPrefix');
    var digerKutu = document.getElementById('ulkeDigerWrap');
    var diger = document.getElementById('ulkeDiger');
    var gsm = document.getElementById('gsm');
    if (!sec || sec.tagName !== 'SELECT') return;
    COUNTRIES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c[0]; o.textContent = c[0] + ' (' + c[1] + ')';
      sec.appendChild(o);
    });
    var od = document.createElement('option');
    od.value = OTHER; od.textContent = 'Diğer / Other';
    sec.appendChild(od);
    sec.value = 'Türkiye';
    function guncelle() {
      var d = sec.value === OTHER ? null : dialOf(sec.value);
      if (onek) onek.textContent = d || '+';
      if (digerKutu) digerKutu.hidden = sec.value !== OTHER;
      if (diger) diger.required = sec.value === OTHER;
      if (gsm) gsm.placeholder = d === '+90' ? '555 444 33 22' : (d ? 'numara / number' : '+49 1512 3456789');
    }
    sec.addEventListener('change', guncelle);
    guncelle();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kur);
  else kur();
})(typeof window !== 'undefined' ? window : this);
