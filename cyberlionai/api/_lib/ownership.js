'use strict';

/**
 * Alan adı sahipliği doğrulaması ve tarama günlüğü.
 *
 * NEDEN
 *
 * Aktif testler (XSS/SQLi yoklaması, hassas dosya yolu denemesi) ve
 * Cloudflare düzeltmesi eskiden yalnızca bir onay kutusuna bağlıydı: beyan
 * vardı, ispat yoktu. Başkasının sistemine izinsiz aktif test TCK m.243,
 * yapılandırma değişikliği m.244 kapsamına girebilir. Artık bu işlemler
 * yalnızca sahipliği KANITLANMIŞ alan adlarında çalışıyor (bkz. scan-levels.js).
 *
 * ÜÇ YÖNTEM
 *
 *   dns   _cyberlion-verify.<alan>  TXT  "<belirteç>"
 *   file  https://<alan>/.well-known/cyberlion-verify.txt  içinde belirteç
 *   meta  https://<alan>/  sayfasında <meta name="cyberlion-verify" content="<belirteç>">
 *
 * KAPSAM: DNS ile doğrulanan alan adı ALT ALAN ADLARINI da kapsar (DNS'i
 * yöneten alt alanları da yönetir). Dosya ve meta yalnızca o ana bilgisayarı
 * kanıtlar; www.ornek.com ile ornek.com ayrı doğrulanır.
 *
 * SSRF: alan adına yapılan her istek önce `assertPublicHost`'tan geçer;
 * yönlendirme elle izlenir (en çok 3 adım), her adımda yeniden denetlenir ve
 * yalnızca aynı alan adı içinde kalınır. Yanıt 256 KB ve 5 sn ile sınırlı.
 *
 * KAPALI DEVRE: veritabanı yoksa ya da okunamazsa alan adı DOĞRULANMAMIŞ
 * sayılır. Hata hiçbir zaman "doğrulanmış" sonucuna düşmez.
 */

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const db = require('./db.js');
const { assertPublicHost } = require('./guard.js');

const TOKEN_PREFIX = 'cyberlion-verify-';
const TOKEN_RE = /^cyberlion-verify-[a-f0-9]{32}$/;
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const METHODS = ['dns', 'file', 'meta'];
const DNS_PREFIX = '_cyberlion-verify.';
const FILE_PATH = '/.well-known/cyberlion-verify.txt';
const META_NAME = 'cyberlion-verify';

const MAX_FAILED = 3;
const COOLDOWN_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const LOG_RETENTION_DAYS = 365;

/** Alan adını sadeleştirir: şema, yol, port, sondaki nokta atılır. Geçersizse null. */
function normalizeDomain(raw) {
  let s = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split('?')[0].split('#')[0];
  s = s.split('@').pop().split(':')[0].replace(/\.+$/, '');
  return DOMAIN_RE.test(s) ? s : null;
}

function newToken() {
  return TOKEN_PREFIX + crypto.randomBytes(16).toString('hex');
}

/** Kullanıcıya gösterilecek yönergeler (belirteç dahil). */
function instructions(domain, token) {
  return {
    dns: { name: DNS_PREFIX + domain, type: 'TXT', value: token },
    file: { url: 'https://' + domain + FILE_PATH, content: token },
    meta: { url: 'https://' + domain + '/', tag: '<meta name="' + META_NAME + '" content="' + token + '">' }
  };
}

/* ------------------------------------------------------------------
   Kanıt okuma
   ------------------------------------------------------------------ */

async function dnsHasToken(domain, token, resolver) {
  const resolve = resolver || dns.resolveTxt;
  let records;
  try {
    records = await resolve(DNS_PREFIX + domain);
  } catch (err) {
    return false;
  }
  return (records || []).some(function (chunks) {
    return (Array.isArray(chunks) ? chunks.join('') : String(chunks)).trim() === token;
  });
}

/** Aynı alan adı mı (www. öneki dahil): yönlendirme bu sınırın dışına çıkamaz. */
function sameSite(a, b) {
  const strip = function (h) { return h.replace(/^www\./, ''); };
  return strip(a) === strip(b);
}

/**
 * Güvenli GET: her adımda genel adres denetimi, elle yönlendirme, boyut ve
 * süre sınırı. Gövdeyi metin olarak döner; başarısızsa null.
 */
