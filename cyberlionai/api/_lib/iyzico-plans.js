'use strict';

/**
 * Ödeme seçeneği ↔ iyzico fiyat planı referansı.
 *
 * Her seçeneğin (plan × dönem) iyzico'da ayrı bir fiyat planı var; referans
 * kodu kodda SABİT DEĞİL, env'den okunuyor (sandbox ile canlıda farklı).
 * Ödeme ucu seçenekten referansa, dönüş ucu ve panel referanstan seçeneğe
 * gidiyor: hangi plana abone olunduğunu müşterinin isteği değil iyzico'nun
 * cevabındaki referans söylüyor.
 */

const { CHECKOUT_KEYS, checkoutOption } = require('./plans.js');

/* Aylık adlar değişmedi: canlıda zaten tanımlı olabilirler. */
const PLAN_REF_ENV = {
  pro_monthly: 'IYZICO_PRICING_PLAN_PRO',
  pro_yearly: 'IYZICO_PRICING_PLAN_PRO_YEARLY',
  enterprise_monthly: 'IYZICO_PRICING_PLAN_ENTERPRISE',
  enterprise_yearly: 'IYZICO_PRICING_PLAN_ENTERPRISE_YEARLY'
};

/** Seçeneğin (ya da eski `pro`/`enterprise` adının) referansı; tanımsızsa null. */
function refOf(keyOrPlan) {
  const opt = checkoutOption(keyOrPlan);
  if (!opt) return null;
  const value = process.env[PLAN_REF_ENV[opt.key]];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Referansı tanımlı seçenekler (ödeme açık olanlar). */
function readyKeys() {
  return CHECKOUT_KEYS.filter(function (k) { return refOf(k) !== null; });
}

/** iyzico'nun döndürdüğü referanstan seçenek; eşleşmezse null. */
function optionOfRef(ref) {
  const r = String(ref || '').trim();
  if (!r) return null;
  for (let i = 0; i < CHECKOUT_KEYS.length; i += 1) {
    if (refOf(CHECKOUT_KEYS[i]) === r) return checkoutOption(CHECKOUT_KEYS[i]);
  }
  return null;
}

module.exports = { PLAN_REF_ENV, refOf, readyKeys, optionOfRef };
