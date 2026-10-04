'use strict';

/**
 * Sürekli izleme: ücretli aboneliklerin alan adları için günlük PASİF tarama
 * ve uyarılar; Enterprise için 5 dakikalık erişilebilirlik (uptime) yoklaması.
 *
 * NE İZLENİYOR
 *   - Skor düşüşü (≥5 puan, bir önceki tamamlanmış taramaya göre)
 *   - SSL sertifikası bitişine 30 / 7 / 1 gün kala (her eşikte bir kez)
 *   - Alan adı kaydının bitişine 30 / 7 gün kala (RDAP; haftada bir sorgu)
 *   - Kara liste: URLhaus host listesi (abuse.ch, CC0; ticari kullanım serbest)
 *   - Kesinti (yalnız Enterprise): art arda 2 başarısız yoklama → uyarı;
 *     geri gelince "düzeldi" uyarısı
 *
 * PASİF: izleme taraması `consent: false` ile çalışır (seviye 1). Bir cron,
 * müşterinin o anki beyanını taşıyamaz.
 *
 * UYARI NEREYE: hesaba bağlı `monitor_alerts` (panelde listelenir) + işletmecinin
 * Telegram'ı. E-posta sağlayıcısı yok; eklendiğinde aynı satırlardan gider.
 * Aynı olay için tek uyarı: anahtar olayın kimliğinden (eşik, sertifika bitiş
 * tarihi, iş kimliği) kuruluyor.
 *
 * SIRA: her alan adı günde en çok bir kez taranır (`cl:mon:scan:*` kilidi,
 * 20 saat). Bir koşu az sayıda alan adını işler; 5 dakikalık tetikleyici
 * günü bölerek hepsine yetişir (288 koşu × 2 = 576 alan adı/gün).
 */

const db = require('./db.js');
const store = require('./store.js');
const tg = require('./telegram.js');
const { assertPublicHost } = require('./guard.js');

const PAID_PLANS = ['pro', 'enterprise'];
const SCAN_LOCK_SECONDS = 20 * 3600;
const RDAP_LOCK_SECONDS = 7 * 86400;
const SCORE_DROP_ALERT = 5;
const SSL_THRESHOLDS = [30, 7, 1];
const DOMAIN_THRESHOLDS = [30, 7];
const UPTIME_TIMEOUT_MS = 10000;
const UPTIME_FAILS_FOR_DOWN = 2;
const BLACKLIST_URL = 'https://urlhaus.abuse.ch/downloads/hostfile/';
const BLACKLIST_MAX_BYTES = 4 * 1024 * 1024;
const UA = 'CyberLionAI-Monitor/1.0 (+https://www.cyberlionai.com/pages/tarama-yetkisi)';

/* Türkiye'deki ikinci seviye uzantılar: kayıtlı alan adı bir etiket daha uzun. */
const TR_SECOND_LEVEL = ['com', 'net', 'org', 'gen', 'web', 'biz', 'info', 'tv', 'name',
  'bel', 'av', 'dr', 'edu', 'gov', 'k12', 'pol', 'tsk', 'bbs', 'tel', 'kep'];

/* ------------------------------------------------------------------
   Hedefler
   ------------------------------------------------------------------ */

