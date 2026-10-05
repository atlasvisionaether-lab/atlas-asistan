'use strict';

/**
 * DNSSEC ve e-posta güvenlik skoru.
 *
 * DNSSEC: kayıtlı alan adının üst bölgede DS kaydı var mı. DS, alan adının
 * DNS yanıtlarının imzalı ve doğrulanabilir olduğunu söyleyen zincirin
 * halkası. Sorgu DNS-over-HTTPS ile (Cloudflare 1.1.1.1, JSON biçimi):
 * Node'un çözümleyicisi DS sorgusunu taşımıyor ve DNSSEC durumunu vermiyor.
 * PASİF bir okuma: hedef siteye istek yok, yalnızca genel DNS.
 *
 * Ölçülemeyen durum (DoH düştü, SERVFAIL) "yok" sayılmaz: skipped.
 *
 * E-POSTA GÜVENLİK SKORU: SPF 30, DMARC 40, DKIM 20, DNSSEC 10. Ölçülemeyen
 * (skipped) parça paydan düşülür; DKIM seçicisi DNS'ten numaralandırılamadığı
 * için çoğu sitede skipped kalır ve cezalandırılmaz. Ana skordan AYRI:
 * bu kontroller ana skorda 'info' ağırlığında (0).
 */

const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const TIMEOUT_MS = 4000;
const DS_TYPE = 43;
const EMAIL_WEIGHTS = { spf: 30, dmarc: 40, dkim: 20, dnssec: 10 };

/* Türkiye'deki ikinci seviye uzantılar: kayıtlı alan adı bir etiket daha uzun. */
const TR_SECOND_LEVEL = ['com', 'net', 'org', 'gen', 'web', 'biz', 'info', 'tv', 'name',
  'bel', 'av', 'dr', 'edu', 'gov', 'k12', 'pol', 'tsk', 'bbs', 'tel', 'kep'];

/** Kayıtlı alan adı: www.ornek.com.tr → ornek.com.tr, a.b.ornek.com → ornek.com */
function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const take = tld === 'tr' && TR_SECOND_LEVEL.indexOf(sld) !== -1 ? 3 : 2;
  return parts.length >= take ? parts.slice(-take).join('.') : null;
}

/**
 * @returns {Promise<{ok: boolean, enabled?: boolean, zone?: string, reason?: string}>}
 */
async function dnssecDurumu(host, fetcher) {
  const zone = registrableDomain(host);
  if (!zone) return { ok: false, reason: 'not_measured' };
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  try {
    const res = await (fetcher || fetch)(DOH_URL + '?name=' + encodeURIComponent(zone) + '&type=DS', {
      headers: { 'Accept': 'application/dns-json' }, signal: controller.signal
    });
    if (!res.ok) return { ok: false, reason: 'not_measured' };
    const j = await res.json();
    /* Status 0 = NOERROR, 3 = NXDOMAIN; diğerleri (SERVFAIL vb.) ölçüm hatası. */
    if (!j || (j.Status !== 0 && j.Status !== 3)) return { ok: false, reason: 'not_measured' };
    const ds = (j.Answer || []).some(function (a) { return a && a.type === DS_TYPE; });
    return { ok: true, enabled: ds, zone: zone };
  } catch (err) {
    return { ok: false, reason: 'not_measured' };
  } finally {
    clearTimeout(timer);
  }
}

/** E-posta güvenlik skoru (0–100) ya da ölçülebilen parça yoksa null. */
function emailScore(checks) {
  let total = 0, got = 0;
  const parts = {};
  (checks || []).forEach(function (c) {
    const w = EMAIL_WEIGHTS[c.id];
    if (!w || (c.status !== 'pass' && c.status !== 'fail')) return;
    total += w;
    if (c.status === 'pass') got += w;
    parts[c.id] = c.status;
  });
  return total ? { score: Math.round(got / total * 100), parts: parts } : null;
}

module.exports = { dnssecDurumu, emailScore, registrableDomain, EMAIL_WEIGHTS };
