'use strict';

/**
 * Plan hakları — "bu sahip kaç tarama yapabilir" sorusunun TEK cevabı.
 *
 * NEDEN VAR
 *
 * Tarama uçları (`/api/scan`, `/api/enqueue-scan`) ve kota gösterimi
 * (`/api/auth/me`) plana hiç bakmıyordu: herkese FREE_SCAN_LIMIT (5)
 * uygulanıyordu. Pro müşteri ödeme yaptığı halde 5. taramada `quota_exceeded`
 * alıyordu. Fiyat sayfasında yazan şey bir taahhüttür (bkz. plans.js); kod
 * ondan farklı bir sınır uygulayamaz.
 *
 * KURALLAR (fiyat sayfasındaki taahhütle aynı)
 *
 *   free / anonim   FREE_SCAN_LIMIT, ömür boyu (mevcut sayaç ve anahtar)
 *   pro             PRO_MONTHLY_SCAN_LIMIT, takvim ayı (TSİ) başına
 *   enterprise      sınırsız — kota sayacı yok; IP hız sınırı yine geçerli
 *
 * Ay, abonelik başlangıcından değil takvim ayından sayılıyor (Türkiye saati):
 * yenileme günü iyzico'da tutuluyor ve her taramada iyzico'ya sormak hem
 * yavaş hem kırılgan olurdu. Takvim ayı müşteri lehine yuvarlanır: ayın son
 * günü abone olan biri iki gün içinde iki ayın hakkını kullanabilir.
 *
 * HATA DURUMU
 *
 * Abonelik okunamazsa (veritabanı yok/erişilemiyor) sahip FREE kurallarına
 * düşer. Bu, ücretli müşteriyi geçici olarak kısıtlar ama kimseye bedava
 * sınırsız tarama açmaz; ters yönde hata yapmak kötüye kullanıma kapı olurdu.
 */

const db = require('./db.js');
const { FREE_SCAN_LIMIT, PRO_MONTHLY_SCAN_LIMIT, QUOTA_TTL_SECONDS } = require('./limits.js');

/** Aylık sayaç ay bitince kendiliğinden düşsün; birkaç gün pay. */
const MONTHLY_TTL_SECONDS = 40 * 24 * 60 * 60;

/** Türkiye 2016'dan beri sabit UTC+3 (yaz saati yok). */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

function monthKey(now) {
  return new Date((now || Date.now()) + TR_OFFSET_MS).toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Etkin aboneliklerden plan. Birden çok etkin abonelik olabilir (iki alan
 * adı); plan en kapsamlı olanıdır.
 */
function planFromSubscriptions(rows) {
  const active = (rows || []).filter(function (r) { return r && r.active === true; });
  if (active.some(function (r) { return r.plan === 'enterprise'; })) return 'enterprise';
  return active.length ? 'pro' : 'free';
}

/** Hesabın planı. Anonim sahip ya da okunamayan abonelik → 'free'. */
async function planFor(owner) {
  if (!owner || !owner.userId || !db.isConfigured()) return 'free';
  try {
    return planFromSubscriptions(await db.listSubscriptions(owner.userId));
  } catch (err) {
    if (console && console.warn) console.warn('entitlement: plan okunamadı, free uygulanıyor:', err.message);
    return 'free';
  }
}

/**
 * Sahibin kota politikası.
 * @returns {{ plan, unlimited, limit, key, ttl, period }}
 *   `key` store.quotaKey ile aynı biçimde; aylık planda aya özgü.
 */
function policyFor(plan, owner, baseKey, now) {
  if (plan === 'enterprise') {
    return { plan: plan, unlimited: true, limit: null, key: null, ttl: null, period: null };
  }
  if (plan === 'pro') {
    return {
      plan: plan, unlimited: false, limit: PRO_MONTHLY_SCAN_LIMIT,
      /* Ücretsiz ömür boyu sayaçtan AYRI anahtar: Pro'ya geçen müşterinin
         eski 5 hakkı aylık hakkından düşülmez. */
      key: 'cl:quota:m:' + monthKey(now) + ':u:' + owner.userId,
      ttl: MONTHLY_TTL_SECONDS, period: 'month'
    };
  }
  return { plan: 'free', unlimited: false, limit: FREE_SCAN_LIMIT, key: baseKey, ttl: QUOTA_TTL_SECONDS, period: 'lifetime' };
}

async function resolvePolicy(owner, baseKey) {
  return policyFor(await planFor(owner), owner, baseKey);
}

/**
 * İstemciye giden kota nesnesi. Eski alanlar (used, limit, remaining, scope)
 * korunuyor; sınırsız planda limit/remaining null ve `unlimited: true`.
 */
function quotaView(policy, used, scope) {
  if (policy.unlimited) {
    return { used: null, limit: null, remaining: null, scope: scope, plan: policy.plan, period: null, unlimited: true };
  }
  return {
    used: used, limit: policy.limit, remaining: Math.max(0, policy.limit - used),
    scope: scope, plan: policy.plan, period: policy.period, unlimited: false
  };
}

module.exports = { planFor, planFromSubscriptions, policyFor, resolvePolicy, quotaView, monthKey };
