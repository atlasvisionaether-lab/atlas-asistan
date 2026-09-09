'use strict';

/**
 * Anonim oturum kimliği ve istemci IP tespiti.
 *
 * Kota kararı sunucuda verilir; tarayıcıdaki localStorage yalnızca gösterim
 * içindir. Giriş sistemi henüz yok, bu yüzden ücretsiz hak sunucunun ürettiği
 * anonim oturum kimliğine bağlanır.
 */

const crypto = require('node:crypto');
const auth = require('./auth.js');

const COOKIE_NAME = 'cl_sid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;   // 1 yıl

/** 256 bit rastgele kimlik: tahmin edilemez olması, geçmiş kayıtlarına erişimi korur. */
function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  String(header).split(';').forEach(function (part) {
    const index = part.indexOf('=');
    if (index < 1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) jar[key] = decodeURIComponent(value);
  });
  return jar;
}

/**
 * Oturum kimliğini okur; yoksa üretir ve çerezi yanıta ekler.
 * Çerez HttpOnly + Secure + SameSite=Lax: JavaScript okuyamaz, yalnızca
 * HTTPS üzerinden gider ve siteler arası isteklerde taşınmaz.
 */
function resolveSession(req, res) {
  const jar = parseCookies(req.headers && req.headers.cookie);
  const existing = jar[COOKIE_NAME];

  if (typeof existing === 'string' && /^[0-9a-f]{64}$/.test(existing)) {
    return { id: existing, isNew: false };
  }

  const id = newSessionId();
  const cookie = COOKIE_NAME + '=' + id
    + '; Max-Age=' + COOKIE_MAX_AGE
    + '; Path=/; HttpOnly; Secure; SameSite=Lax';

  const previous = res.getHeader ? res.getHeader('Set-Cookie') : null;
  if (previous) {
    res.setHeader('Set-Cookie', [].concat(previous, cookie));
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
  return { id: id, isNew: true };
}

/**
 * İstemci IP'si.
 *
 * X-Forwarded-For'un tamamına güvenilmez: istemci kendi başlığını gönderip
 * başına sahte adres ekleyebilir ve hız sınırını atlayabilir. Vercel'in kendi
 * yazdığı başlıklar öncelikli; XFF'e düşülürse **en sağdaki** değer alınır,
 * çünkü onu bize en yakın güvenilir vekil ekler.
 */
function clientIp(req) {
  const headers = (req && req.headers) || {};

  const vercelIp = headers['x-vercel-forwarded-for'];
  if (typeof vercelIp === 'string' && vercelIp.trim()) return vercelIp.split(',').pop().trim();

  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();

  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const parts = forwarded.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** IP'yi ham saklamamak için kısaltılmış özet (KVKK: veri minimizasyonu). */
function ipKey(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

/**
 * İsteğin sahibini çözer.
 *
 * Giriş yapmışsa sahiplik kullanıcı kimliğine, aksi hâlde sunucunun verdiği
 * anonim oturum çerezine bağlanır. Her iki durumda da değer **sunucunun
 * doğruladığı** bir kaynaktan gelir; istemcinin gövdede veya başlıkta
 * gönderdiği hiçbir kimlik dikkate alınmaz.
 *
 * Anonim çerez giriş yapmış kullanıcıda da okunmaya devam eder: çıkış
 * yapıldığında aynı anonim geçmişe dönülür ve kota sayacı korunur.
 *
 * Dönüş: { userId, sessionId, isAuthenticated }
 */
async function resolveOwner(req, res) {
  const anon = resolveSession(req, res);
  let user = null;
  try { user = await auth.resolveUser(req, res); } catch (e) { user = null; }

  return {
    userId: user ? user.id : null,
    email: user ? user.email : null,
    sessionId: anon.id,
    isNewSession: anon.isNew,
    isAuthenticated: !!user
  };
}

/** Veri katmanının beklediği sahiplik nesnesi (tam olarak bir alan dolu). */
function ownerRef(owner) {
  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
}

module.exports = { resolveSession, clientIp, ipKey, resolveOwner, ownerRef, COOKIE_NAME };
