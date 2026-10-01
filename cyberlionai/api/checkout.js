'use strict';

/**
 * Ödeme başlatma — Stripe Checkout'a yönlendirir.
 *
 *   GET /api/checkout?plan=pro
 *   GET /api/checkout?plan=enterprise
 *
 * NEDEN BİR UÇ, NEDEN HTML'DE DÜZ BAĞLANTI DEĞİL
 *
 * Ödeme bağlantısı sayfanın HTML'ine gömülseydi, bağlantıyı değiştirmek için
 * HTML değişip CSP hash'lerinin yeniden hesaplanması gerekirdi; test modundan
 * canlı moda geçmek de bir dağıtım gerektirirdi. Bağlantı burada ortam
 * değişkeninden okunuyor: mod değişimi bir env değişikliği, kod değişikliği
 * değil.
 *
 * YAPILANDIRILMAMIŞSA UYDURMUYOR
 *
 * Bağlantı tanımlı değilse uç 503 `checkout_unconfigured` dönüyor ve arayüz
 * "ödeme henüz açılmadı" diyor. Çalışmayan ya da tahmin edilmiş bir Stripe
 * adresine yönlendirmek, müşteriyi ödeme sayfası sandığı bir 404'e göndermek
 * olurdu.
 *
 * AÇIK YÖNLENDİRME KORUMASI
 *
 * Hedef yalnızca Stripe'ın kendi alan adlarından biri olabilir. Env değeri
 * yanlış yapılandırılırsa (ya da birisi onu değiştirirse) uç bunu bir
 * yönlendirme fırsatına çevirmiyor: `checkout_misconfigured` ile 503 dönüyor.
 * Bir güvenlik ürününün kendi sitesinde açık yönlendirme taşıması olmaz.
 *
 * NE LOGLANMIYOR
 *
 * Ödeme bağlantısı gizli değil ama yine de loglanmıyor; hata kayıtlarına
 * yalnızca sebep kodu ve plan adı giriyor. Stripe gizli anahtarı bu uçta hiç
 * kullanılmıyor: ödeme bağlantısı (Payment Link) sunucuda imza gerektirmiyor.
 *
 * BİLİNEN EKSİK
 *
 * Ödeme bağlantısı aboneliği `cl_subscriptions` tablosuna YAZMIYOR. Ödeme
 * sonrası satırı açan şey bir Stripe webhook'u olmalı (servis rolüyle; o
 * tabloda anon/authenticated INSERT policy'si bilerek yok). O webhook
 * yazılana kadar abonelik satırı elle açılıyor ve haftalık tarama ancak
 * satır açıldıktan sonra o alan adını tarıyor.
 */

const { isPaidPlan, plan: planOf } = require('./_lib/plans.js');

/* Stripe'ın ödeme sayfalarını barındırdığı alan adları. Başka bir host
   yönlendirme hedefi olamaz. */
const ALLOWED_HOSTS = ['buy.stripe.com', 'checkout.stripe.com'];

/* Ortam değişkeni adları plan başına sabit: tahmin edilen bir ad yerine
   açıkça yazılmış iki ad. */
const LINK_ENV = {
  pro: 'STRIPE_PAYMENT_LINK_PRO',
  enterprise: 'STRIPE_PAYMENT_LINK_ENTERPRISE'
};

/**
 * Plan için yapılandırılmış ödeme bağlantısını döndürür.
 * @returns {{ok: true, url: string} | {ok: false, reason: string}}
 */
function checkoutUrl(planId) {
  const name = LINK_ENV[planId];
  if (!name) return { ok: false, reason: 'unknown_plan' };

  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return { ok: false, reason: 'checkout_unconfigured' };

  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch (err) {
    return { ok: false, reason: 'checkout_misconfigured' };
  }

  if (parsed.protocol !== 'https:') return { ok: false, reason: 'checkout_misconfigured' };
  if (ALLOWED_HOSTS.indexOf(parsed.hostname) === -1) {
    return { ok: false, reason: 'checkout_misconfigured' };
  }

  return { ok: true, url: parsed.toString() };
}

/** Bağlantının test modunda mı olduğunu söyler (Stripe test bağlantıları `/test/` taşır). */
function isTestLink(url) {
  return /\/test\//.test(url);
}

/** İsteği bir tarayıcı gezinmesi mi yapıyor: cevabın HTML mi JSON mu olacağını belirler. */
function wantsHtml(req) {
  const accept = (req.headers && req.headers.accept) || '';
  return String(accept).indexOf('text/html') !== -1;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const planId = String((req.query && req.query.plan) || '').toLowerCase();

  if (!planId) {
    return res.status(400).json({ error: { code: 'missing_plan' } });
  }
  if (!planOf(planId) || !isPaidPlan(planId)) {
    /* Free planın ödemesi yok; bilinmeyen plan da buraya düşer. İkisi için de
       aynı cevap: istenen plan ödenebilir değil. */
    return res.status(400).json({ error: { code: 'invalid_plan' } });
  }

  const link = checkoutUrl(planId);
  if (!link.ok) {
    console.warn('checkout: ' + link.reason + ' (plan=' + planId + ')');
    /* Tarayıcıdan gelen bir tıklamaya ham JSON göstermek, müşteriyi ödeme
       sayfası beklediği yerde bir hata gövdesiyle bırakmak olurdu. Fiyat
       sayfasına geri gönderiliyor; sayfa orada ne olduğunu yazıyor. */
    if (wantsHtml(req)) {
      res.setHeader('Location', '/pricing?checkout=unavailable&plan=' + encodeURIComponent(planId));
      return res.status(303).end();
    }
    return res.status(503).json({ error: { code: link.reason } });
  }

  /* 303: tarayıcı GET ile izlesin ve geri tuşunda ödeme sayfasına geri
     dönmek yerine fiyat sayfasına dönsün. */
  res.setHeader('Location', link.url);
  return res.status(303).end();
};

module.exports.checkoutUrl = checkoutUrl;
module.exports.isTestLink = isTestLink;
module.exports.wantsHtml = wantsHtml;
module.exports.ALLOWED_HOSTS = ALLOWED_HOSTS;
module.exports.LINK_ENV = LINK_ENV;
