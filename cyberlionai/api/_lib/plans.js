'use strict';

/**
 * Plan tanımları — fiyat ve kapsam için TEK kaynak.
 *
 * NEDEN BURADA
 *
 * Fiyat üç yerde görünüyor: ana sayfanın plan tablosu, /pricing sayfası ve
 * SSS cevabı. Üçü elle yazıldığında biri güncellenip diğeri kaldı: ana sayfa
 * Pro için "SINIRSIZ Tarama" diyordu, oysa sınırsız olan Enterprise'dı.
 * Fiyat sayfasında yazan şey bir TAAHHÜTTÜR; iki sayfanın iki farklı şey
 * söylemesi müşteriye yanlış söz vermek olur.
 *
 * Bu dosya o taahhüdü tek yerde tutuyor ve `tools/pricing-test.js` HTML'deki
 * metinlerin buradakiyle aynı olduğunu sınıyor. Fiyat değişince burayı
 * değiştirip sınamayı koşmak yeterli: tutarsızlık CI'da düşer.
 *
 * KASITLI OLARAK YAZILMAYANLAR
 *
 * - "Tam Otomatik Düzeltme" DEĞİL. Düzeltme müşterinin kendi Cloudflare
 *   token'ıyla ve tek bir kuralla oluyor; doğru adı "Cloudflare ile 1-Tık
 *   Düzeltme (kendi token'ınızla)".
 * - Pro için "sınırsız" DEĞİL. Aylık tarama hakkı sayılı; sınırsız olan
 *   Enterprise.
 */

/* KDV oranı. Abonelik fiyatları KDV DAHİL; KDV hariç tutar bundan türetilir
   (`netOf`), yalnızca ödeme özeti ve sözleşmedeki KDV dökümü için. */
const VAT_RATE = 0.20;

/* Fiyatlar KDV DAHİL, Türk lirası, aylık: iyzico fiyat planına yazılan ve
   karttan çekilen tutarın kendisi (2026-10-22 kararı; önceki model "₺299 +
   KDV" iken iyzico'ya KDV hariç tutar gidiyor, çekilen tutar sayfadakinden
   farklı oluyordu). `gross` sayfada fiyatın altındaki "KDV dahil" ibaresi. */
const PLANS = {
  free: {
    id: 'free',
    priceTry: 0,
    tr: { price: '₺0', period: 'Süresiz ücretsiz' },
    en: { price: '₺0', period: 'Free forever' }
  },
  pro: {
    id: 'pro',
    priceTry: 249,
    tr: { price: '₺249/ay', gross: 'KDV dahil', period: 'Aylık, istediğiniz zaman iptal' },
    en: { price: '₺249/mo', gross: 'incl. VAT', period: 'Monthly, cancel anytime' },
    /* Yıllık: 10 aylık bedel (2 ay bedava); iyzico'daki yıllık planla aynı, KDV dahil. */
    yearly: {
      priceTry: 2490,
      tr: { price: '₺2.490/yıl', gross: 'KDV dahil', period: 'Yıllık, 2 ay bedava' },
      en: { price: '₺2,490/yr', gross: 'incl. VAT', period: 'Yearly, 2 months free' }
    }
  },
  enterprise: {
    id: 'enterprise',
    priceTry: 1990,
    tr: { price: '₺1.990/ay', gross: 'KDV dahil', period: 'Aylık, istediğiniz zaman iptal' },
    en: { price: '₺1,990/mo', gross: 'incl. VAT', period: 'Monthly, cancel anytime' },
    yearly: {
      priceTry: 19900,
      tr: { price: '₺19.900/yıl', gross: 'KDV dahil', period: 'Yıllık, 2 ay bedava' },
      en: { price: '₺19,900/yr', gross: 'incl. VAT', period: 'Yearly, 2 months free' }
    }
  }
};

/** Ödeme başlatılabilen planlar. Free için ödeme yok. */
const PAID_PLAN_IDS = ['pro', 'enterprise'];

function isPaidPlan(id) {
  return PAID_PLAN_IDS.indexOf(id) !== -1;
}

function plan(id) {
  return Object.prototype.hasOwnProperty.call(PLANS, id) ? PLANS[id] : null;
}

/* Ödeme seçenekleri: plan × dönem. Plan kimliği (pro/enterprise) yetkiyi
   belirler ve veritabanına o yazılır; dönem yalnızca ödenen tutarı ve
   yenileme aralığını değiştirir. */
const PERIODS = ['monthly', 'yearly'];
const CHECKOUT_KEYS = ['pro_monthly', 'pro_yearly', 'enterprise_monthly', 'enterprise_yearly'];

/**
 * Ödeme seçeneğini çözer. Eski bağlantılar (`plan=pro`, satış teklifi) aylık
 * sayılır. Bilinmeyen, ücretsiz ya da biçimsiz değer → null.
 *   'pro_yearly' → { key: 'pro_yearly', id: 'pro', period: 'yearly', priceTry: 2490 }
 */
function checkoutOption(raw) {
  const s = String(raw || '').trim().toLowerCase();
  const m = /^(pro|enterprise)(?:_(monthly|yearly))?$/.exec(s);
  if (!m) return null;
  const id = m[1];
  const period = m[2] || 'monthly';
  const def = PLANS[id];
  const priceTry = period === 'yearly' ? def.yearly.priceTry : def.priceTry;
  return { key: id + '_' + period, id: id, period: period, priceTry: priceTry };
}

module.exports = { VAT_RATE, PLANS, PAID_PLAN_IDS, PERIODS, CHECKOUT_KEYS, isPaidPlan, plan, checkoutOption };
