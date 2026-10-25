'use strict';

/**
 * atlas_orders tablosu (Atlas Supabase'i; bkz. supabase/migrations/0016_atlas_orders.sql).
 *
 * İstemci cyberlionai'nin PostgREST sarmalayıcısı (db.request): aynı zaman
 * aşımı ve hata biçimi; hangi Supabase'e gittiğini bu projenin SUPABASE_URL'i
 * belirler (atlasasistan-static env'i — CyberLion'unki değil).
 *
 * iyzico form jetonu düz TUTULMAZ: SHA-256 özeti. Dönüşte gelen jetonun
 * özetiyle sipariş bulunur; tablo sızsa bile jetonla iyzico'ya sorgu atılamaz.
 * Fatura bilgileri (billing jsonb) LOGLANMAZ.
 */

const crypto = require('node:crypto');
const db = require('../../cyberlionai/api/_lib/db.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** Doğrulanmış formdan 'pending' sipariş açar (panel kurumuna bağlı); satırı döndürür. */
async function create(value, plan, lang, organizationId) {
  const rows = await db.request('atlas_orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      plan: plan.id,
      kind: plan.kind,
      amount_try: plan.amountTry,
      status: 'pending',
      name: value.name,
      clinic: value.clinic,
      email: value.email,
      phone_e164: value.phoneE164,
      country: value.country,
      address: value.address,
      city: value.city,
      billing: value.billing,
      consent_ppf: value.consentPpf,
      consent_transfer: value.consentTransfer,
      lang: lang === 'en' ? 'en' : 'tr',
      organization_id: organizationId || null
    }
  });
  return Array.isArray(rows) ? rows[0] : null;
}

function patch(filter, fields) {
  return db.request('atlas_orders?' + filter, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: fields
  });
}

function attachToken(id, token) {
  return patch('id=eq.' + encodeURIComponent(id), { iyzico_token_hash: tokenHash(token) });
}

async function byToken(token) {
  const rows = await db.request('atlas_orders?iyzico_token_hash=eq.' + tokenHash(token) + '&limit=1');
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Yalnızca hâlâ 'pending' olan siparişi günceller. Aynı dönüş iki kez
 * gelirse ikinci sefer boş döner: bildirim bir kez gider.
 */
async function settle(id, status, fields) {
  if (!UUID_RE.test(String(id))) return null;
  const rows = await patch('id=eq.' + id + '&status=eq.pending',
    Object.assign({ status: status, updated_at: new Date().toISOString() }, fields || {}));
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/** Webhook: aboneliğin iyzico'daki güncel durumu. */
function setSubscriptionStatus(ref, subStatus) {
  return patch('iyzico_ref=eq.' + encodeURIComponent(ref),
    { sub_status: subStatus, updated_at: new Date().toISOString() });
}

module.exports = { create, attachToken, byToken, settle, setSubscriptionStatus, tokenHash, isConfigured: db.isConfigured };