async function safeGet(startUrl, fetcher) {
  const doFetch = fetcher || fetch;
  let url = new URL(startUrl);
  const origin = url.hostname;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' || !sameSite(url.hostname, origin)) return null;
    try { await assertPublicHost(url.hostname); } catch (err) { return null; }

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await doFetch(url.href, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': 'CyberLionAI-Verify/1.0 (+https://www.cyberlionai.com/pages/tarama-yetkisi)', 'Accept': 'text/html,text/plain' }
      });
    } catch (err) {
      clearTimeout(timer);
      return null;
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers && res.headers.get && res.headers.get('location');
      if (!loc) return null;
      try { url = new URL(loc, url); } catch (err) { return null; }
      continue;
    }
    if (!res.ok) { clearTimeout(timer); return null; }

    try {
      const text = await res.text();
      clearTimeout(timer);
      return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
    } catch (err) {
      clearTimeout(timer);
      return null;
    }
  }
  return null;
}

async function fileHasToken(domain, token, fetcher) {
  const body = await safeGet('https://' + domain + FILE_PATH, fetcher);
  return body !== null && body.trim().split(/\s+/)[0] === token;
}

/** <meta name="cyberlion-verify" content="..."> — öznitelik sırası serbest. */
function metaToken(html) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const name = /\bname\s*=\s*["']?([^"'\s>]+)/i.exec(tag);
    if (!name || name[1].toLowerCase() !== META_NAME) continue;
    const content = /\bcontent\s*=\s*["']?([^"'\s>]+)/i.exec(tag);
    if (content) return content[1];
  }
  return null;
}

async function metaHasToken(domain, token, fetcher) {
  const body = await safeGet('https://' + domain + '/', fetcher);
  return body !== null && metaToken(body) === token;
}

/** Seçilen yönteme göre kanıtı okur. `deps` sınamada saplamak için. */
async function proofFound(method, domain, token, deps) {
  const d = deps || {};
  if (method === 'dns') return dnsHasToken(domain, token, d.resolveTxt);
  if (method === 'file') return fileHasToken(domain, token, d.fetch);
  if (method === 'meta') return metaHasToken(domain, token, d.fetch);
  return false;
}

/* ------------------------------------------------------------------
   Kayıtlar
   ------------------------------------------------------------------ */

function rowFilter(userId, domain) {
  return 'user_id=eq.' + encodeURIComponent(userId) + '&domain=eq.' + encodeURIComponent(domain);
}

async function getRow(userId, domain) {
  const rows = await db.request('verified_domains?' + rowFilter(userId, domain) + '&select=*&limit=1');
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Doğrulama başlatır ya da süren doğrulamayı döndürür. Belirteç bir kez
 * üretilir ve DEĞİŞMEZ: kullanıcı DNS kaydını ekledikten sonra yeniden
 * "başlat"a basarsa kayıt geçersiz kalmasın.
 */
async function initVerification(userId, domain) {
  const existing = await getRow(userId, domain);
  if (existing) return existing;
  const rows = await db.request('verified_domains', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: { user_id: userId, domain: domain, token: newToken(), status: 'pending' }
  });
  return rows && rows[0] ? rows[0] : null;
}

async function patchRow(id, patch) {
  await db.request('verified_domains?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: patch
  });
}

/**
 * Kanıtı kontrol eder ve kaydı günceller.
 * @returns {{ok: boolean, code?: string, status?: string, retryAfter?: number, row?: object}}
 */
async function checkVerification(userId, domain, method, deps) {
  if (METHODS.indexOf(method) === -1) return { ok: false, code: 'invalid_method' };
  const row = await getRow(userId, domain);
  if (!row) return { ok: false, code: 'not_started' };
  if (row.status === 'verified') return { ok: true, status: 'verified', row: row };

  const now = (deps && deps.now) ? deps.now() : Date.now();
  if (row.cooldown_until && Date.parse(row.cooldown_until) > now) {
    return { ok: false, code: 'cooldown', retryAfter: Math.ceil((Date.parse(row.cooldown_until) - now) / 1000) };
  }

  const found = await proofFound(method, domain, row.token, deps);
  const stamp = new Date(now).toISOString();
  if (found) {
    await patchRow(row.id, { status: 'verified', method: method, verified_at: stamp,
      last_checked_at: stamp, failed_attempts: 0, cooldown_until: null });
    return { ok: true, status: 'verified', row: Object.assign({}, row, { status: 'verified', method: method, verified_at: stamp }) };
  }

  const failed = (row.failed_attempts || 0) + 1;
  if (failed >= MAX_FAILED) {
    const until = new Date(now + COOLDOWN_MS).toISOString();
    await patchRow(row.id, { failed_attempts: 0, cooldown_until: until, last_checked_at: stamp, method: method });
    return { ok: false, code: 'cooldown', retryAfter: Math.ceil(COOLDOWN_MS / 1000) };
  }
  await patchRow(row.id, { failed_attempts: failed, last_checked_at: stamp, method: method });
  return { ok: false, code: 'not_found', attemptsLeft: MAX_FAILED - failed };
}

