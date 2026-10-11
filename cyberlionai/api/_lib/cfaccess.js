'use strict';

/**
 * Cloudflare uçlarının erişim kapısı (/api/autofix-cloudflare, /api/cloudflare-zones).
 *
 * NEDEN VAR
 *
 * Bu uçlar başlangıçta kimlik doğrulamasızdı ve istekte token yoksa sunucudaki
 * CLOUDFLARE_TEST_TOKEN'a düşüyordu. O değişken tanımlandığı anda internetteki
 * herkes, giriş yapmadan, BİZİM Cloudflare hesabımızla kural ekleyip
 * silebilirdi (ör. kendi sitemize `default-src 'self'` CSP'si basıp yazı
 * tiplerini kırmak). Değişken hiçbir ortamda tanımlı olmadığı için açık
 * istismar edilmedi; ama bir env değişkeni eklemek bir güvenlik açığı
 * açmamalı.
 *
 * KURALLAR
 *
 *   - Oturum zorunlu (HttpOnly çerez). Anonim → 401 auth_required.
 *   - Token yalnızca müşteriden gelir; sunucu token'ına düşüş YOK.
 *   - Token URL'de kabul edilmez: sorgu dizgesi erişim loglarına yazılır.
 *   - Kullanıcı başına saatte RATE_MAX istek.
 */

const auth = require('./auth.js');
const store = require('./store.js');

const RATE_WINDOW_SECONDS = 60 * 60;
const RATE_MAX = 30;
const TOKEN_MIN = 20;

/**
 * Oturumu ve hız sınırını uygular. Geçemezse yanıtı kendisi yazar ve null
 * döner; çağıran yalnızca `if (!user) return;` der.
 */
async function requireUser(req, res) {
  if (!auth.isConfigured()) {
    res.status(503).json({ error: { code: 'auth_unavailable' } });
    return null;
  }
  const user = await auth.resolveUser(req, res);
  if (!user) {
    res.status(401).json({ error: { code: 'auth_required' } });
    return null;
  }
  if (store.isConfigured()) {
    try {
      const hit = await store.hitRateLimit('cl:rl:cf:' + user.id, RATE_WINDOW_SECONDS);
      if (hit.count > RATE_MAX) {
        res.setHeader('Retry-After', String(hit.ttl > 0 ? hit.ttl : RATE_WINDOW_SECONDS));
        res.status(429).json({ error: { code: 'rate_limited' } });
        return null;
      }
    } catch (err) {
      if (console && console.warn) console.warn('cf rate limit store error:', err.message);
    }
  }
  return user;
}

/** Müşterinin token'ı geçerli biçimde mi? (Değeri asla loglanmaz.) */
function validToken(token) {
  return typeof token === 'string' && token.length >= TOKEN_MIN && token.length <= 200 && !/\s/.test(token);
}

module.exports = { requireUser, validToken, TOKEN_MIN };
