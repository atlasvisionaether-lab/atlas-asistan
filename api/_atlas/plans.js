'use strict';

/**
 * atlasasistan.com paketleri — ödeme ucunun TEK fiyat kaynağı.
 *
 * Tutar istemciden ALINMAZ: checkout.html'deki fiyatlar yalnızca gösterim.
 * Fiyatlar KDV dahil TL (bkz. checkout.html plans tablosu).
 *
 *   subscription → iyzico aylık abonelik (fiyat planı referansı env'den;
 *                  sandbox ile canlıda farklı, kodda sabit değil)
 *   setup        → tek seferlik kurulum ödemesi. Aylık ücret (monthlyTry)
 *                  sitede ÇEKİLMEZ: teslimden sonra ayrı abonelik linkiyle
 *                  başlar (monthlyRefEnv).
 */

const PLANS = {
  standart: { name: 'Standart Asistan', kind: 'subscription', amountTry: 4900, refEnv: 'IYZICO_ATLAS_PLAN_STANDART' },
  pro: { name: 'Pro Asistan', kind: 'subscription', amountTry: 7900, refEnv: 'IYZICO_ATLAS_PLAN_PRO' },
  starter: {
    name: 'Dijital Başlangıç Paketi', kind: 'setup', amountTry: 14900,
    monthlyTry: 1200, monthlyRefEnv: 'IYZICO_ATLAS_PLAN_STARTER_MONTHLY'
  },
  vip: {
    name: 'VIP Klinik Dönüşümü', kind: 'setup', amountTry: 24900,
    monthlyTry: 2400, monthlyRefEnv: 'IYZICO_ATLAS_PLAN_VIP_MONTHLY'
  }
};

/* Sayfadaki eski bağlantı adı. */
const ALIASES = { standard: 'standart' };

function planOf(key) {
  const k = String(key || '').trim().toLowerCase();
  const id = ALIASES[k] || k;
  return Object.prototype.hasOwnProperty.call(PLANS, id) ? Object.assign({ id: id }, PLANS[id]) : null;
}

function envValue(name) {
  const v = name ? process.env[name] : '';
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Abonelik paketinin iyzico fiyat planı referansı; tanımsızsa null. */
function refOf(plan) {
  return plan && plan.kind === 'subscription' ? envValue(plan.refEnv) : null;
}

/** iyzico'nun döndürdüğü referanstan paket (dönüşte hangi plana abone olunduğu). */
function planOfRef(ref) {
  const r = String(ref || '').trim();
  if (!r) return null;
  const ids = Object.keys(PLANS);
  for (let i = 0; i < ids.length; i += 1) {
    const p = planOf(ids[i]);
    if (refOf(p) === r) return p;
  }
  return null;
}

/** Ödeme ucu kapalıysa sayfa eski WhatsApp siparişine düşer. Açıkça 'true' olmalı. */
function checkoutEnabled() {
  return String(process.env.ATLAS_CHECKOUT_ENABLED || '').trim().toLowerCase() === 'true';
}

module.exports = { PLANS, planOf, refOf, planOfRef, checkoutEnabled };
