'use strict';

/**
 * "Biz düzeltelim" tek seferlik hizmet fiyatlandırması — TEK KAYNAK.
 * Fiyat İSTEMCİDEN ALINMAZ: sipariş ucu burada yeniden hesaplar.
 *
 *   header   ₺499    basit güvenlik başlıkları (HSTS, X-Frame, nosniff, Referrer…)
 *   tls_dns  ₺999    TLS / sertifika / HTTPS, SPF / DMARC / DKIM / DNSSEC ve
 *                    siteye özgü değişiklik isteyenler (CSP, çerez, CORS, SRI, karışık içerik)
 *   full     ₺1.999  tam paket; OWASP (A01–A10) bulguları yalnızca bununla
 *
 * Sepet: kalemlerin toplamı, tam paket fiyatıyla sınırlı.
 * Pro ve Enterprise: %50 indirim (üst plan alt plandan pahalıya almasın).
 * Fiyatlar KDV hariç, tam TL.
 */

const { FIXES, fixFor } = require('./engines/fixes.js');

const TIERS = { header: 499, tls_dns: 999, full: 1999 };
const DISCOUNT_PERCENT = 50;
const DISCOUNT_PLANS = ['pro', 'enterprise'];
const ID_RE = /^[a-z0-9_]{2,40}$/;
const MAX_ITEMS = 40;

function tierOf(id) {
  const f = FIXES[id] ? fixFor(id, 'tr') : null;
  return f ? f.tier : 'full';
}

function discounted(price, plan) {
  return DISCOUNT_PLANS.indexOf(plan) !== -1 ? Math.round(price * (100 - DISCOUNT_PERCENT) / 100) : price;
}

/** Geçerli, tekil bulgu kimlikleri (en çok 40). */
function cleanIds(ids) {
  const out = [];
  (Array.isArray(ids) ? ids : []).forEach(function (x) {
    const id = String(x || '').toLowerCase();
    if (ID_RE.test(id) && out.indexOf(id) === -1 && out.length < MAX_ITEMS) out.push(id);
  });
  return out;
}

/**
 * @param {string[]} ids
 * @param {'single'|'full'} type
 * @param {string} plan  'free' | 'pro' | 'enterprise'
 * @returns {{ ok: boolean, code?: string, type?: string, price?: number, priceDiscounted?: number,
 *             isPro?: boolean, items?: Array<{id, tier, price}> }}
 */
function quote(ids, type, plan) {
  const list = cleanIds(ids);
  if (!list.length) return { ok: false, code: 'no_findings' };
  const items = list.map(function (id) { const t = tierOf(id); return { id: id, tier: t, price: TIERS[t] }; });
  let effective = type === 'full' || items.some(function (i) { return i.tier === 'full'; }) ? 'full' : 'single';
  let price = effective === 'full' ? TIERS.full
    : items.reduce(function (a, i) { return a + i.price; }, 0);
  if (price >= TIERS.full) { price = TIERS.full; effective = 'full'; }
  return {
    ok: true, type: effective, items: items, price: price,
    priceDiscounted: discounted(price, plan),
    isPro: DISCOUNT_PLANS.indexOf(plan) !== -1
  };
}

/** Herkese açık fiyat tablosu (GET /api/fix-pricing). */
function table() {
  const tierById = {};
  Object.keys(FIXES).forEach(function (id) { tierById[id] = tierOf(id); });
  return { currency: 'TRY', vatIncluded: false, tiers: TIERS, discountPercent: DISCOUNT_PERCENT,
    discountPlans: DISCOUNT_PLANS, tierById: tierById, otherFindings: 'full' };
}

module.exports = { TIERS, DISCOUNT_PERCENT, DISCOUNT_PLANS, tierOf, quote, table, cleanIds, discounted };
