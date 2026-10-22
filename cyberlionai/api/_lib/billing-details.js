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
 * TC kimlik / vergi no isteğe bağlı (2026-10-22 kararı): girilirse biçim ve
 * sağlama algoritması denetlenir (11 hane TC, 10 hane VKN); boşsa iyzico'nun kendi örneğindeki ve GİB'in
 * e-arşivde kimliği bilinmeyen alıcı için kullandığı 11111111111 gider.
 */

const UNKNOWN_TCKN = '11111111111';

function text(raw, min, max) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) return null;
  return s;
}

/* Telefon, ülke kodu ve kimlik kuralları tarayıcıyla ORTAK: /billing-form.js
   (tek kaynak; iki taraf ayrışamaz). */
const shared = require('../../billing-form.js');
const normalizeGsm = shared.normalizeGsm;
const isValidTckn = shared.isValidTckn;

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


  const adres = text(src.adres, 10, 250);
  if (!adres) return { ok: false, field: 'adres' };
  const il = text(src.il, 2, 50);
  if (!il || !/^[\p{L}][\p{L}' .-]*$/u.test(il)) return { ok: false, field: 'il' };
  /* Ülke listeden; "Diğer" seçildiyse elle yazılan ad. Telefon kodu SUNUCU
     tablosundan (tarayıcının gösterdiği önek kullanılmaz); listede olmayan
     ülkede numara +kodla yazılmış olmalı. */
  const digerMi = src.ulke === shared.OTHER;
  const ulke = text(digerMi ? src.ulkeDiger : (src.ulke || 'Türkiye'), 2, 56);
  if (!ulke || !/^[\p{L}][\p{L}' .-]*$/u.test(ulke)) return { ok: false, field: 'ulke' };
  const gsm = normalizeGsm(src.gsm, digerMi ? null : (shared.dialOf(ulke) || null));
  if (!gsm || (digerMi && !/^\s*(\+|00)/.test(String(src.gsm)))) return { ok: false, field: 'gsm' };
  const ilce = src.ilce ? text(src.ilce, 2, 50) : null;
  if (src.ilce && String(src.ilce).trim() && !ilce) return { ok: false, field: 'ilce' };

  /* İsteğe bağlı: 11 hane TC kimlik ya da 10 hane vergi no (sağlamalı). */
  const kimlik = shared.cleanIdentity(src.tckn);
  if (kimlik === null) return { ok: false, field: 'tckn' };

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
      identityNumber: kimlik || UNKNOWN_TCKN,
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
