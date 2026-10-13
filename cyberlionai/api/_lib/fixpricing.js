'use strict';

/**
 * "Biz düzeltelim" tek seferlik hizmet fiyatlandırması — TEK KAYNAK.
 * Fiyat İSTEMCİDEN ALINMAZ: sipariş ucu burada yeniden hesaplar.
 *
 *   header   ₺499    basit güvenlik başlıkları (HSTS, X-Frame, nosniff, Referrer…)
 *   tls_dns  ₺999    TLS / sertifika / HTTPS, SPF / DMARC / DKIM / DNSSEC ve
 *                    siteye özgü değişiklik isteyenler (CSP, çerez, CORS, SRI, karışık içerik)
 *   full     ₺5.000  tam paket (sepet tavanı); OWASP (A01–A10) bulguları yalnızca bununla
 *
 * Sepet: kalemlerin toplamı, tam paket fiyatıyla SINIRLI. Tavan bilinçli:
 * "tam paket ₺5.000" fiyat sayfasında, Ön Bilgilendirme Formu'nda ve Mesafeli
 * Satış Sözleşmesi'nde yazılı; bir ALT KÜME reklam edilen bütünden pahalıya
 * gelemez.
 *
 * TAVANA ULAŞAN SEPETİN KAPSAMI DA TAM PAKETTİR. Eskiden tavan yalnızca
 * FİYATA uygulanıyordu: sipariş `type: 'full'`, `price: 5000` olarak
 * kaydediliyor ama `finding_ids` yalnızca seçilenleri taşıyordu (bkz.
 * api/fix-order.js). Müşteri tam paket parası öder, iş emri alt küme yazardı
 * — "8 bulgu ile 9 bulgu aynı fiyat" şikâyetinin altındaki tutarsızlık buydu.
 * Artık tavan devreye girdiğinde kapsam katalogun TAMAMINA genişliyor; 8
 * bulgu seçen müşteri 9'uncuyu da satın almış oluyor.
 *
 * Pro ve Enterprise: %50 indirim (üst plan alt plandan pahalıya almasın).
 * Fiyatlar KDV hariç, tam TL.
 */

const { FIXES, fixFor } = require('./engines/fixes.js');

const TIERS = { header: 499, tls_dns: 999, full: 5000 };
const DISCOUNT_PERCENT = 50;
const DISCOUNT_PLANS = ['pro', 'enterprise'];
/* Tam paketin kapsamı: katalogdaki her düzeltme. Elle liste tutulmuyor,
   katalogdan okunuyor — yeni bir düzeltme eklenince paket de büyüyor. */
const ALL_IDS = Object.keys(FIXES).sort();

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

function kalem(id) { const t = tierOf(id); return { id: id, tier: t, price: TIERS[t] }; }

/**
 * @param {string[]} ids   müşterinin seçtiği bulgu kimlikleri
 * @param {'single'|'full'} type
 * @param {string} plan  'free' | 'pro' | 'enterprise'
 * @returns {{ ok: boolean, code?: string, type?: string, coversAll?: boolean,
 *             price?: number, priceDiscounted?: number, isPro?: boolean,
 *             items?: Array<{id, tier, price}> }}
 *
 * `items` SİPARİŞİN KAPSAMIDIR, seçilenlerin kopyası değil: tam pakette
 * katalogun tamamını taşır (api/fix-order.js `finding_ids`'i buradan yazıyor).
 * `coversAll` arayüzün "tamamı düzeltilecek" diyebilmesi için.
 */
function quote(ids, type, plan) {
  const list = cleanIds(ids);
  if (!list.length) return { ok: false, code: 'no_findings' };

  const secili = list.map(kalem);
  const toplam = secili.reduce(function (a, i) { return a + i.price; }, 0);

  /* Tam pakete üç yoldan girilir: müşteri açıkça ister, katalogda olmayan bir
     bulgu (OWASP) seçilir, ya da sepet toplamı tavana ulaşır. */
  const tamPaket = type === 'full'
    || secili.some(function (i) { return i.tier === 'full'; })
    || toplam >= TIERS.full;

  if (!tamPaket) {
    return {
      ok: true, type: 'single', coversAll: false, items: secili, price: toplam,
      priceDiscounted: discounted(toplam, plan),
      isPro: DISCOUNT_PLANS.indexOf(plan) !== -1
    };
  }

  /* Kapsam: katalogun tamamı + seçilenler arasında katalogda olmayanlar
     (OWASP bulguları). Müşterinin TIKLADIĞI bulgu iş emrinden düşmesin. */
  const kapsam = ALL_IDS.concat(list.filter(function (id) { return ALL_IDS.indexOf(id) === -1; }));
  return {
    ok: true, type: 'full', coversAll: true, items: kapsam.map(kalem),
    price: TIERS.full, priceDiscounted: discounted(TIERS.full, plan),
    isPro: DISCOUNT_PLANS.indexOf(plan) !== -1
  };
}

/** Herkese açık fiyat tablosu (GET /api/fix-pricing). */
function table() {
  const tierById = {};
  Object.keys(FIXES).forEach(function (id) { tierById[id] = tierOf(id); });
  return { currency: 'TRY', vatIncluded: false, tiers: TIERS, discountPercent: DISCOUNT_PERCENT,
    discountPlans: DISCOUNT_PLANS, tierById: tierById, otherFindings: 'full',
    /* Tavana ulaşan sepetin kapsamı: katalogdaki düzeltme sayısı. Arayüz
       "23 bulgunun tamamı düzeltilecek" derken bunu okuyor, sabit yazmıyor. */
    fullCoverageCount: ALL_IDS.length };
}

module.exports = { TIERS, DISCOUNT_PERCENT, DISCOUNT_PLANS, ALL_IDS, tierOf, quote, table, cleanIds, discounted };
