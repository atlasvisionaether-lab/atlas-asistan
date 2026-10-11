'use strict';

/**
 * POST /api/waitlist  →  { email, plan, domain }
 *
 * Pro aboneliği için ön kayıt (waitlist) ucu. Ödeme altyapısı (iyzico)
 * devreye girene kadar Pro butonu buraya yazar; talepler Supabase'deki
 * cl_waitlist tablosunda toplanır ve 24 saat içinde destek@ üzerinden
 * manuel dönüş yapılır.
 *
 * Güvenlik:
 *   - IP başına hız sınırı (store.hitRateLimit) — spam doldurma engellenir.
 *   - E-posta biçim doğrulaması; veri yalnızca servis rolü ile yazılır,
 *     tarayıcı veritabanına hiç bağlanmaz (RLS kapalı, anon erişimi yok).
 */

const store = require('./_lib/store.js');
const { clientIp, ipKey } = require('./_lib/session.js');
const tg = require('./_lib/telegram.js');

const TABLE = 'cl_waitlist';
const RATE_WINDOW_SECONDS = 3600;   // 1 saat
const RATE_MAX = 5;                 // IP başına saatlik 5 kayıt
const TIMEOUT_MS = 5000;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const PLAN_RE = /^(pro|enterprise)$/;

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key: key } : null;
}

async function insertRow(row) {
  const cfg = config();
  if (!cfg) throw new Error('db_not_configured');

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(cfg.url + '/rest/v1/' + TABLE, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'apikey': cfg.key,
        'Authorization': 'Bearer ' + cfg.key,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('db_unreachable');
  }
  clearTimeout(timer);

  if (!response.ok) {
    const text = await response.text().catch(function () { return ''; });
    if (console && console.error) console.error('waitlist db error', response.status, text.slice(0, 200));
    throw new Error('db_error_' + response.status);
  }
  return true;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!store.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  const rateKey = 'cl:wl:' + ipKey(clientIp(req));
  let rate;
  try {
    rate = await store.hitRateLimit(rateKey, RATE_WINDOW_SECONDS);
  } catch (err) {
    if (console && console.error) console.error('rate limit store error:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }
  if (rate.count > RATE_MAX) {
    res.setHeader('Retry-After', String(rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS));
    return res.status(429).json({ error: { code: 'rate_limited' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }

  const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const plan = body && typeof body.plan === 'string' ? body.plan.trim().toLowerCase() : 'pro';
  const domain = body && typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : null;

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: { code: 'invalid_email' } });
  }
  if (!PLAN_RE.test(plan)) {
    return res.status(400).json({ error: { code: 'invalid_plan' } });
  }
  if (domain && !/^[a-z0-9.-]{1,253}\.[a-z]{2,}$/.test(domain)) {
    return res.status(400).json({ error: { code: 'invalid_domain' } });
  }

  try {
    await insertRow({ email: email, plan: plan, domain: domain || null });
  } catch (err) {
    if (err.message === 'db_not_configured') {
      return res.status(503).json({ error: { code: 'service_unavailable' } });
    }
    return res.status(500).json({ error: { code: 'waitlist_failed' } });
  }

  /* E-posta maskeli gidiyor; tam adres cl_waitlist tablosunda. */
  await tg.sendTelegram(tg.mesaj.beklemeListesi(email, plan, domain), { type: 'waitlist' });

  return res.status(201).json({ ok: true });
}

module.exports = tg.ucuSar(handler, '/api/waitlist');
