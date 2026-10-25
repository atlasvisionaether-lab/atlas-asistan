'use strict';

/**
 * Müşteri paneli (ayrı Vercel projesi) ↔ atlasasistan.com ödeme uçları.
 *
 * Panel başka bir origin'de: ödeme ucunu tarayıcıdan CORS ile çağırır ve
 * Supabase oturum jetonunu Authorization: Bearer ile gönderir. Jeton burada
 * Supabase Auth'a (GET /auth/v1/user) sorulur; kullanıcının kurumu users
 * tablosundan servis rolüyle okunur. Sipariş doğrudan o kuruma bağlanır.
 *
 *   ATLAS_PANEL_URL  panelin adresi (CORS izni ve iyzico dönüşünün gideceği yer);
 *                    tanımsızsa önizleme alan adı.
 *
 * Jeton LOGLANMAZ.
 */

const db = require('../../cyberlionai/api/_lib/db.js');

const DEFAULT_PANEL_URL = 'https://atlas-asistan-panel-preview.vercel.app';
const TIMEOUT_MS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Ödeme başlatabilen roller (Abonelik ekranını görenlerle aynı). */
const PAYER_ROLES = ['owner', 'manager'];

function panelUrl() {
  const v = String(process.env.ATLAS_PANEL_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^/]+$/.test(v) ? v : DEFAULT_PANEL_URL;
}

/** Panelin origin'inden gelen isteğe CORS başlıklarını yazar; başka origin'e yazmaz. */
function cors(req, res) {
  const origin = req.headers && req.headers.origin;
  if (origin !== panelUrl()) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function bearerOf(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * Jetondan panel üyesi: { userId, email, orgId, role } | null.
 * Jeton geçersiz/süresi dolmuşsa ya da kullanıcının kurumu yoksa null.
 */
async function memberFromRequest(req) {
  const token = bearerOf(req);
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!token || !url || !key) return null;

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  let user;
  try {
    const r = await fetch(url + '/auth/v1/user', {
      headers: { apikey: key, Authorization: 'Bearer ' + token },
      signal: controller.signal
    });
    if (!r.ok) return null;
    user = await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!user || !UUID_RE.test(String(user.id))) return null;

  const rows = await db.request('users?id=eq.' + user.id + '&select=organization_id,role&limit=1');
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !row.organization_id) return null;
  return { userId: user.id, email: user.email || null, orgId: row.organization_id, role: row.role };
}

function canPay(member) {
  return !!member && PAYER_ROLES.indexOf(member.role) !== -1;
}

/** iyzico dönüşünden sonra panelin Kurulum ekranı; sonuç ?odeme= ile. */
function returnUrl(status) {
  return panelUrl() + '/?odeme=' + encodeURIComponent(status) + '#onboarding';
}

module.exports = { panelUrl, cors, bearerOf, memberFromRequest, canPay, returnUrl };