/** Etkin ücretli aboneliklerin alan adları. Alan adı seçilmemiş abonelik atlanır. */
async function paidTargets(plans, limit) {
  const list = (plans || PAID_PLANS).filter(function (p) { return PAID_PLANS.indexOf(p) !== -1; });
  const rows = await db.request('cl_subscriptions?active=is.true'
    + '&plan=in.(' + list.join(',') + ')'
    + '&domain=not.is.null&select=user_id,domain,plan&order=created_at.asc&limit='
    + Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000));
  const seen = {};
  return (Array.isArray(rows) ? rows : []).filter(function (r) {
    if (!r || !r.user_id || typeof r.domain !== 'string') return false;
    if (!/^[a-z0-9.-]{1,253}\.[a-z]{2,}$/i.test(r.domain)) return false;
    const key = r.user_id + '|' + r.domain.toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(function (r) {
    return { userId: r.user_id, domain: r.domain.toLowerCase(), plan: r.plan };
  });
}

/** Bugün taranmamış hedeflerden en çok `n` tanesini KİLİTLEYEREK seçer. */
async function claimDue(targets, n) {
  const out = [];
  for (let i = 0; i < targets.length && out.length < n; i++) {
    const t = targets[i];
    let claimed = true;
    if (store.isConfigured()) {
      try {
        claimed = await store.setOnce('cl:mon:scan:' + t.userId + ':' + t.domain, SCAN_LOCK_SECONDS);
      } catch (err) {
        /* Kilit okunamadı: aynı alan adı gün içinde iki kez taranabilir.
           Hiç taramamaktan iyi, ama sınırlı: koşu başına n. */
        claimed = true;
      }
    }
    if (claimed) out.push(t);
  }
  return out;
}

/* ------------------------------------------------------------------
   Uyarı
   ------------------------------------------------------------------ */

/** Tek seferlik uyarı: hesaba yazar + Telegram. `key` olay kimliği. */
async function raise(target, kind, severity, data, key, ttl) {
  if (key && !(await tg.tekSefer('mon:' + key, ttl || 30 * 86400))) return false;
  try {
    await db.request('monitor_alerts', {
      method: 'POST', headers: { 'Prefer': 'return=minimal' },
      body: { user_id: target.userId, domain: target.domain, kind: kind, severity: severity, data: data || {} }
    });
  } catch (err) {
    if (console && console.error) console.error('monitor alert write failed:', err.message);
  }
  await tg.sendTelegram(tg.mesaj.izlemeUyarisi(kind, target.domain, data || {}),
    { type: severity === 'critical' ? 'alert' : 'monitor' });
  return true;
}

/* ------------------------------------------------------------------
   Kontroller (saf kısımlar ayrı: sınanabilir)
   ------------------------------------------------------------------ */

/** Kalan güne göre geçilen en dar eşik (yoksa null). 30/7/1. */
function crossedThreshold(daysLeft, thresholds) {
  if (typeof daysLeft !== 'number') return null;
  let hit = null;
  thresholds.forEach(function (t) { if (daysLeft <= t) hit = t; });
  return hit;
}

/** Kayıtlı alan adı: www.ornek.com.tr → ornek.com.tr, a.b.ornek.com → ornek.com */
function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const take = tld === 'tr' && TR_SECOND_LEVEL.indexOf(sld) !== -1 ? 3 : 2;
  return parts.length >= take ? parts.slice(-take).join('.') : null;
}

/** URLhaus host listesini kümeye çevirir ("127.0.0.1<TAB>host" satırları). */
function parseHostfile(text) {
  const set = new Set();
  String(text || '').split('\n').forEach(function (line) {
    const l = line.trim();
    if (!l || l[0] === '#') return;
    const parts = l.split(/\s+/);
    const host = (parts[1] || parts[0] || '').toLowerCase();
    if (host && host !== 'localhost') set.add(host);
  });
  return set;
}

/** Alan adı ya da üst alanlarından biri listede mi. */
function blacklistedHost(domain, set) {
  if (!set || !set.size) return null;
  const parts = String(domain).toLowerCase().split('.');
  for (let i = 0; i <= parts.length - 2; i++) {
    const cand = parts.slice(i).join('.');
    if (set.has(cand)) return cand;
  }
  return null;
}

