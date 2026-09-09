'use strict';

/**
 * POST /api/scan  →  { url: "ornek.com" }
 *
 * Gerçek tarama ucu. Hedefe sunucudan istek atılır, güvenlik başlıkları ve
 * TLS yapılandırması ölçülür, sonuç dinamik bir skorla döner.
 */

const { scanSite } = require('./_lib/scanner.js');

/* --- Hız sınırı ---------------------------------------------------------
   Kalıcı bir depo (Redis) bağlanana kadar bellek içi sayaç kullanılır.
   Sunucusuz ortamda her örneğin kendi sayacı olur, yani bu sınır kesin
   değildir; amacı tek bir istemcinin ucu sürekli meşgul etmesini
   zorlaştırmaktır. Gerçek koruma için kalıcı depo gerekir (README).        */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const hits = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const record = hits.get(ip);

  if (!record || now - record.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    // Sızıntıyı önlemek için ara sıra süresi geçmiş kayıtları temizle
    if (hits.size > 5000) {
      for (const [key, value] of hits) if (now - value.start > WINDOW_MS) hits.delete(key);
    }
    return { ok: true, remaining: MAX_PER_WINDOW - 1 };
  }

  record.count++;
  if (record.count > MAX_PER_WINDOW) {
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - record.start)) / 1000) };
  }
  return { ok: true, remaining: MAX_PER_WINDOW - record.count };
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** Motorun fırlattığı teknik hataları istemcinin çevirebileceği kodlara eşler. */
const ERROR_STATUS = {
  empty: 400, invalid_url: 400, too_long: 400, bad_protocol: 400,
  credentials_not_allowed: 400, blocked_port: 400,
  blocked_target: 403, dns_failed: 400,
  timeout: 504, unreachable: 502, bad_redirect: 502, too_many_redirects: 502
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const limit = rateLimit(clientIp(req));
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: { code: 'rate_limited', retryAfter: limit.retryAfter } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const url = body && body.url;
  if (!url) return res.status(400).json({ error: { code: 'empty' } });

  try {
    const result = await scanSite(url);
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    return res.status(200).json(result);
  } catch (err) {
    const code = (err && err.message) || 'scan_failed';
    const status = ERROR_STATUS[code] || 500;
    if (status >= 500 && console && console.error) console.error('scan error:', code);
    return res.status(status).json({ error: { code: code } });
  }
};
