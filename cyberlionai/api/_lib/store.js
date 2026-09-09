'use strict';

/**
 * Kalıcı sayaç deposu (Upstash Redis REST).
 *
 * Neden REST: projede paket bağımlılığı yok ve olmasın istiyoruz. Upstash'in
 * REST arayüzü düz fetch ile çalışır, bu yüzden node_modules ve build adımı
 * eklemeden atomik sayaç kullanabiliyoruz.
 *
 * Neden kalıcı: sunucusuz ortamda bellek içi sayaç her fonksiyon örneğinde
 * ayrıdır; bir istemci farklı örneklere düşerek sınırı kolayca aşar. Merkezî
 * depo olmadan hız sınırı bir güvenlik kontrolü değil, süstür.
 *
 * Gerekli ortam değişkenleri (değerleri koda yazılmaz, Vercel'de tanımlanır):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

const REST_TIMEOUT_MS = 3000;

function config() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token: token } : null;
}

function isConfigured() { return config() !== null; }

/** Upstash REST'e tek komut gönderir. Komut dizisi: ["EVAL", script, "1", key, ...] */
async function command(parts) {
  const cfg = config();
  if (!cfg) throw new Error('store_not_configured');

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, REST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(cfg.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(parts)
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('store_unreachable');
  }
  clearTimeout(timer);

  if (!response.ok) throw new Error('store_error_' + response.status);

  const payload = await response.json().catch(function () { return null; });
  if (!payload || typeof payload !== 'object') throw new Error('store_bad_response');
  if (payload.error) throw new Error('store_error');
  return payload.result;
}

/* ------------------------------------------------------------------
   Lua script'leri: kontrol ve artırma tek turda, atomik yapılır.
   Ayrı GET + INCR çağrıları yarış koşuluna açıktır; eşzamanlı iki istek
   son hakkı iki kez harcayabilir.
   ------------------------------------------------------------------ */

/** Sabit pencere sayacı. Dönüş: [sayı, kalan saniye] */
const RATE_SCRIPT =
  "local c = redis.call('INCR', KEYS[1]) " +
  "if c == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end " +
  "return {c, redis.call('TTL', KEYS[1])}";

/** Kota ayırma. Dönüş: [1, yeni kullanım] veya [-1, mevcut kullanım] */
const QUOTA_RESERVE_SCRIPT =
  "local used = tonumber(redis.call('GET', KEYS[1]) or '0') " +
  "if used >= tonumber(ARGV[1]) then return {-1, used} end " +
  "local n = redis.call('INCR', KEYS[1]) " +
  "if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end " +
  "return {1, n}";

/** Kota iadesi: sayaç sıfırın altına düşmez. */
const QUOTA_REFUND_SCRIPT =
  "local used = tonumber(redis.call('GET', KEYS[1]) or '0') " +
  "if used <= 0 then return 0 end " +
  "return redis.call('DECR', KEYS[1])";

async function hitRateLimit(key, windowSeconds) {
  const result = await command(['EVAL', RATE_SCRIPT, '1', key, String(windowSeconds)]);
  return { count: Number(result[0]), ttl: Number(result[1]) };
}

async function reserveQuota(key, limit, ttlSeconds) {
  const result = await command(['EVAL', QUOTA_RESERVE_SCRIPT, '1', key, String(limit), String(ttlSeconds)]);
  const ok = Number(result[0]) === 1;
  return { ok: ok, used: Number(result[1]) };
}

async function refundQuota(key) {
  await command(['EVAL', QUOTA_REFUND_SCRIPT, '1', key]);
}

async function readQuota(key) {
  const value = await command(['GET', key]);
  const used = parseInt(value, 10);
  return isNaN(used) ? 0 : used;
}

module.exports = { isConfigured, hitRateLimit, reserveQuota, refundQuota, readQuota };