/** RDAP olaylarından kayıt bitiş tarihi (ISO) ya da null. */
function rdapExpiration(json) {
  const events = json && Array.isArray(json.events) ? json.events : [];
  for (let i = 0; i < events.length; i++) {
    if (events[i] && events[i].eventAction === 'expiration' && events[i].eventDate) {
      const d = new Date(events[i].eventDate);
      if (!isNaN(d)) return d.toISOString();
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   Ağ kısımları
   ------------------------------------------------------------------ */

async function timedFetch(url, opts, ms) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  try {
    return await fetch(url, Object.assign({ signal: controller.signal }, opts));
  } finally {
    clearTimeout(timer);
  }
}

/** Kara liste: koşu başına bir kez indirilir. Düşerse boş küme (kontrol atlanır). */
async function loadBlacklist() {
  try {
    const res = await timedFetch(BLACKLIST_URL, { headers: { 'User-Agent': UA } }, 15000);
    if (!res.ok) return new Set();
    const text = await res.text();
    return parseHostfile(text.length > BLACKLIST_MAX_BYTES ? text.slice(0, BLACKLIST_MAX_BYTES) : text);
  } catch (err) {
    if (console && console.warn) console.warn('monitor: blacklist unavailable -', err.message);
    return new Set();
  }
}

/** RDAP alan adı bitişi; .tr gibi RDAP sunmayan uzantılarda null. */
async function domainExpiry(domain) {
  const reg = registrableDomain(domain);
  if (!reg) return null;
  try {
    const res = await timedFetch('https://rdap.org/domain/' + encodeURIComponent(reg),
      { headers: { 'Accept': 'application/rdap+json', 'User-Agent': UA }, redirect: 'follow' }, 8000);
    if (!res.ok) return null;
    return rdapExpiration(await res.json());
  } catch (err) {
    return null;
  }
}

/** Hesabın bu alan adındaki son tamamlanmış taramasının skoru (yoksa null). */
async function previousScore(userId, domain) {
  try {
    const rows = await db.request('scan_jobs?user_id=eq.' + encodeURIComponent(userId)
      + '&domain=eq.' + encodeURIComponent(domain)
      + '&status=eq.completed&score=not.is.null&select=score&order=created_at.desc&limit=1');
    return rows && rows[0] && typeof rows[0].score === 'number' ? rows[0].score : null;
  } catch (err) {
    return null;
  }
}

/* ------------------------------------------------------------------
   Günlük kontrol (tek hedef)
   ------------------------------------------------------------------ */

/**
 * @param target  { userId, domain, plan }
 * @param ctx     { blacklist: Set, scanSite, saveJob, now }
 */
async function dailyCheck(target, ctx) {
  const out = { domain: target.domain, ok: false, alerts: [] };
  const onceki = await previousScore(target.userId, target.domain);

  /* Kullanım şartları 3.2: her tarama günlüğe yazılır (izleme dahil; IP yok,
     isteği eden bir kullanıcı yok). */
  await require('./ownership.js').logScan({
    userId: target.userId, ip: null, domain: target.domain, level: 'passive',
    verified: false, consent: false, userAgent: 'cron:monitor'
  });

  let scan;
  try {
    scan = await ctx.scanSite('https://' + target.domain, { consent: false });
  } catch (err) {
    out.error = String(err && err.message || 'scan_failed').slice(0, 60);
    return out;
  }
  out.ok = true;
  out.score = scan.score;
  if (ctx.saveJob) {
    try { out.jobId = await ctx.saveJob(scan, target); } catch (err) { out.jobId = null; }
  }

  /* Skor düşüşü */
  if (typeof onceki === 'number' && typeof scan.score === 'number' && onceki - scan.score >= SCORE_DROP_ALERT) {
    if (await raise(target, 'score_drop', 'warning', { from: onceki, to: scan.score },
      'drop:' + target.userId + ':' + target.domain + ':' + (out.jobId || Date.now()), 2 * 86400)) {
      out.alerts.push('score_drop');
    }
  }

  /* SSL bitişi: eşik + sertifikanın bitiş tarihi anahtarda → yenilenen
     sertifika için eşikler yeniden çalışır. */
  const tls = scan.tls || {};
  const ssl = crossedThreshold(tls.daysLeft, SSL_THRESHOLDS);
  if (ssl !== null) {
    if (await raise(target, 'ssl_expiry', ssl <= 7 ? 'critical' : 'warning',
      { daysLeft: tls.daysLeft, threshold: ssl, validTo: tls.validTo || null },
      'ssl:' + target.userId + ':' + target.domain + ':' + (tls.validTo || '') + ':' + ssl, 60 * 86400)) {
      out.alerts.push('ssl_expiry');
    }
  }

  /* Kara liste */
  const hit = blacklistedHost(target.domain, ctx.blacklist);
  if (hit) {
    if (await raise(target, 'blacklist', 'critical', { source: 'urlhaus', match: hit },
      'bl:' + target.userId + ':' + target.domain + ':' + hit, 7 * 86400)) {
      out.alerts.push('blacklist');
    }
  }

  /* Alan adı kaydı: haftada bir RDAP */
  let rdapNow = true;
  if (store.isConfigured()) {
    try { rdapNow = await store.setOnce('cl:mon:rdap:' + target.domain, RDAP_LOCK_SECONDS); } catch (err) { rdapNow = false; }
  }
  if (rdapNow) {
    const exp = await (ctx.domainExpiry || domainExpiry)(target.domain);
    if (exp) {
      const now = ctx.now ? ctx.now() : Date.now();
      const days = Math.floor((Date.parse(exp) - now) / 86400000);
      const dt = crossedThreshold(days, DOMAIN_THRESHOLDS);
      if (dt !== null && await raise(target, 'domain_expiry', dt <= 7 ? 'critical' : 'warning',
        { daysLeft: days, threshold: dt, expiresAt: exp },
        'dom:' + target.userId + ':' + target.domain + ':' + exp + ':' + dt, 60 * 86400)) {
        out.alerts.push('domain_expiry');
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------
   Erişilebilirlik (Enterprise, 5 dk)
   ------------------------------------------------------------------ */

/** Tek yoklama: 5xx, zaman aşımı, ağ hatası = düşük. Yönlendirme izlenmez (3xx = ayakta). */
async function probe(domain, fetcher) {
  try {
    await assertPublicHost(domain);
  } catch (err) {
    return { up: false, reason: 'blocked_or_dns' };
  }
  const started = Date.now();
  try {
    const res = await (fetcher || timedFetch)('https://' + domain + '/',
      { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA } }, UPTIME_TIMEOUT_MS);
    try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (e) { /* önemsiz */ }
    return { up: res.status < 500, status: res.status, ms: Date.now() - started };
  } catch (err) {
    return { up: false, reason: err && err.name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
}

/**
 * Durum makinesi: art arda UPTIME_FAILS_FOR_DOWN başarısızlık → 'downtime';
 * düşükken ilk başarılı yoklama → 'recovered'. Durum Redis'te.
 */
async function uptimeCheck(target, deps) {
  const d = deps || {};
  const key = 'cl:up:' + target.userId + ':' + target.domain;
  let state = { fails: 0, down: false, since: null };
  if (store.isConfigured()) {
    try { state = (await store.cacheGet(key)) || state; } catch (err) { /* sıfırdan */ }
  }
  const r = await probe(target.domain, d.fetch);
  const now = d.now ? d.now() : Date.now();
  let event = null;

  if (r.up) {
    if (state.down) {
      event = 'recovered';
      await raise(target, 'recovered', 'info',
        { downMinutes: state.since ? Math.round((now - state.since) / 60000) : null, status: r.status }, null);
    }
    state = { fails: 0, down: false, since: null };
  } else {
    state.fails = (state.fails || 0) + 1;
    if (!state.down && state.fails >= UPTIME_FAILS_FOR_DOWN) {
      state.down = true;
      state.since = now;
      event = 'downtime';
      await raise(target, 'downtime', 'critical', { reason: r.reason || ('http_' + r.status) }, null);
    }
  }
  if (store.isConfigured()) {
    try { await store.cacheSet(key, state, 7 * 86400); } catch (err) { /* sonraki yoklamada */ }
  }
  return { domain: target.domain, up: r.up, event: event };
}

/* ------------------------------------------------------------------
   QStash zamanlayıcısı (5 dk)
   ------------------------------------------------------------------ */

/**
 * 5 dakikalık tetikleyiciyi QStash'te oluşturur ya da günceller. Sabit
 * `Upstash-Schedule-Id` ile çağrıldığı için tekrar çağırmak kopya üretmez.
 * Günlük cron'dan çağrılır: Upstash konsolunda elle ayar gerekmez.
 */
async function ensureTickSchedule(siteUrl, fetcher) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return { ok: false, code: 'qstash_token_missing' };
  const base = (process.env.QSTASH_URL || 'https://qstash.upstash.io').replace(/\/+$/, '');
  const dest = String(siteUrl || process.env.SITE_URL || 'https://www.cyberlionai.com').replace(/\/+$/, '') + '/api/cron/tick';
  try {
    const res = await (fetcher || fetch)(base + '/v2/schedules/' + dest, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Upstash-Cron': '*/5 * * * *',
        'Upstash-Schedule-Id': 'cyberlion-monitor-tick',
        'Upstash-Method': 'POST',
        'Content-Type': 'application/json'
      },
      body: ''
    });
    return res.ok ? { ok: true } : { ok: false, code: 'qstash_status_' + res.status };
  } catch (err) {
    return { ok: false, code: 'qstash_unreachable' };
  }
}

module.exports = {
  paidTargets, claimDue, dailyCheck, uptimeCheck, probe, raise, loadBlacklist, domainExpiry,
  ensureTickSchedule, crossedThreshold, registrableDomain, parseHostfile, blacklistedHost,
  rdapExpiration, previousScore,
  SSL_THRESHOLDS, DOMAIN_THRESHOLDS, SCORE_DROP_ALERT, UPTIME_FAILS_FOR_DOWN
};
