'use strict';

/**
 * Kanal erişim jetonlarının şifrelenmesi (AES-256-GCM) ve rastgele gizli değerler.
 *
 *   CHANNEL_ENC_KEY  32 bayt anahtar: 64 karakter hex (openssl rand -hex 32).
 *                    Tanımsız/hatalıysa kanal bağlanamaz (şifresiz jeton tutulmaz).
 *
 * Biçim: "v1:<iv b64>:<etiket b64>:<şifreli metin b64>". Etiket doğrulanmazsa
 * (değiştirilmiş veri ya da yanlış anahtar) çözme hata verir.
 * Jetonlar ve anahtar LOGLANMAZ.
 */

const crypto = require('node:crypto');

function key() {
  const hex = String(process.env.CHANNEL_ENC_KEY || '').trim();
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}

function isConfigured() { return key() !== null; }

/** Nesneyi şifreler (JSON). Anahtar yoksa fırlatır. */
function seal(obj) {
  const k = key();
  if (!k) throw new Error('channel_enc_key_missing');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

/** seal'ın tersi. Bozuk/yanlış anahtar → fırlatır. */
function open(text) {
  const k = key();
  if (!k) throw new Error('channel_enc_key_missing');
  const p = String(text || '').split(':');
  if (p.length !== 4 || p[0] !== 'v1') throw new Error('channel_secret_format');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(p[1], 'base64'));
  d.setAuthTag(Buffer.from(p[2], 'base64'));
  const pt = Buffer.concat([d.update(Buffer.from(p[3], 'base64')), d.final()]);
  return JSON.parse(pt.toString('utf8'));
}

/** Telegram secret_token / Meta verify token: [A-Za-z0-9_-], 48 karakter. */
function randomToken() {
  return crypto.randomBytes(36).toString('base64url');
}

/** Zamanlama saldırısına dayanıklı eşitlik (uzunluk farkı da sızdırmaz). */
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a || '')).digest();
  const y = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(x, y) && String(a || '').length > 0;
}

module.exports = { isConfigured, seal, open, randomToken, safeEqual };
