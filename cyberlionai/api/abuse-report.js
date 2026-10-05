'use strict';

/**
 * POST /api/abuse-report  { domain, reason, email? }
 *
 * Üçüncü kişinin "sitem bu hizmetle izinsiz tarandı" bildirimi. Kayıt
 * abuse_reports tablosuna yazılır, ekibe Telegram uyarısı gider (son 30
 * günde o alan adına kaç tarama yapıldığıyla birlikte; inceleme oradan
 * başlar). Kimin taradığı bildirene DÖNMEZ: günlük yalnızca ekip içindir ve
 * yasal zorunlulukta yetkili mercilerle paylaşılır.
 *
 * IP başına saatte 5 bildirim. Depo yoksa sınır uygulanmaz ama bildirim yine
 * kabul edilir: kötüye kullanım bildirimini kapatmak, yanlış tarafı korumak olur.
 */

const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const ownership = require('./_lib/ownership.js');
const tg = require('./_lib/telegram.js');
const { clientIp, ipKey } = require('./_lib/session.js');

const RATE_WINDOW_SECONDS = 3600;
const RATE_MAX = 5;
const MAX_REASON = 2000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');

function bodyOf(req) {
  const b = req && req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) { try { return JSON.parse(b); } catch (e) { return null; } }
  return null;
}

async function recentScanCount(domain) {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  try {
    const rows = await db.request('scan_logs?domain=eq.' + encodeURIComponent(domain)
      + '&created_at=gte.' + encodeURIComponent(since) + '&select=id&limit=1000');
    return Array.isArray(rows) ? rows.length : 0;
  } catch (err) {
    return 0;
  }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const body = bodyOf(req) || {};
  const domain = ownership.normalizeDomain(body.domain);
  const reason = String(body.reason || '').replace(CONTROL, ' ').trim().slice(0, MAX_REASON);
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 320) : null;

  if (!domain) return res.status(400).json({ error: { code: 'invalid_domain' } });
  if (!reason) return res.status(400).json({ error: { code: 'reason_required' } });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: { code: 'invalid_email' } });

  const ip = clientIp(req);
  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit('cl:rl:abuse:' + ipKey(ip), RATE_WINDOW_SECONDS);
      if (rate.count > RATE_MAX) {
        const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
      }
    } catch (err) { /* sınır uygulanamadı, bildirim kabul */ }
  }

  if (!db.isConfigured()) return res.status(503).json({ error: { code: 'service_unavailable' } });
  try {
    await db.request('abuse_reports', {
      method: 'POST', headers: { 'Prefer': 'return=minimal' },
      body: { domain: domain, reason: reason, reporter_email: email, ip: ip ? String(ip).slice(0, 64) : null }
    });
  } catch (err) {
    if (console && console.error) console.error('abuse report write failed:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  const count = await recentScanCount(domain);
  await tg.sendTelegram(tg.mesaj.kotuyeKullanim(domain, reason, email, count), { type: 'alert', priority: true });

  return res.status(201).json({ ok: true });
}

module.exports = tg.ucuSar(handler, '/api/abuse-report');
