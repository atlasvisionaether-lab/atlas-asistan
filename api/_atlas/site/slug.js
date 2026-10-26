'use strict';

/**
 * Klinik sitesi alt alan adı: <alt-alan>.atlasasistan.com ve atlasasistan.com/s/<alt-alan>.
 * 3–40 karakter, küçük harf/rakam/tire, tireyle başlamaz/bitmez (0022 CHECK ile aynı).
 * Ayrılmış adlar (altyapı, marka, karışıklık yaratabilecekler) kullanılamaz.
 */

const RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const RESERVED = new Set([
  'www', 'panel', 'api', 'app', 'admin', 'yonetim', 'mail', 'smtp', 'imap', 'pop', 'ftp', 'cdn', 'static', 'assets',
  'blog', 'destek', 'support', 'help', 'yardim', 'docs', 'status', 'dev', 'test', 'staging', 'preview', 'demo',
  'atlas', 'atlasasistan', 'asistan', 'checkout', 'odeme', 'iyzico', 'billing', 'fatura', 'login', 'giris', 'kayit',
  'hesap', 'account', 'auth', 'oauth', 'sso', 'ns1', 'ns2', 'mx', 'webmail', 'cpanel', 'whm', 'root', 'cyberlionai'
]);

const TR = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'c', 'Ğ': 'g', 'Ö': 'o', 'Ş': 's', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };

/** Klinik adından öneri: "Işıl Güzellik & Lazer" → "isil-guzellik-lazer" */
function suggest(name) {
  const s = String(name || '').replace(/[çğıİöşüÇĞÖŞÜâîû]/g, function (c) { return TR[c]; })
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s.length >= 3 ? s : (s + '-klinik').replace(/^-/, '');
}

/** null = geçerli; değilse hata kodu */
function check(sub) {
  const s = String(sub || '');
  if (!RE.test(s)) return 'format';
  if (s.indexOf('--') !== -1) return 'format';
  if (RESERVED.has(s)) return 'reserved';
  return null;
}

module.exports = { RE, RESERVED, suggest, check };
