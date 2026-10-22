'use strict';

/**
 * iyzico abonelik müşterisinin fatura bilgileri: doğrulama ve biçimleme.
 *
 * iyzico abonelik formunu müşteri adı, telefonu, TC kimlik numarası ve fatura
 * adresi olmadan başlatmıyor (canlıda 2026-10-22: 200702 "Müşteri telefon
 * numarası zorunlu alandır"). Alanlar resmi istemcinin SubscriptionCustomer /
 * SubscriptionAddress modelleriyle aynı.
 *
 * KVKK: Bu bilgiler /odeme formundan POST gövdesiyle gelir (URL'de değil),
 * yalnızca iyzico'ya iletilir; LOGLANMAZ, veritabanına YAZILMAZ.
 *
 * TC kimlik isteğe bağlı (2026-10-22 kararı): girilirse biçim ve sağlama
 * algoritması denetlenir; boşsa iyzico'nun kendi örneğindeki ve GİB'in
 * e-arşivde kimliği bilinmeyen alıcı için kullandığı 11111111111 gider.
 */

const UNKNOWN_TCKN = '11111111111';

function text(raw, min, max) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) return null;
  return s;
}

/**
 * Telefonu E.164'e çevirir. Türkiye cep: 05XX…, 5XX…, 905XX…, +90 5XX…
 * (boşluk, tire, parantez serbest) → +905XXXXXXXXX. Yurt dışı numara + ile
 * başlamalı (+ ve 8–15 hane). Geçersizse null.
 */
function normalizeGsm(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const plus = s.charAt(0) === '+';
  const digits = s.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;
  let tr = null;
  if (/^5\d{9}$/.test(digits)) tr = digits;
  else if (/^05\d{9}$/.test(digits)) tr = digits.slice(1);
  else if (/^905\d{9}$/.test(digits)) tr = digits.slice(2);
  if (tr) return '+90' + tr;
  if (plus && !/^90/.test(digits) && /^[1-9]\d{7,14}$/.test(digits)) return '+' + digits;
  return null;
}

/** TC kimlik numarası sağlama algoritması (11 hane, ilk hane 0 değil). */
function isValidTckn(s) {
  if (!/^[1-9]\d{10}$/.test(String(s))) return false;
  const d = String(s).split('').map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = ((odd * 7 - even) % 10 + 10) % 10;
  const d11 = (d.slice(0, 10).reduce(function (a, b) { return a + b; }, 0)) % 10;
  return d[9] === d10 && d[10] === d11;
}

/**
 * Form alanlarından iyzico müşterisini kurar.
 *   input: { ad, gsm, adres, il, ilce, ulke, tckn }, email: hesabın e-postası
 *   → { ok: true, customer } | { ok: false, field }
 * `field` hangi alanın eksik/geçersiz olduğunu söyler (ad, gsm, adres, il,
 * ulke, tckn); değer geri yansıtılmaz.
 */
function buildCustomer(input, email, nameSplit) {
  const src = input || {};
  const ad = nameSplit(src.ad, email);
  /* customerName geçersiz adı e-posta yer tutucusuna çevirir (soyad "-"):
     faturada gerçek ad gerekiyor, yer tutucu kabul edilmiyor. */
  if (!ad || ad.surname === '-') return { ok: false, field: 'ad' };

  const gsm = normalizeGsm(src.gsm);
  if (!gsm) return { ok: false, field: 'gsm' };

  const adres = text(src.adres, 10, 250);
  if (!adres) return { ok: false, field: 'adres' };
  const il = text(src.il, 2, 50);
  if (!il || !/^[\p{L}][\p{L}' .-]*$/u.test(il)) return { ok: false, field: 'il' };
  const ulke = text(src.ulke || 'Türkiye', 2, 56);
  if (!ulke || !/^[\p{L}][\p{L}' .-]*$/u.test(ulke)) return { ok: false, field: 'ulke' };
  const ilce = src.ilce ? text(src.ilce, 2, 50) : null;
  if (src.ilce && String(src.ilce).trim() && !ilce) return { ok: false, field: 'ilce' };

  const tcknRaw = typeof src.tckn === 'string' ? src.tckn.replace(/\s+/g, '') : '';
  if (tcknRaw && !isValidTckn(tcknRaw)) return { ok: false, field: 'tckn' };

  const address = {
    contactName: ad.name + ' ' + ad.surname,
    city: il,
    country: ulke,
    address: adres
  };
  if (ilce) address.district = ilce;

  return {
    ok: true,
    customer: {
      name: ad.name,
      surname: ad.surname,
      email: String(email || ''),
      gsmNumber: gsm,
      identityNumber: tcknRaw || UNKNOWN_TCKN,
      billingAddress: address,
      shippingAddress: Object.assign({}, address)
    }
  };
}

/**
 * Tek seferlik ödemenin alıcısı (resmi Buyer + Address modelleri), aynı
 * doğrulanmış müşteriden. `ip` iyzico'nun zorunlu alanı.
 */
function buyerFrom(customer, userId, ip) {
  const a = customer.billingAddress;
  return {
    buyer: {
      id: String(userId),
      name: customer.name,
      surname: customer.surname,
      identityNumber: customer.identityNumber,
      email: customer.email,
      gsmNumber: customer.gsmNumber,
      registrationAddress: a.address,
      city: a.city,
      country: a.country,
      ip: String(ip || '').slice(0, 45) || '0.0.0.0'
    },
    address: { contactName: a.contactName, city: a.city, country: a.country, address: a.address }
  };
}

module.exports = { normalizeGsm, isValidTckn, buildCustomer, buyerFrom, UNKNOWN_TCKN };
