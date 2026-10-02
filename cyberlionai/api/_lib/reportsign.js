'use strict';

/**
 * Rapor imzalama katmanı — Vercel tarafı.
 *
 * Vercel S3'ü TANIMAZ. AWS gizli anahtarı burada yok; istek Supabase Edge
 * Function'a (`sign-report`) gidiyor, süreli imzalı adresi o üretiyor.
 * `scanqueue.js` ile aynı gerekçe: anahtar tek platformda durduğu için
 * döndürülecek yer de tek.
 *
 * Alternatif Vercel'e S3 okuma kimliği koymaktı; o zaman aynı anahtar iki
 * platformda bulunurdu.
 *
 * SIR AYRI: `SIGN_SHARED_SECRET`, `ENQUEUE_SHARED_SECRET`'ten farklı olmalı.
 * Biri sızdığında öteki yetki vermemeli — kuyruğa iş bırakmak ile rapor
 * imzalatmak iki ayrı yetki.
 *
 * ORTAM DEĞİŞKENLERİ (değerleri konsolda girilir, depoda DURMAZ)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — zaten var
 *   SIGN_SHARED_SECRET                       — Edge Function'daki aynı değer
 *
 * HİÇBİR ANAHTAR VE HİÇBİR İMZALI ADRES LOGLANMAZ: adres kısa süreli de olsa
 * nesneye erişim veriyor, log'a düşmesi onu paylaşılabilir kılar.
 */

const TIMEOUT_MS = 6000;
const FUNCTION_NAME = 'sign-report';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.SIGN_SHARED_SECRET;
  return url && key && secret
    ? { url: url.replace(/\/+$/, ''), key: key, secret: secret }
    : null;
}

function isConfigured() { return config() !== null; }

/**
 * Anahtar için süreli imzalı indirme adresi ister.
 *
 * @param {string} reportKey  S3 nesne anahtarı (DB'den gelir, istemciden GELMEZ)
 * @returns {Promise<string>} imzalı adres
 * @throws {Error} 'sign_unconfigured' | 'sign_unreachable' | 'sign_rejected'
 */
async function signReportUrl(reportKey) {
  const cfg = config();
  if (!cfg) throw new Error('sign_unconfigured');

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(cfg.url + '/functions/v1/' + FUNCTION_NAME, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + cfg.key,
        'Content-Type': 'application/json',
        'x-cl-sign-secret': cfg.secret
      },
      body: JSON.stringify({ report_key: reportKey })
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('sign_unreachable');
  }
  clearTimeout(timer);

  if (!response.ok) {
    if (console && console.error) console.error('sign rejected', response.status);
    throw new Error('sign_rejected');
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error('sign_rejected');
  }

  /* Dönen adres S3 olmak ZORUNDA. İşlev yapılandırması bozulsa ya da yanıt
     beklenmedik bir şey dönse, kullanıcı rastgele bir adrese YÖNLENDİRİLMEZ:
     açık yönlendirme (open redirect) olurdu. */
  const url = data && typeof data.url === 'string' ? data.url : '';
  if (!/^https:\/\/[A-Za-z0-9.-]+\.amazonaws\.com\//.test(url)) {
    throw new Error('sign_rejected');
  }
  return url;
}

module.exports = { isConfigured, signReportUrl, FUNCTION_NAME };