async function listVerifications(userId) {
  const rows = await db.request('verified_domains?user_id=eq.' + encodeURIComponent(userId)
    + '&select=domain,status,method,verified_at,created_at,token&order=created_at.desc&limit=100');
  return Array.isArray(rows) ? rows : [];
}

/** Bir alan adının üst alanları (kendisi dahil): a.b.ornek.com → [a.b.ornek.com, b.ornek.com, ornek.com]. */
function selfAndParents(domain) {
  const parts = domain.split('.');
  const out = [];
  for (let i = 0; i <= parts.length - 2; i++) out.push(parts.slice(i).join('.'));
  return out;
}

/**
 * Bu kullanıcı bu alan adı için doğrulanmış mı?
 * Birebir eşleşme her yöntemle; üst alan adı eşleşmesi yalnızca DNS ile.
 * Hata ya da eksik yapılandırma → false (kapalı devre).
 */
async function isVerified(userId, rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!userId || !domain || !db.isConfigured()) return false;
  const adaylar = selfAndParents(domain);
  try {
    const rows = await db.request('verified_domains?user_id=eq.' + encodeURIComponent(userId)
      + '&status=eq.verified'
      + '&domain=in.(' + adaylar.map(encodeURIComponent).join(',') + ')'
      + '&select=domain,method&limit=20');
    return (Array.isArray(rows) ? rows : []).some(function (r) {
      return r.domain === domain || r.method === 'dns';
    });
  } catch (err) {
    if (console && console.error) console.error('ownership read failed:', err.message);
    return false;
  }
}

/* ------------------------------------------------------------------
   Günlük
   ------------------------------------------------------------------ */

/**
 * Tarama günlüğü satırı. ASLA FIRLATMAZ: günlük yazılamadı diye müşterinin
 * taraması düşmemeli; hata loga düşer.
 */
async function logScan(entry) {
  if (!db.isConfigured()) return false;
  const domain = normalizeDomain(entry.domain) || String(entry.domain || '').slice(0, 253).toLowerCase();
  if (!domain) return false;
  try {
    await db.request('scan_logs', {
      method: 'POST', headers: { 'Prefer': 'return=minimal' },
      body: {
        user_id: entry.userId || null,
        ip: entry.ip ? String(entry.ip).slice(0, 64) : null,
        domain: domain,
        level: entry.level,
        verified: entry.verified === true,
        consent: entry.consent === true,
        user_agent: entry.userAgent ? String(entry.userAgent).slice(0, 300) : null
      }
    });
    return true;
  } catch (err) {
    if (console && console.error) console.error('scan log write failed:', err.message);
    return false;
  }
}

/** 12 aydan eski günlük satırlarını siler (haftalık cron çağırır). */
async function purgeOldLogs(now) {
  const cutoff = new Date((now || Date.now()) - LOG_RETENTION_DAYS * 86400 * 1000).toISOString();
  await db.request('scan_logs?created_at=lt.' + encodeURIComponent(cutoff), {
    method: 'DELETE', headers: { 'Prefer': 'return=minimal' }
  });
  return cutoff;
}

module.exports = {
  normalizeDomain, newToken, instructions, metaToken, selfAndParents, sameSite,
  proofFound, initVerification, checkVerification, listVerifications, isVerified,
  logScan, purgeOldLogs, safeGet,
  TOKEN_RE, METHODS, MAX_FAILED, COOLDOWN_MS, DNS_PREFIX, FILE_PATH, META_NAME, LOG_RETENTION_DAYS
};
