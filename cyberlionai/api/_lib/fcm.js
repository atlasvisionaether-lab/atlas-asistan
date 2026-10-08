'use strict';

/**
 * Firebase Cloud Messaging HTTP v1 istemcisi — bağımlılıksız.
 *
 * NEDEN `firebase-admin` YOK: bu depo sunucu tarafında hiç npm bağımlılığı
 * taşımıyor (bkz. `_lib/pdf.js`, `aws/lambda-scanner/lib/sigv4.js`). FCM'in
 * gerektirdiği tek şey bir OAuth2 erişim belirteci; onu da servis hesabının
 * özel anahtarıyla imzalanmış bir JWT karşılığında Google veriyor. RS256
 * imzası `node:crypto` ile atılıyor, yani ~80 MB'lık bir SDK yerine aşağıdaki
 * kırk satır.
 *
 * ANAHTAR HİÇ LOGLANMIYOR. Servis hesabı JSON'u `FIREBASE_SERVICE_ACCOUNT`
 * ortam değişkeninde duruyor; `private_key` hiçbir hata metnine, hiçbir
 * yanıta girmiyor. Erişim belirteci de öyle.
 *
 * CİHAZ JETONLARI BU KATMANDAN DIŞARI ÇIKMIYOR: `send()` jetonu alıyor,
 * sonucu `{ ok, invalid }` olarak dönüyor. Jetonun kendisi dönüş değerinde
 * YOK — bir uç yanlışlıkla sonucu istemciye yazsa bile jeton sızmaz.
 *
 * Gerekli ortam değişkenleri:
 *   FIREBASE_SERVICE_ACCOUNT   (JSON: project_id, client_email, private_key)
 * Yoksa katman KAPALI ve hiç ağ isteği yok.
 */

const crypto = require('node:crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TIMEOUT_MS = 10000;
const JWT_LIFETIME = 3600;
/* Belirteç süresi dolmadan biraz önce yenileniyor: sunucusuz örnek sıcakken
   aynı belirteci birkaç çağrıda kullanıyor, soğukta yenisini alıyor. */
const REFRESH_MARGIN_MS = 300000;

/* Bir jeton en az bu kadar uzun olmalı. Gerçek FCM jetonları 140+ karakter;
   kısa bir değer ya bir hata ya da elle girilmiş çöp, FCM'e gitmesin. */
const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 4096;

/* FCM bu kodlarda jetonun ARTIK GEÇERSİZ olduğunu söylüyor: cihaz uygulamayı
   silmiş ya da jeton dönmüş. Böyle bir jeton tablodan düşürülüyor, yoksa her
   bildirimde aynı 404'ü almaya devam ederiz. */
const INVALID_CODES = ['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND'];

let onbellek = null; // { token, expiresAt, hesapAnahtari }

function hesap() {
  const ham = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!ham || typeof ham !== 'string') return null;
  let j;
  try { j = JSON.parse(ham); } catch (e) { return null; }
  if (!j || !j.project_id || !j.client_email || !j.private_key) return null;
  /* Ortam değişkenlerinde satır sonları çoğu zaman `\n` olarak kaçışlanmış
     gelir; PEM'in gerçek satır sonlarına ihtiyacı var. */
  const key = String(j.private_key).replace(/\\n/g, '\n');
  if (key.indexOf('BEGIN') === -1) return null;
  return { projectId: String(j.project_id), clientEmail: String(j.client_email), privateKey: key };
}

function isConfigured() { return hesap() !== null; }

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Servis hesabı JWT'si (RS256). Anahtar bu işlevden dışarı çıkmıyor. */
function jwtUret(h) {
  const simdi = Math.floor(Date.now() / 1000);
  const basl = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const govde = b64url(JSON.stringify({
    iss: h.clientEmail, scope: SCOPE, aud: TOKEN_URL,
    iat: simdi, exp: simdi + JWT_LIFETIME
  }));
  const imza = crypto.createSign('RSA-SHA256').update(basl + '.' + govde).end()
    .sign(h.privateKey);
  return basl + '.' + govde + '.' + b64url(imza);
}

