'use strict';

/**
 * SSRF koruması.
 *
 * Tarama motoru, kullanıcının verdiği adrese sunucumuzdan istek atar. Koruma
 * olmadan biri bu ucu kullanarak bizim ağımızın içini yoklayabilir: localhost,
 * özel IP blokları ve en tehlikelisi bulut sağlayıcıların meta veri servisi
 * (169.254.169.254) — oradan kimlik bilgisi sızdırılabilir.
 *
 * Bu yüzden her hedef, her yönlendirme adımında yeniden doğrulanır.
 */

const dns = require('node:dns').promises;
const net = require('node:net');

/** RFC 1918 / 6598 / 3927 ve benzeri yönlendirilemez IPv4 blokları. */
function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(function (n) { return Number.isNaN(n) || n < 0 || n > 255; })) return true;

  if (p[0] === 0) return true;                                   // 0.0.0.0/8
  if (p[0] === 10) return true;                                  // 10.0.0.0/8
  if (p[0] === 127) return true;                                 // döngü (loopback)
  if (p[0] === 169 && p[1] === 254) return true;                 // bağlantı yerel + bulut meta veri
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;     // 172.16.0.0/12
  if (p[0] === 192 && p[1] === 168) return true;                 // 192.168.0.0/16
  if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;     // IETF protokol tahsisi
  if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true;     // TEST-NET-1
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;    // CGNAT
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true; // kıyaslama ağı
  if (p[0] >= 224) return true;                                  // çoklu yayın + ayrılmış
  return false;
}

function isPrivateIPv6(ip) {
  const a = ip.toLowerCase();
  if (a === '::' || a === '::1') return true;                    // belirsiz + döngü
  if (a.startsWith('fe80') || a.startsWith('fec0')) return true; // bağlantı/site yerel
  if (a.startsWith('fc') || a.startsWith('fd')) return true;     // benzersiz yerel
  if (a.startsWith('::ffff:')) return isPrivateIPv4(a.slice(7)); // IPv4 eşlemeli
  return false;
}

function isBlockedAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

/**
 * Girdiyi temizler ve doğrular. Başarısızsa { error } döndürür.
 * Kullanıcı "ornek.com", "https://ornek.com/sayfa" veya "www.ornek.com" yazabilir.
 */
function normalizeTarget(raw) {
  let value = String(raw || '').trim();
  if (!value) return { error: 'empty' };
  if (value.length > 2000) return { error: 'too_long' };

  if (!/^https?:\/\//i.test(value)) value = 'https://' + value;

  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    return { error: 'invalid_url' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { error: 'bad_protocol' };
  if (parsed.username || parsed.password) return { error: 'credentials_not_allowed' };

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) return { error: 'invalid_url' };

  // Doğrudan IP verilmişse hemen ele; alan adı ise DNS çözümünde bakılır.
  if (net.isIP(host) && isBlockedAddress(host)) return { error: 'blocked_target' };

  // Yalnızca gerçek alan adları (nokta içeren) veya IP kabul edilir; "localhost" elenir.
  if (!net.isIP(host) && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host)) {
    return { error: 'invalid_url' };
  }

  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  if (port !== 80 && port !== 443 && port !== 8080 && port !== 8443) return { error: 'blocked_port' };

  return { url: parsed, host: host, port: port };
}

/**
 * Alan adının çözümlendiği tüm adresleri kontrol eder; biri bile özel ise
 * reddeder. Çözülen adresleri DÖNDÜRÜR.
 *
 * Adresleri döndürmesinin sebebi: tarama kaydına ülke yazılacak ve ülke bu
 * adreslerden türetiliyor. Çağıran taraf ayrı bir DNS sorgusu yapsaydı hem
 * gereksiz bir istek olurdu hem de iki sorgu arasında adres değişirse
 * güvenlik kontrolünden GEÇEN adresle ülkesi YAZILAN adres farklı olabilirdi.
 * Tek çözüm, tek gerçek.
 */
async function assertPublicHost(host) {
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error('blocked_target');
    return [host];
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    throw new Error('dns_failed');
  }

  if (!records.length) throw new Error('dns_failed');
  for (const record of records) {
    if (isBlockedAddress(record.address)) throw new Error('blocked_target');
  }
  return records.map(function (r) { return r.address; });
}

module.exports = { normalizeTarget, assertPublicHost, isBlockedAddress };
