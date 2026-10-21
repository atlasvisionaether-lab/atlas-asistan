'use strict';

/**
 * Asistanın "satış kapanışı": ücretsiz çözümden SONRA tek bir Pro teklifi.
 *
 *   decideOffer({ message, finishReason, userId, who, lang }) → offer | null
 *
 * METİN MODELDEN DEĞİL, BURADAN
 *
 * Fiyat ve kapsam bir taahhüttür (bkz. plans.js). Model fiyat söylemez
 * (sistem talimatı); teklif metni sunucuda sabit ve plans.js'ten kuruluyor.
 * Böylece yedek modele geçişte ya da istem saldırısında teklif değişmez.
 * Kapsam cümlesi fiyat sayfasındaki Pro maddeleriyle AYNI şeyi söyler;
 * "tam otomatik düzeltme" ya da "7/24 koruma" YAZILMAZ çünkü yok
 * (plans.js'teki "KASITLI OLARAK YAZILMAYANLAR").
 *
 * NE ZAMAN
 *   - Satış modu açık (AI_SALES_MODE !== 'off')
 *   - Soru bir düzeltme/kapama niyeti taşıyor ("nasıl kapatırım", "how do I fix")
 *   - Yanıt tamamlandı (finishReason 'stop'): önce ücretsiz çözüm verildi
 *   - Kullanıcı ücretli değil. Plan OKUNAMAZSA teklif YOK: ödeme yapan bir
 *     müşteriye satış yapmaktansa bir teklifi kaçırmak daha iyi.
 *   - 24 saatte bir (kullanıcı ya da IP özeti başına). Depo yoksa ya da
 *     düşerse teklif yok: sınırı uygulayamıyorsak göstermiyoruz.
 */

const { PLANS } = require('./plans.js');
const { normalize } = require('./kb.js');
const store = require('./store.js');
const db = require('./db.js');
const { planFromSubscriptions } = require('./entitlement.js');

const COOLDOWN_SECONDS = 86400;
const CHECKOUT_URL = '/odeme?plan=pro';

/* normalize() çıktısı üzerinde (ASCII, küçük harf). */
const INTENT = [
  /\bnasil\s+(\S+\s+){0,3}(kapat|duzelt|coz|gider|onle|engelle|yamala|guncelle|guvenli)/,
  /\b(kapatmak|duzeltmek|cozmek|gidermek)\s+icin\b/,
  /\b(acig|aciklari|sorunu|hatayi|zafiyeti)\S*\s+(\S+\s+){0,2}(kapat|duzelt|coz|gider)/,
  /\bhow\s+(do\s+i|can\s+i|to|should\s+i)\s+(\S+\s+){0,3}(fix|close|patch|resolve|secure|remediate|mitigate)/,
  /\b(fix|patch|remediate)\s+(this|it|the|my)\b/
];

function hasRemediationIntent(message) {
  const n = normalize(message);
  return INTENT.some(function (re) { return re.test(n); });
}

function enabled() {
  return String(process.env.AI_SALES_MODE || 'on').toLowerCase() !== 'off';
}

function buildOffer(lang) {
  const p = PLANS.pro;
  if (lang === 'en') {
    return {
      plan: 'pro', url: CHECKOUT_URL, cta: 'Go Pro', price: p.en.price, gross: p.en.gross,
      text: 'You can fix this yourself with the steps above. To catch issues like this before they hurt you, '
        + 'the Pro plan (' + p.en.price + ' + VAT, ' + p.en.gross + ' incl. VAT, cancel anytime) monitors your site daily '
        + '(score drop, SSL / domain expiry and blacklist alerts in your dashboard), gives you the OWASP PDF report '
        + 'with fix code, and 50% off our one-time "we fix it" service. Would you like to switch?'
    };
  }
  return {
    plan: 'pro', url: CHECKOUT_URL, cta: 'Pro\'ya Geç', price: p.tr.price, gross: p.tr.gross,
    text: 'Bu sorunu yukarıdaki adımlarla kendiniz çözebilirsiniz. Benzer sorunları siz fark etmeden yakalamak için '
      + 'Pro plan (' + p.tr.price + ' + KDV, KDV dahil ' + p.tr.gross + ', istediğiniz zaman iptal) sitenizi her gün izler '
      + '(skor düşüşü, SSL / alan adı bitişi ve kara liste uyarıları panelinizde), düzeltme kodlu OWASP PDF raporu verir '
      + 've tek seferlik "Biz düzeltelim" hizmetinde %50 indirim sağlar. Pro\'ya geçmek ister misiniz?'
  };
}

/** Ücretli mi? true / false / null (okunamadı). */
async function isPaid(userId) {
  if (!userId) return false;
  if (!db.isConfigured()) return null;
  try {
    return planFromSubscriptions(await db.listSubscriptions(userId)) !== 'free';
  } catch (err) {
    return null;
  }
}

async function decideOffer(input) {
  if (!enabled() || !input || input.finishReason !== 'stop') return null;
  if (!hasRemediationIntent(input.message)) return null;
  const paid = await isPaid(input.userId);
  if (paid !== false) return null;
  if (!store.isConfigured()) return null;
  try {
    const key = 'cl:offer:' + (input.userId ? 'u:' + input.userId : 'ip:' + input.who);
    if (!(await store.setOnce(key, COOLDOWN_SECONDS))) return null;
  } catch (err) {
    return null;
  }
  return buildOffer(input.lang);
}

module.exports = { decideOffer, hasRemediationIntent, buildOffer, CHECKOUT_URL, COOLDOWN_SECONDS };