async function erisimBelirteci(h) {
  const anahtarKimligi = h.clientEmail + '|' + h.projectId;
  if (onbellek && onbellek.hesapAnahtari === anahtarKimligi
      && onbellek.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return onbellek.token;
  }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  let yanit;
  try {
    yanit = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
        + '&assertion=' + encodeURIComponent(jwtUret(h))
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('fcm_auth_unreachable');
  }
  clearTimeout(timer);

  if (!yanit.ok) {
    /* Gövde LOGLANMIYOR: hatalı istekte Google bazen assertion'ı yankılıyor,
       o da imzalanmış JWT demek. Yalnızca durum kodu. */
    if (console && console.error) console.error('fcm auth failed, status', yanit.status);
    throw new Error('fcm_unauthorized');
  }

  const j = await yanit.json().catch(function () { return null; });
  if (!j || !j.access_token) throw new Error('fcm_bad_auth_response');

  onbellek = {
    token: String(j.access_token),
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    hesapAnahtari: anahtarKimligi
  };
  return onbellek.token;
}

function jetonGecerliMi(jeton) {
  const s = typeof jeton === 'string' ? jeton.trim() : '';
  return s.length >= MIN_TOKEN_LENGTH && s.length <= MAX_TOKEN_LENGTH ? s : null;
}

/**
 * Tek bir cihaza bildirim.
 *
 * @param {string} jeton FCM kayıt jetonu
 * @param {{title: string, body: string, data: object}} mesaj
 * @returns {Promise<{ok: boolean, invalid: boolean, code: string|null}>}
 *   Jetonun kendisi DÖNMÜYOR. `invalid` true ise jeton artık ölü.
 *   Bu işlev FIRLATMIYOR: bir cihazın düşmesi bildirimi tamamen durdurmamalı.
 */
async function send(jeton, mesaj) {
  const h = hesap();
  if (!h) return { ok: false, invalid: false, code: 'unconfigured' };

  const temizJeton = jetonGecerliMi(jeton);
  if (!temizJeton) return { ok: false, invalid: true, code: 'bad_token' };

  let erisim;
  try {
    erisim = await erisimBelirteci(h);
  } catch (err) {
    return { ok: false, invalid: false, code: err.message };
  }

  /* FCM `data` yalnızca dizge değer kabul ediyor; sayı gönderilirse istek
     400 ile düşer. */
  const data = {};
  const kaynak = (mesaj && mesaj.data) || {};
  Object.keys(kaynak).slice(0, 10).forEach(function (k) {
    const v = kaynak[k];
    if (v === null || v === undefined) return;
    data[String(k).slice(0, 40)] = String(v).slice(0, 300);
  });

  const url = 'https://fcm.googleapis.com/v1/projects/'
    + encodeURIComponent(h.projectId) + '/messages:send';

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  let yanit;
  try {
    yanit = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + erisim,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          token: temizJeton,
          notification: {
            title: String((mesaj && mesaj.title) || '').slice(0, 120),
            body: String((mesaj && mesaj.body) || '').slice(0, 240)
          },
          data: data,
          android: { priority: 'high' }
        }
      })
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, invalid: false, code: 'fcm_unreachable' };
  }
  clearTimeout(timer);

  if (yanit.ok) return { ok: true, invalid: false, code: null };

  const metin = await yanit.text().catch(function () { return ''; });
  let kod = 'fcm_error_' + yanit.status;
  try {
    const j = JSON.parse(metin);
    const s = j && j.error && j.error.status;
    if (typeof s === 'string') kod = s;
  } catch (e) { /* gövde JSON değilse durum kodu yeter */ }

  /* Hata metni LOGLANMIYOR: FCM hatalı istekte jetonu yankılayabiliyor. */
  if (console && console.error) console.error('fcm send failed:', kod);

  return {
    ok: false,
    invalid: INVALID_CODES.indexOf(kod) !== -1 || yanit.status === 404,
    code: kod
  };
}

/** Sınamalar için önbelleği sıfırlar. Üretimde çağrılmıyor. */
function _onbellegiSifirla() { onbellek = null; }

module.exports = {
  send, isConfigured, jetonGecerliMi, _onbellegiSifirla,
  MIN_TOKEN_LENGTH, MAX_TOKEN_LENGTH, INVALID_CODES
};
