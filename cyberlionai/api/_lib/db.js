'use strict';

/**
 * Supabase veri katmanı (PostgREST, servis rolü).
 *
 * Erişim modeli: tarayıcı veritabanına hiç bağlanmaz. Tüm okuma ve yazma bu
 * sunucu ucundan geçer; sahiplik filtresi (oturum kimliği / kullanıcı) burada
 * uygulanır. Tabloda RLS açık ve `anon` rolü için hiçbir politika yok, yani
 * yayınlanan anahtarla tarayıcıdan erişim zaten mümkün değil.
 *
 * Servis rolü anahtarı yalnızca sunucuda bulunur ve istemciye asla gönderilmez.
 *
 * Gerekli ortam değişkenleri:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const TABLE = 'cl_scans';
const TIMEOUT_MS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key: key } : null;
}

function isConfigured() { return config() !== null; }

async function request(pathAndQuery, options) {
  const cfg = config();
  if (!cfg) throw new Error('db_not_configured');

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let response;
  try {
    response = await fetch(cfg.url + '/rest/v1/' + pathAndQuery, {
      method: (options && options.method) || 'GET',
      signal: controller.signal,
      headers: Object.assign({
        'apikey': cfg.key,
        'Authorization': 'Bearer ' + cfg.key,
        'Content-Type': 'application/json'
      }, (options && options.headers) || {}),
      body: options && options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('db_unreachable');
  }
  clearTimeout(timer);

  if (!response.ok) {
    const text = await response.text().catch(function () { return ''; });
    if (console && console.error) console.error('db error', response.status, text.slice(0, 200));
    throw new Error('db_error_' + response.status);
  }

  if (response.status === 204) return null;
  return response.json().catch(function () { return null; });
}

/**
 * Kaydedilecek bulgular sadeleştirilir: ham başlık değerleri (`detail`)
 * bilerek dışarıda bırakılır. Bir CSP veya Set-Cookie başlığı, hedef sitenin
 * iç yapısı hakkında bilgi taşıyabilir; geçmiş listesi için gerekli değil.
 */
function sanitizeFindings(checks) {
  return (checks || []).map(function (c) {
    return { id: c.id, severity: c.severity, status: c.status, note: c.note || null };
  });
}

/** Tarama sonucunu kaydeder ve oluşturulan kaydın kimliğini döndürür. */
async function saveScan(result, owner, versions) {
  const row = {
    user_id: owner.userId || null,
    anonymous_session_id: owner.userId ? null : owner.sessionId,
    host: result.host,
    /* ISO-2 ulke ya da NULL. IP adresi BURAYA YAZILMIYOR ve hicbir yerde
       saklanmiyor; ulke, taramanin zaten yaptigi DNS cozumunden turetilen iki
       harften ibaret. Bicim kisiti veritabaninda da var (006). */
    country: typeof result.country === 'string' && /^[A-Z]{2}$/.test(result.country)
      ? result.country
      : null,
    score: typeof result.score === 'number' ? result.score : null,
    checks_total: result.summary.total,
    checks_passed: result.summary.passed,
    checks_failed: result.summary.failed,
    checks_skipped: result.summary.skipped,
    http_status: result.httpStatus,
    redirects: result.redirects,
    duration_ms: result.durationMs,
    findings: sanitizeFindings(result.checks),
    warnings: result.warnings || [],
    scanner_version: versions.scanner,
    report_version: versions.report
  };

  const rows = await request(TABLE, {
    method: 'POST',
    body: row,
    headers: { 'Prefer': 'return=representation' }
  });
  return rows && rows[0] ? rows[0].id : null;
}

/* Haritadaki "kendi tarama etkinligimiz" katmani icin ulke sayilari.

   SAHIPSIZ ve KIMLIKSIZ bir toplam: hangi kullanicinin neyi taradigi buradan
   cikmiyor, yalnizca ulke basina kac tarama yapildigi. Host da donmuyor.

   Neden SQL tarafinda GROUP BY degil: PostgREST'in toplama (aggregate) destegi
   surume bagli ve bu depoda "surum tahmin etme" kurali var. Ulke sutunu tek
   basina cekilip burada sayiliyor; sayim tam ve dogru, yalnizca UST SINIRA
   kadar. Sinira dayanildiginda bunu SAKLAMIYORUZ: `truncated` ile disari
   bildiriliyor ve o noktada isin dogrusu bir veritabani gorunumu/RPC'ye
   gecmektir. Bugun tabloda avuc ici kadar kayit var. */
