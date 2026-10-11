'use strict';

/**
 * Cloudflare yardımcıları — token güvenliği.
 *
 * İLKELER (ihlal kabul edilmez):
 *   - Token ASLA loglanmaz (console.* içine token/hassas türevi yazılmaz).
 *   - Token ASLA veritabanına yazılmaz.
 *   - Token ASLA yanıt gövdesine açık (plaintext) girmez; yalnız maskeli
 *     gösterim yapılır (****son4).
 *   - Token yalnızca bu isteğin belleğinde yaşar, istek bitince çöpe gider.
 *
 * Not: Bu modülde template-literal içinde `${token}` türevi hiçbir yerde
 * kullanılmaz; hata mesajları yalnız Cloudflare'in kod/status alanlarını
 * içerir.
 */

const guard = require('./guard.js');

const CF_API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 8000;

/** Token'ı güvenli biçimde maskeler. Uzunluk bilgisini de sızdırmamak için sabit maske. */
function maskToken() {
  return '****';
}

/** Cloudflare API isteği. Hata durumunda token'a dokunmayan kısa mesaj döner. */
async function cf(path, method, token, body) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  let response;
  try {
    response = await fetch(CF_API + path, {
      method: method,
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, code: 'cf_unreachable' };
  }
  clearTimeout(timer);

  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }

  if (!response.ok || (data && data.success === false)) {
    const code = (data && data.errors && data.errors[0] && data.errors[0].code) || response.status;
    return { ok: false, code: 'cf_error_' + code, status: response.status };
  }
  return { ok: true, data: data };
}

/** Domain'e göre zone kimliğini bulur. */
async function findZoneId(domain, token) {
  const r = await cf('/zones?name=' + encodeURIComponent(domain), 'GET', token);
  if (!r.ok) return { ok: false, code: r.code, status: r.status };
  const zones = (r.data && r.data.result) || [];
  if (!zones.length) return { ok: false, code: 'zone_not_found' };
  return { ok: true, zoneId: zones[0].id, zoneName: zones[0].name };
}

/**
 * Transform Rule header değerleri — YALNIZCA her sitede güvenle
 * uygulanabilenler.
 *
 * CSP BURADA YOK, bilinçli olarak. Doğru bir CSP sitenin kullandığı her
 * kaynağa (satır içi script/stil, yazı tipi, analitik, CDN) göre yazılır.
 * Tek tip bir değer (eskiden `default-src 'self'`) bunların hepsini engeller:
 * 1-Tık bu değeri atlasasistan.com'a bastı ve site stilsiz, script'siz kaldı.
 * CSP için müşteriye "Nasıl düzeltirim?" kodu ya da elle, test edilerek
 * yapılan "Biz düzeltelim" hizmeti sunulur.
 *
 * HSTS'de `includeSubDomains` ve `preload` YOK: HTTPS sunmayan bir alt alan
 * adını erişilemez yapar; preload listesine girilirse aylarca geri alınamaz.
 * Bunlar sitenin sahibinin bilerek vereceği kararlar, bizim varsayılanımız değil.
 */
const FIX_HEADERS = {
  hsts: { header: 'Strict-Transport-Security', value: 'max-age=31536000' },
  xframe: { header: 'X-Frame-Options', value: 'SAMEORIGIN' }
};

/** 1-Tık ile uygulanabilen düzeltmeler; 'all' bunların hepsi. */
const AUTO_FIXES = Object.keys(FIX_HEADERS);

function fixesFor(fixType) {
  if (fixType === 'all') return AUTO_FIXES.slice();
  return FIX_HEADERS[fixType] ? [fixType] : [];
}

const PRECHECK_TIMEOUT_MS = 8000;
const PRECHECK_MAX_REDIRECTS = 4;

/**
 * Sitenin ŞU AN gönderdiği başlık adlarını (küçük harf) okur. Sitede zaten
 * olan bir başlık 1-Tık ile EZİLMEZ: sahibinin bilerek koyduğu değer (ör.
 * daha uzun bir HSTS süresi) bizimkinden doğru olabilir.
 *
 * Yönlendirmeler İZLENİR ve son sayfanın başlıkları döner: apex → www gibi
 * bir yönlendirme yanıtı genelde güvenlik başlığı taşımaz; yalnız ona bakmak
 * gerçek sayfadaki başlığı "yok" sanıp bölge geneli kuralla ezerdi.
 * Her adımın hedefi SSRF kapısından ayrıca geçer (yönlendirme iç ağa
 * çevirebilir); yalnız https izlenir.
 *
 * Okunamazsa null döner ve çağıran kural YAZMAZ: neyi ezeceğini bilmeden
 * değişiklik yapılmaz.
 */
async function presentHeaders(domain) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, PRECHECK_TIMEOUT_MS);
  try {
    let url = new URL('https://' + domain + '/');
    for (let hop = 0; hop <= PRECHECK_MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'https:') return null;
      await guard.assertPublicHost(url.hostname);
      const r = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
      if (r.body && typeof r.body.cancel === 'function') r.body.cancel().catch(function () {});
      const location = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      const names = [];
      r.headers.forEach(function (v, k) { names.push(String(k).toLowerCase()); });
      return names;
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * http_response_headers_transform fazına set-header kuralı ekler.
 * Cloudflare rulesets API: her fazda tek ruleset olur; varsa kural eklenir,
 * yoksa fazın ruleset'i oluşturulur.
 */
async function applyTransformRule(zoneId, token, fixes) {
  if (typeof fixes === 'string') fixes = fixesFor(fixes);
  const rule = {
    expression: 'true',
    description: 'CyberLion AI 1-click fix: ' + fixes.join('+'),
    action: 'rewrite',
    action_parameters: {
      headers: {}
    }
  };
  fixes.forEach(function (f) {
    const spec = FIX_HEADERS[f];
    if (spec) {
      rule.action_parameters.headers[spec.header] = {
        operation: 'set',
        value: spec.value
      };
    }
  });

  // Mevcut faz ruleset'ini bul
  const list = await cf('/zones/' + zoneId + '/rulesets/phases/http_response_headers_transform/entrypoint', 'GET', token);
  if (list.ok && list.data && list.data.result && list.data.result.id) {
    const rsId = list.data.result.id;
    const r = await cf('/zones/' + zoneId + '/rulesets/' + rsId + '/rules', 'POST', token, rule);
    if (!r.ok) return { ok: false, code: r.code, status: r.status };
    return { ok: true, rulesetId: rsId, ruleId: r.data && r.data.result ? r.data.result.id : null };
  }

  // Yoksa oluştur
  const create = await cf('/zones/' + zoneId + '/rulesets', 'POST', token, {
    name: 'cyberlion-autofix',
    kind: 'zone',
    phase: 'http_response_headers_transform',
    rules: [rule]
  });
  if (!create.ok) return { ok: false, code: create.code, status: create.status };
  const created = create.data && create.data.result ? create.data.result : null;
  return {
    ok: true,
    rulesetId: created ? created.id : null,
    ruleId: created && created.rules ? created.rules[0].id : null
  };
}

module.exports = { cf, findZoneId, applyTransformRule, presentHeaders, fixesFor, FIX_HEADERS, AUTO_FIXES, maskToken };
