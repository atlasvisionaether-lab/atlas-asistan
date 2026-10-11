'use strict';

/** Motorların ortak yardımcıları (scanner.js'ten taşındı, davranış aynı). */

function check(id, severity, status, detail, extra) {
  const item = { id: id, severity: severity, status: status, detail: detail || null };
  if (extra) Object.assign(item, extra);
  return item;
}

function parseMaxAge(value) {
  const match = /max-age\s*=\s*"?(\d+)"?/i.exec(value || '');
  return match ? Number(match[1]) : null;
}

/** Set-Cookie başlıklarını sürüm farklarından bağımsız olarak dizi hâlinde verir. */
function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

module.exports = { check, parseMaxAge, getSetCookies };
