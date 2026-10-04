'use strict';

/**
 * GET /api/fix-pricing → "Biz düzeltelim" sabit fiyat tablosu + oturum varsa
 * kullanıcının indirim durumu. Fiyat kaynağı: _lib/fixpricing.js.
 */

const auth = require('./_lib/auth.js');
const entitlement = require('./_lib/entitlement.js');
const pricing = require('./_lib/fixpricing.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  res.setHeader('Cache-Control', 'no-store');
  let plan = 'free';
  if (auth.isConfigured()) {
    try {
      const user = await auth.resolveUser(req, res);
      if (user) plan = await entitlement.planFor({ userId: user.id });
    } catch (err) { plan = 'free'; }
  }
  return res.status(200).json(Object.assign(pricing.table(), {
    plan: plan, isPro: pricing.DISCOUNT_PLANS.indexOf(plan) !== -1
  }));
};
