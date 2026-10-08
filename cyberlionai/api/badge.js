'use strict';

/**
 * Canlı güven rozeti:  /badge/<alan>.svg  →  GET /api/badge?domain=<alan>
 *
 * NE GÖSTERİR: son tamamlanmış taramanın GERÇEK skoru ve tarihi
 * ("Cyber Lion AI | 92/100 · 04.10.2026"). "%100 güvenli" gibi bir iddia YOK:
 * bir güvenlik ürününün böyle bir şey söylemesi yanıltıcı olurdu. Skor 80'in
 * altındaysa rozet gri.
 *
 * KİME: alan adı bir hesapta DOĞRULANMIŞ ve o hesabın etkin Pro/Enterprise
 * aboneliği varsa. Aksi hâlde nötr "doğrulanmadı" rozeti: kimse sahibi
 * olmadığı bir sitenin skorunu kendi sayfasında rozet olarak gösteremesin.
 *
 * Önbellek 1 saat (vercel.json'daki .svg kuralı /badge için hariç tutuldu;
 * yoksa rozet bir yıl boyunca donardı).
 */

const db = require('./_lib/db.js');
const ownership = require('./_lib/ownership.js');

const GOOD = 80;

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Basit metin genişliği tahmini (11px Verdana benzeri). */
function width(text) { return Math.round(String(text).length * 6.6 + 14); }

function svg(left, right, color, title) {
  const lw = width(left), rw = width(right), w = lw + rw;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="22" role="img" aria-label="' + esc(title) + '">'
    + '<title>' + esc(title) + '</title>'
    + '<rect width="' + w + '" height="22" rx="4" fill="#0a0a0f"/>'
    + '<rect x="' + lw + '" width="' + rw + '" height="22" rx="4" fill="' + color + '"/>'
    + '<rect x="' + lw + '" width="6" height="22" fill="' + color + '"/>'
    + '<g font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">'
    + '<text x="' + (lw / 2) + '" y="15" fill="#d4af37">' + esc(left) + '</text>'
    + '<text x="' + (lw + rw / 2) + '" y="15" fill="#0a0a0f">' + esc(right) + '</text>'
    + '</g></svg>';
}

function trDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
}

/** Rozet verisi: { score, date } ya da null (doğrulanmamış / ücretsiz / tarama yok). */
async function badgeData(domain) {
  const owners = await db.request('verified_domains?domain=in.(' + ownership.selfAndParents(domain).map(encodeURIComponent).join(',') + ')'
    + '&status=eq.verified&select=user_id,domain,method&limit=20');
  const uygun = (Array.isArray(owners) ? owners : []).filter(function (r) {
    return r.domain === domain || r.method === 'dns';
  }).map(function (r) { return r.user_id; });
  if (!uygun.length) return null;

  const subs = await db.request('cl_subscriptions?active=is.true&plan=in.(pro,enterprise)'
    + '&user_id=in.(' + uygun.map(encodeURIComponent).join(',') + ')&select=user_id&limit=20');
  const paid = (Array.isArray(subs) ? subs : []).map(function (r) { return r.user_id; });
  if (!paid.length) return null;

  const jobs = await db.request('scan_jobs?domain=eq.' + encodeURIComponent(domain)
    + '&user_id=in.(' + paid.map(encodeURIComponent).join(',') + ')'
    + '&status=eq.completed&score=not.is.null&select=score,completed_at,created_at&order=created_at.desc&limit=1');
  const j = Array.isArray(jobs) && jobs[0];
  return j ? { score: j.score, date: j.completed_at || j.created_at } : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  const raw = String((req.query && req.query.domain) || '').replace(/\.svg$/i, '');
  const domain = ownership.normalizeDomain(raw);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  let data = null;
  if (domain && db.isConfigured()) {
    try { data = await badgeData(domain); } catch (err) {
      if (console && console.error) console.error('badge read failed:', err.message);
      /* Hata durumunda kısa önbellek: geçici arıza bir saat donmasın. */
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
  if (!data) {
    return res.status(200).send(svg('Cyber Lion AI', 'doğrulanmadı', '#a0a0b0',
      'Cyber Lion AI: bu alan adı için doğrulanmış güvenlik skoru yok'));
  }
  const color = data.score >= GOOD ? '#d4af37' : '#a0a0b0';
  const right = data.score + '/100 · ' + trDate(data.date);
  return res.status(200).send(svg('Cyber Lion AI', right, color,
    'Cyber Lion AI güvenlik skoru: ' + data.score + '/100, son tarama ' + trDate(data.date)));
};

module.exports.svg = svg;
module.exports.badgeData = badgeData;