const OWN_ACTIVITY_LIMIT = 10000;

async function countryCounts() {
  const query = TABLE
    + '?select=country'
    + '&country=not.is.null'
    + '&limit=' + (OWN_ACTIVITY_LIMIT + 1);

  const rows = await request(query, {});
  const list = Array.isArray(rows) ? rows : [];
  const truncated = list.length > OWN_ACTIVITY_LIMIT;
  const sayilan = truncated ? list.slice(0, OWN_ACTIVITY_LIMIT) : list;

  const sayac = new Map();
  sayilan.forEach(function (r) {
    const cc = r && typeof r.country === 'string' ? r.country : null;
    if (cc && /^[A-Z]{2}$/.test(cc)) sayac.set(cc, (sayac.get(cc) || 0) + 1);
  });

  return {
    total: sayilan.length,
    truncated: truncated,
    countries: Array.from(sayac.entries())
      .map(function (p) { return { country: p[0], count: p[1] }; })
      .sort(function (a, b) { return b.count - a.count; })
  };
}

function ownerFilter(owner) {
  return owner.userId
    ? 'user_id=eq.' + encodeURIComponent(owner.userId)
    : 'anonymous_session_id=eq.' + encodeURIComponent(owner.sessionId);
}

/** Sahibin taramaları, yeniden eskiye, sayfalanmış. */
async function listScans(owner, limit, offset) {
  const query = TABLE
    + '?' + ownerFilter(owner)
    + '&select=id,host,score,checks_total,checks_passed,checks_failed,checks_skipped,scanned_at,duration_ms,scanner_version'
    + '&order=scanned_at.desc'
    + '&limit=' + limit + '&offset=' + offset;
  const rows = await request(query, { headers: { 'Prefer': 'count=exact' } });
  return rows || [];
}

/** Tek kayıt — sahiplik filtresi sorgunun içinde, tahmin edilen kimlik işe yaramaz. */
async function getScan(owner, id) {
  const rows = await request(TABLE + '?' + ownerFilter(owner) + '&id=eq.' + encodeURIComponent(id) + '&select=*&limit=1');
  return rows && rows[0] ? rows[0] : null;
}

async function deleteScan(owner, id) {
  const rows = await request(TABLE + '?' + ownerFilter(owner) + '&id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: { 'Prefer': 'return=representation' }
  });
  return rows ? rows.length : 0;
}

async function deleteAllScans(owner) {
  const rows = await request(TABLE + '?' + ownerFilter(owner), {
    method: 'DELETE',
    headers: { 'Prefer': 'return=representation' }
  });
  return rows ? rows.length : 0;
}

/**
 * Anonim oturumun kayıtlarını hesaba devreder.
 *
 * Tek bir UPDATE ifadesi: PostgreSQL onu kendi içinde atomik uygular, ayrı
 * okuma + yazma turuna gerek yok. Filtre yalnızca `anonymous_session_id`
 * üzerinden kurulur; bu değer çağıran ucun **doğrulanmış çerezinden** gelir,
 * istekten okunan bir gövde alanından değil. Başka bir oturumun kimliğini
 * bilmek işe yaramaz çünkü onu isteğe koyacak bir yol yok.
 *
 * Tekrar çalıştırılabilir: ikinci çağrıda eşleşen satır kalmadığı için 0 döner.
 * Çağıran kota devrini bu sayıya dayandırır, böylece tekrar sayım olmaz.
 *
 * `anonymous_session_id` NULL'a çekilir: tablodaki `cl_scans_single_owner`
 * kısıtı tam olarak bir sahip ister, dolayısıyla kayıt iki sahibe birden
 * bağlı kalamaz.
 *
 * Dönüş: devredilen satır sayısı.
 */
async function claimAnonymousScans(sessionId, userId) {
  if (!/^[0-9a-f]{64}$/.test(String(sessionId || ''))) return 0;
  if (!UUID_RE.test(String(userId || ''))) return 0;

  const rows = await request(
    TABLE + '?anonymous_session_id=eq.' + encodeURIComponent(sessionId) + '&select=id',
    {
      method: 'PATCH',
      body: { user_id: userId, anonymous_session_id: null },
      headers: { 'Prefer': 'return=representation' }
    }
  );
  return rows ? rows.length : 0;
}

module.exports = {

  isConfigured, saveScan, countryCounts, listScans, getScan, deleteScan, deleteAllScans,
  sanitizeFindings, claimAnonymousScans
};
