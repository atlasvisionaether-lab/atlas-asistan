'use strict';

/**
 * Telegram bildirim deposu — kuyruk, ayarlar ve sayaçlar.
 *
 * db.js ile aynı erişim modeli: yalnızca sunucu, yalnızca servis rolü.
 * Tarayıcı bu tablolara hiç dokunmaz ve RLS zaten `anon` için kapalı.
 */

const db = require('./db.js');

const AYARLAR = 'cl_telegram_settings';
const KUYRUK = 'cl_telegram_queue';
const SAYAC = 'cl_activity_counters';

/** Kişisel veri taşıyan bildirim türleri — varsayılan kapalı olanlar. */
const KISISEL = ['visitors', 'scans', 'auth', 'assistant', 'downloads'];

/** Ayarları okur. Tablo yoksa ya da okunamıyorsa HER ŞEY KAPALI kabul edilir. */
async function readSettings() {
  try {
    const rows = await db.rawSelect(AYARLAR, 'id=eq.1&select=*&limit=1');
    if (rows && rows[0]) return rows[0];
  } catch (err) { /* yapilandirilmamis ya da erisilemiyor */ }
  /* Guvenli varsayilan: acik olmayan her sey kapali. Bir arizada bildirimlerin
     KENDILIGINDEN acilmasi, kisisel veri akmasi demek olurdu. */
  return { enabled: false, batch_seconds: 300, retention_days: 7 };
}

/** Bir bildirim türü şu an açık mı? Filtreler de burada uygulanır. */
function allowed(settings, kind, ctx) {
  if (!settings || !settings.enabled) return false;
  const anahtar = 'notify_' + kind;
  if (settings[anahtar] !== true) return false;

  if (settings.only_critical && (!ctx || ctx.severity !== 'critical')) return false;
  if (settings.only_country && ctx && ctx.country && ctx.country !== settings.only_country) return false;
  if (settings.only_registered && !(ctx && ctx.registered)) return false;
  if (settings.only_paying && !(ctx && ctx.paying)) return false;
  return true;
}

/** Kuyruğa yazar. Hata FIRLATMAZ — bildirim asıl işi bozmamalı. */
async function enqueue(row) {
  try {
    await db.rawInsert(KUYRUK, [{
      kind: row.kind,
      severity: row.severity || 'info',
      body: String(row.body).slice(0, 4096),
      batch_key: row.batchKey || null,
      expires_at: new Date(Date.now() + (row.retentionDays || 7) * 86400000).toISOString()
    }]);
    return true;
  } catch (err) {
    if (console && console.error) console.error('telegram enqueue failed:', err.message);
    return false;
  }
}

/** Gün + tür + ülke sayacını artırır. Bireysel iz bırakmaz. */
async function bump(kind, country) {
  try {
    const gun = new Date().toISOString().slice(0, 10);
    await db.rawRpc('cl_bump_activity', { p_day: gun, p_kind: kind, p_country: country || null });
    return true;
  } catch (err) {
    return false;
  }
}

/** Bekleyen bildirimleri okur (gönderim akışı için). */
async function pending(limit) {
  return db.rawSelect(KUYRUK,
    'status=eq.pending&order=created_at.asc&limit=' + (limit || 20) + '&select=*');
}

async function markSent(ids) {
  if (!ids.length) return;
  return db.rawPatch(KUYRUK, 'id=in.(' + ids.join(',') + ')',
    { status: 'sent', sent_at: new Date().toISOString() });
}

async function markFailed(id, hata) {
  return db.rawPatch(KUYRUK, 'id=eq.' + id,
    { status: 'failed', last_error: String(hata).slice(0, 200) });
}

/** Süresi geçen kuyruk kayıtlarını siler. */
async function purgeExpired() {
  return db.rawDelete(KUYRUK, 'expires_at=lt.' + new Date().toISOString());
}

/** /stats, /today, /week için sayaç toplamları. */
async function counters(sinceDays) {
  const d = new Date(Date.now() - (sinceDays || 1) * 86400000).toISOString().slice(0, 10);
  return db.rawSelect(SAYAC, 'day=gte.' + d + '&select=day,kind,country,count&order=day.desc');
}

module.exports = {
  readSettings, allowed, enqueue, bump, pending, markSent, markFailed,
  purgeExpired, counters, KISISEL, AYARLAR, KUYRUK, SAYAC
};
