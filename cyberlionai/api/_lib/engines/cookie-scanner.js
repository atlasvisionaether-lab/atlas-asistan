'use strict';

/**
 * Çerez motoru: Set-Cookie bayrakları (Secure, HttpOnly, SameSite).
 *
 * scanner.js'in buildChecks'inden TAŞINDI; kontrol mantığı, sırası ve
 * ağırlıkları değişmedi (tools/engines-test.js eski çıktıyla birebir
 * karşılaştırır). Saf: ağ yok, bağlamdan okur.
 *
 * @returns { checks: Array, findings: Array, fixCode: Object }
 */

const { check, parseMaxAge, getSetCookies } = require('./common.js');
const { fixCodeFor } = require('./fixes.js');

function analyze(context, lang) {
  const h = context.headers;
  const checks = [];
  const isHttps = context.finalUrl.protocol === 'https:';

  /* --- Çerezler --- */
  const cookies = getSetCookies(h);
  if (!cookies.length) {
    checks.push(check('cookies', 'high', 'skipped', null, { note: 'no_cookies' }));
  } else {
    const weak = cookies.filter(function (c) {
      return !/;\s*secure/i.test(c) || !/;\s*httponly/i.test(c) || !/;\s*samesite/i.test(c);
    });
    checks.push(check('cookies', 'high', weak.length ? 'fail' : 'pass',
      weak.length ? weak.length + '/' + cookies.length : cookies.length + ' çerez',
      { note: weak.length ? 'missing_flags' : null }));
  }

  return { checks: checks, findings: [], fixCode: fixCodeFor(checks, lang) };
}

module.exports = { analyze, IDS: ["cookies"] };
