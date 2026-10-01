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

/* Fiyatlar KDV hariç, Türk lirası, aylık. Kuruş yok: tutarlar tam sayı. */
const PLANS = {
  free: {
    id: 'free',
    priceTry: 0,
    tr: { price: '₺0', period: 'Süresiz ücretsiz' },
    en: { price: '₺0', period: 'Free forever' }
  },
  pro: {
    id: 'pro',
    priceTry: 299,
    tr: { price: '₺299/ay', period: 'Aylık, istediğiniz zaman iptal' },
    en: { price: '₺299/mo', period: 'Monthly, cancel anytime' }
  },
  enterprise: {
    id: 'enterprise',
    priceTry: 2499,
    tr: { price: '₺2.499/ay', period: 'Aylık, istediğiniz zaman iptal' },
    en: { price: '₺2,499/mo', period: 'Monthly, cancel anytime' }
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

module.exports = { PLANS, PAID_PLAN_IDS, isPaidPlan, plan };
