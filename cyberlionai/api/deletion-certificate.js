'use strict';

/**
 * Silme sertifikası doğrulama (herkese açık).
 *
 *   GET /api/deletion-certificate?code=DEL-XXXXXXXX
 *     → 200 { valid: true, code, scopes, counts, createdAt }
 *     → 404 { valid: false }
 *
 * Yanıtta kişiye ait hiçbir şey yok çünkü tabloda da yok: kod, kapsam,
 * satır sayıları ve tarih. Kodu bilen silmenin YAPILDIĞINI doğrular, KİMİN
 * yaptığını öğrenemez. Kod uzayı 32^8; yine de deneme yanılmaya karşı hız
 * sınırı var (depo yoksa uç çalışmaya devam eder: dönen veri hassas değil).
 */

const memory = require('./_lib/memory.js');
const store = require('./_lib/store.js');
const { clientIp, ipKey } = require('./_lib/session.js');

const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 20;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  if (!memory.isConfigured()) return res.status(503).json({ error: { code: 'unavailable' } });

  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit('cl:rl:delcert:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
      if (rate.count > RATE_MAX) {
        res.setHeader('Retry-After', String(rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS));
        return res.status(429).json({ error: { code: 'rate_limited' } });
      }
    } catch (e) { /* sınır uygulanamadı; veri hassas değil, istek kabul */ }
  }

  const code = req.query && typeof req.query.code === 'string' ? req.query.code : '';
  if (!memory.CODE_RE.test(code.trim().toUpperCase())) {
    return res.status(400).json({ valid: false, error: { code: 'invalid_code' } });
  }
  try {
    const cert = await memory.getCertificate(code);
    if (!cert) return res.status(404).json({ valid: false });
    return res.status(200).json(Object.assign({ valid: true }, cert));
  } catch (err) {
    return res.status(503).json({ error: { code: 'unavailable' } });
  }
};
