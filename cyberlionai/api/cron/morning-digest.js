'use strict';

/**
 * Sabah güvenlik özeti (e-posta).
 *
 *   GET /api/cron/morning-digest   Vercel Cron, 03:00 UTC = 06:00 İstanbul
 *                                  (Bearer CRON_SECRET; bkz. _lib/cronauth.js)
 *
 * Son 24 saatte günlük izlemenin (`_lib/monitor.js`, 5 dk'lık tick ile gün
 * boyu dağıtılmış) hesaplara yazdığı `monitor_alerts` satırlarını kullanıcı
 * başına toplar ve TEK bir özet e-postası gönderir. Uygulama içi bildirim
 * zaten var: aynı satırlar panelde listeleniyor; bu uç yalnızca e-posta.
 *
 * NEDEN TARAMA BURADA DEĞİL: tüm alan adlarını tek bir 03:00 koşusunda taramak
 * fonksiyonun 60 sn sınırını aşar; tarama gün boyu dağıtılmış kalıyor, sabah
 * yalnızca sonuç bildiriliyor.
 *
 * NE YAZILMAZ: "engellenen saldırı", "eklenti güncellemesi" gibi ölçmediğimiz
 * hiçbir şey (bkz. mailer.digestEmail).
 *
 * Tekrar çalıştırılabilir: kullanıcı başına günde bir özet (Redis kilidi;
 * depo yoksa kilit uygulanamaz ve uç ÇALIŞMAZ — çift e-posta göndermektense
 * hiç göndermemek). Mail sağlayıcısı yoksa hiç sorgu atmadan döner.
 */

const db = require('../_lib/db.js');
const auth = require('../_lib/auth.js');
const store = require('../_lib/store.js');
const mailer = require('../_lib/mailer.js');
const cronauth = require('../_lib/cronauth.js');

const WINDOW_HOURS = 24;
const MAX_ALERTS = 2000;
const MAX_USERS = 150;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function istanbulDay(now) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}

async function run(now) {
  const since = new Date(now - WINDOW_HOURS * 3600 * 1000).toISOString();
  const rows = await db.request('monitor_alerts?created_at=gte.' + encodeURIComponent(since)
    + '&select=user_id,domain,kind,severity,data,created_at&order=created_at.asc&limit=' + MAX_ALERTS);
  const byUser = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (r && UUID_RE.test(String(r.user_id))) (byUser[r.user_id] = byUser[r.user_id] || []).push(r);
  });

  const day = istanbulDay(now);
  const out = { users: 0, sent: 0, skipped: 0, failed: 0 };
  const users = Object.keys(byUser).slice(0, MAX_USERS);
  for (const userId of users) {
    out.users += 1;
    if (!(await store.setOnce('cl:digest:' + userId + ':' + day, 2 * 86400))) { out.skipped += 1; continue; }
    let email = null;
    try { email = await auth.adminGetUserEmail(userId); } catch (e) { email = null; }
    if (!email) { out.failed += 1; continue; }
    const m = mailer.digestEmail(byUser[userId]);
    const r = await mailer.send({ to: email, subject: m.subject, text: m.text, html: m.html });
    if (r.ok) out.sent += 1; else out.failed += 1;
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  const a = cronauth.authorize(req);
  if (!a.ok) return res.status(a.status).json({ error: { code: a.code } });

  if (!mailer.isConfigured()) return res.status(200).json({ ok: true, skipped: 'mail_unconfigured' });
  if (!db.isConfigured() || !auth.adminConfigured() || !store.isConfigured()) {
    return res.status(503).json({ error: { code: 'digest_unconfigured' } });
  }
  try {
    const out = await run(Date.now());
    console.log(JSON.stringify(Object.assign({ ev: 'morning_digest' }, out)));
    return res.status(200).json(Object.assign({ ok: true }, out));
  } catch (err) {
    if (console && console.error) console.error('morning digest failed:', err.message);
    return res.status(503).json({ error: { code: 'digest_failed' } });
  }
};

module.exports.run = run;
