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

/** Transform Rule header değerleri. */
const FIX_HEADERS = {
  hsts: { header: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  csp: { header: 'Content-Security-Policy', value: "default-src 'self'" },
  xframe: { header: 'X-Frame-Options', value: 'SAMEORIGIN' }
};

/**
 * http_response_headers_transform fazına set-header kuralı ekler.
 * Cloudflare rulesets API: her fazda tek ruleset olur; varsa kural eklenir,
 * yoksa fazın ruleset'i oluşturulur.
 */
async function applyTransformRule(zoneId, token, fixType) {
  const rule = {
    expression: 'true',
    description: 'CyberLion AI 1-click fix: ' + fixType,
    action: 'rewrite',
    action_parameters: {
      headers: {}
    }
  };
  const fixes = fixType === 'all' ? ['hsts', 'csp', 'xframe'] : [fixType];
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

module.exports = { cf, findZoneId, applyTransformRule, FIX_HEADERS, maskToken };
