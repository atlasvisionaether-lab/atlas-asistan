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


/* ============================================================
   OWASP LITE: scan_jobs + scan_findings kaydı (servis rolü).
   Yazma yalnızca buradan; anon/authenticated INSERT policy yok.
   ============================================================ */
async function saveOwaspJob(result, owner, versions, consent) {
  const row = {
    user_id: owner.userId || null,
    domain: result.host,
    url: result.url,
    status: 'completed',
    result: {
      score: result.score,
      summary: result.summary,
      owaspFailedCategories: result.owaspFailedCategories || {},
      activeChecksConsent: consent === true
    },
    score: typeof result.score === 'number' ? result.score : null,
    scanner_mode: consent === true ? 'active' : 'passive',
    consent_ip: consent === true ? (owner.ip || null) : null,
    consent_at: consent === true ? new Date().toISOString() : null,
    country: result.country
  };
  const rows = await request('scan_jobs', {
    method: 'POST',
    body: row,
    headers: { 'Prefer': 'return=representation' }
  });
  const jobId = rows && rows[0] ? rows[0].id : null;

  const findings = result.owaspFindings || [];
  if (jobId && findings.length) {
    const payload = findings.map(function (f) {
      return {
        job_id: jobId,
        owasp_category: f.owasp_category,
        severity: f.severity,
        title: f.title.slice(0, 300),
        description: (f.description || '').slice(0, 2000),
        evidence: (f.evidence || '').slice(0, 500),
        fix_code: (f.fix_code || '').slice(0, 4000)
      };
    });
    await request('scan_findings', {
      method: 'POST',
      body: payload,
      headers: { 'Prefer': 'return=minimal' }
    });
  }
  return jobId;
}


/* ============================================================
   Cloudflare 1-Tık Düzeltme denetim izi (token'sız).
   Yazma yalnızca servis rolü; anon policy yok.
   ============================================================ */
async function saveAutofixJob(domain, fixType, ruleId) {
  const row = {
    domain: domain,
    url: 'cloudflare-transform://' + domain + '/' + fixType,
    status: 'completed',
    result: { autofix: true, fixType: fixType, ruleId: ruleId || null },
    score: null,
    scanner_mode: 'passive',
    completed_at: new Date().toISOString()
  };
  const rows = await request('scan_jobs', {
    method: 'POST',
    body: row,
    headers: { 'Prefer': 'return=representation' }
  });
  return rows && rows[0] ? rows[0].id : null;
}

async function saveAutofixFinding(jobId, domain, fixType, ruleId) {
  const row = {
    job_id: jobId,
    owasp_category: 'A05',
    severity: 'info',
    title: 'Auto-Fix Applied via Cloudflare',
    description: '1-click fix applied: ' + fixType.toUpperCase()
      + ' header set via Cloudflare Transform Rule (user-provided token)',
    evidence: 'zone=' + domain + '; ruleId=' + (ruleId || 'n/a')
      + '; fixedAt=' + new Date().toISOString(),
    fix_code: null
  };
  const rows = await request('scan_findings', {
    method: 'POST',
    body: row,
    headers: { 'Prefer': 'return=representation' }
  });
  return rows && rows[0] ? rows[0].id : null;
}

/* ============================================================
   Ana sayfadaki SAYAÇ için toplamlar.

   SAHİPSİZ ve KİMLİKSİZ: yalnızca kaç tarama yapıldığı, kaç ayrı alan adı
   tarandığı, ortalama skor ve son yedi günün günlük dağılımı. Alan adının
   KENDİSİ dışarı çıkmıyor (yalnızca benzersiz sayısı için sayılıyor) ve
   kullanıcı/oturum bilgisi bu yanıtta yok.

   Neden SQL tarafında COUNT/AVG değil: `countryCounts` ile aynı sebep —
   PostgREST'in toplama desteği sürüme bağlı ve bu depoda "sürüm tahmin etme"
   kuralı var. Gereken sütunlar ÜST SINIRA kadar çekilip burada sayılıyor.
   Sınıra dayanıldığında bu SAKLANMIYOR: `truncated` ile dışarı bildiriliyor
   ve o noktada doğrusu bir veritabanı görünümü/RPC'ye geçmektir.

   `cloudflare-transform://` ile başlayan satırlar bir TARAMA DEĞİL: Cloudflare
   1-Tık Düzeltme'nin denetim izi aynı tabloya yazılıyor (bkz. saveAutofixJob).
   Sayaca katılsalardı "taranan site" sayısı düzeltme sayısıyla şişerdi.
   Ayıklama burada, JS tarafında yapılıyor — PostgREST'in `like` kalıbında
   `://` kaçışını tahmin etmek yerine. */
const STATS_LIMIT = 10000;
const AUTOFIX_URL_PREFIX = 'cloudflare-transform://';
const TREND_DAYS = 7;

function utcDay(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function scanStats() {
  const query = 'scan_jobs'
    + '?select=domain,score,status,url,created_at'
    + '&order=created_at.desc'
    + '&limit=' + (STATS_LIMIT + 1);

  const rows = await request(query, {});
  const list = Array.isArray(rows) ? rows : [];
  const truncated = list.length > STATS_LIMIT;
  const sayilan = truncated ? list.slice(0, STATS_LIMIT) : list;

  /* Son yedi günün iskeleti ÖNCE kuruluyor: tarama olmayan gün listeden
     düşerse grafik günleri kaydırır ve boş günü yoğun günün yanına koyar. */
  const gunler = new Map();
  const bugun = new Date();
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(bugun.getTime() - i * 86400000);
    gunler.set(d.toISOString().slice(0, 10), 0);
  }

  const alanAdlari = new Set();
  let taramaSayisi = 0;
  let skorToplami = 0;
  let skorAdedi = 0;

  sayilan.forEach(function (r) {
    if (!r || typeof r.url !== 'string') return;
    if (r.url.indexOf(AUTOFIX_URL_PREFIX) === 0) return;
    if (r.status !== 'completed') return;

    taramaSayisi += 1;
    if (typeof r.domain === 'string' && r.domain) alanAdlari.add(r.domain.toLowerCase());
    if (typeof r.score === 'number') { skorToplami += r.score; skorAdedi += 1; }

    const gun = utcDay(r.created_at);
    if (gun !== null && gunler.has(gun)) gunler.set(gun, gunler.get(gun) + 1);
  });

  return {
    totalScans: taramaSayisi,
    uniqueDomains: alanAdlari.size,
    /* Ortalama yalnızca skoru OLAN taramalardan; başarısız tarama skoru
       null bırakır ve sıfır sayılması ortalamayı yanlış aşağı çeker. */
    averageScore: skorAdedi > 0 ? Math.round(skorToplami / skorAdedi) : null,
    scoredScans: skorAdedi,
    last7Days: Array.from(gunler.entries()).map(function (p) {
      return { date: p[0], count: p[1] };
    }),
    truncated: truncated
  };
}

/* ============================================================
   PANEL: hesabın kendi scan_jobs kayıtları ve bulguları.

   Sahiplik filtresi SORGUNUN İÇİNDE (`user_id=eq.…`), tıpkı `ownerFilter`
   kullanan uçlarda olduğu gibi: başka bir kullanıcının iş kimliğini bilmek
   işe yaramaz. Tarayıcı veritabanına hiç bağlanmıyor; panel bu sunucu
   uçlarından okuyor. Tablodaki RLS bunun ikinci katmanı, tek katmanı değil.
   ============================================================ */
const PANEL_MAX_LIMIT = 50;

function jobOwnerFilter(userId) {
  return 'user_id=eq.' + encodeURIComponent(userId);
}

/** Bir satır gerçekten tarama mı, yoksa düzeltme denetim izi mi? */
function isScanRow(row) {
  return !!row && typeof row.url === 'string' && row.url.indexOf(AUTOFIX_URL_PREFIX) !== 0;
}

/**
 * Hesabın taramaları, yeniden eskiye.
 *
 * `status` verilirse ona göre süzülür ('completed' | 'failed' | …). Düzeltme
 * denetim satırları listede GÖRÜNMEZ: panel "taramalarım" diyor ve bir
 * Cloudflare düzeltmesi tarama değil.
 */
async function listJobs(userId, options) {
  const opts = options || {};
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 20, 1), PANEL_MAX_LIMIT);
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0);

  let query = 'scan_jobs'
    + '?' + jobOwnerFilter(userId)
    + '&select=id,domain,url,status,score,scanner_mode,country,created_at,completed_at'
    + '&order=created_at.desc'
    /* Bir fazlası isteniyor: sonraki sayfa var mı sorusunu ayrı bir sayım
       turu yapmadan cevaplamak için (history.js ile aynı desen). */
    + '&limit=' + (limit + 1) + '&offset=' + offset;

  if (typeof opts.status === 'string' && /^[a-z]{1,16}$/.test(opts.status)) {
    query += '&status=eq.' + opts.status;
  }

  const rows = await request(query, {});
  const list = (Array.isArray(rows) ? rows : []).filter(isScanRow);
  const hasMore = list.length > limit;

  return {
    items: (hasMore ? list.slice(0, limit) : list).map(function (r) {
      return {
        id: r.id, domain: r.domain, status: r.status, score: r.score,
        scannerMode: r.scanner_mode, country: r.country,
        createdAt: r.created_at, completedAt: r.completed_at
      };
    }),
    limit: limit,
    offset: offset,
    hasMore: hasMore
  };
}

/**
 * Skor eğilimi: hesabın skoru olan taramaları, ESKİDEN YENİYE.
 *
 * Grafiğin x ekseni gün değil TARAMA: bir hesabın taramaları günlere seyrek
 * dağılıyor ve günlük ortalama, tek taramalı bir günü yoğun bir günle aynı
 * ağırlıkta gösterirdi. Nokta başına tarih veriliyor, arayüz etiketi ondan
 * yazıyor.
 */
async function jobScoreTrend(userId, limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 200);
  const query = 'scan_jobs'
    + '?' + jobOwnerFilter(userId)
    + '&status=eq.completed'
    + '&score=not.is.null'
    + '&select=id,domain,score,created_at,url'
    + '&order=created_at.desc'
    + '&limit=' + n;

  const rows = await request(query, {});
  return (Array.isArray(rows) ? rows : [])
    .filter(isScanRow)
    .map(function (r) {
      return { id: r.id, domain: r.domain, score: r.score, createdAt: r.created_at };
    })
    .reverse();
}

/** Tek iş — sahiplik filtresi sorgunun içinde. */
async function getJob(userId, jobId) {
  if (!UUID_RE.test(String(jobId || ''))) return null;
  const rows = await request('scan_jobs'
    + '?' + jobOwnerFilter(userId)
    + '&id=eq.' + encodeURIComponent(jobId)
    + '&select=*&limit=1');
  const row = rows && rows[0] ? rows[0] : null;
  return isScanRow(row) ? row : null;
}

/**
 * Bir işin bulguları, OWASP kategorisine göre gruplanmış.
 *
 * ÖNCE iş sahiplik filtresiyle okunuyor, bulgular ANCAK sonra: `job_id`
 * üzerinden doğrudan sorgulamak, başkasının iş kimliğini bilen birine o işin
 * bulgularını verirdi. `scan_findings` tablosunda sahip sütunu yok, sahiplik
 * yalnızca iş üzerinden kurulabiliyor.
 *
 * Dönüş null ise iş yok ya da bu hesaba ait değil — ikisi arayüze AYNI
 * görünüyor (404), çünkü ayırmak "bu kimlik var ama sizin değil" demek olurdu.
 */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

async function getJobWithFindings(userId, jobId) {
  const job = await getJob(userId, jobId);
  if (!job) return null;

  const rows = await request('scan_findings'
    + '?job_id=eq.' + encodeURIComponent(job.id)
    + '&select=id,owasp_category,severity,title,description,evidence,fix_code,created_at'
    + '&order=created_at.asc'
    + '&limit=500');

  const findings = Array.isArray(rows) ? rows : [];

  /* Kategorisiz bulgu DÜŞÜRÜLMÜYOR: 'A00' gibi uydurma bir kategoriye de
     atanmıyor, ayrı bir 'other' grubunda duruyor. Raporda görünmeyen bulgu,
     olmayan bulgudan daha kötüdür. */
  const gruplar = new Map();
  findings.forEach(function (f) {
    const key = /^A(0[1-9]|10)$/.test(String(f.owasp_category || '')) ? f.owasp_category : 'other';
    if (!gruplar.has(key)) gruplar.set(key, []);
    gruplar.get(key).push({
      id: f.id,
      owaspCategory: f.owasp_category || null,
      severity: f.severity,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      fixCode: f.fix_code
    });
  });

  const siraliGruplar = Array.from(gruplar.entries())
    /* 'other' her zaman sonda; kalanlar A01..A10 sırasında. */
    .sort(function (a, b) {
      if (a[0] === 'other') return 1;
      if (b[0] === 'other') return -1;
      return a[0] < b[0] ? -1 : 1;
    })
    .map(function (p) {
      return {
        category: p[0],
        findings: p[1].sort(function (x, y) {
          return SEVERITY_ORDER.indexOf(x.severity) - SEVERITY_ORDER.indexOf(y.severity);
        })
      };
    });

  const sayac = {};
  SEVERITY_ORDER.forEach(function (s) { sayac[s] = 0; });
  findings.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(sayac, f.severity)) sayac[f.severity] += 1;
  });

  return {
    job: {
      id: job.id, domain: job.domain, url: job.url, status: job.status,
      score: job.score, scannerMode: job.scanner_mode, country: job.country,
      createdAt: job.created_at, completedAt: job.completed_at,
      result: job.result || null
    },
    severityCounts: sayac,
    totalFindings: findings.length,
    groups: siraliGruplar
  };
}

/* ============================================================
   Asenkron tarama kuyruğu (SQS + Lambda).

   Satır BURADA açılır, iş SQS'e bırakılır, Lambda aynı satırı ilerletir.
   Kimliği sunucu üretir; istemci "şu kimlikle iş aç" diyemez, yoksa
   başkasının iş kimliğini seçip satırını ezebilirdi.

   SAHİPLİK: giriş yapılmışsa `user_id`, değilse `session_id`. Anonim
   taramanın da bir sahibi olmak zorunda, çünkü sonucu SONRADAN soruluyor;
   sahip sütunu olmasa iş kimliğini bilen herkes sonucu okuyabilirdi.
   ============================================================ */

/** Kuyruğa bırakılmak üzere 'pending' bir iş satırı açar, kimliğini döner. */
async function createPendingJob(input, owner, consent) {
  const row = {
    user_id: owner.userId || null,
    session_id: owner.userId ? null : (owner.sessionId || null),
    domain: input.host,
    url: input.url,
    status: 'pending',
    scanner_mode: consent === true ? 'active' : 'passive',
    consent_ip: consent === true ? (owner.ip || null) : null,
    consent_at: consent === true ? new Date().toISOString() : null
  };
  const rows = await request('scan_jobs', {
    method: 'POST', body: row, headers: { 'Prefer': 'return=representation' }
  });
  return rows && rows[0] ? rows[0].id : null;
}

/** Mesaj SQS'e gittikten sonra. 'pending' kalan iş = kuyruğa hiç düşmemiş iş. */
async function markJobQueued(jobId) {
  if (!UUID_RE.test(String(jobId || ''))) return null;
  const rows = await request('scan_jobs?id=eq.' + encodeURIComponent(jobId), {
    method: 'PATCH',
    body: { status: 'queued', queued_at: new Date().toISOString() },
    headers: { 'Prefer': 'return=representation' }
  });
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Kuyruğa bırakılamayan işi kapatır. Kod şemanın kabul ettiği kısa biçime
 * indirilir; serbest metin yazılmaz (istemciye çevrilmek üzere döner).
 */
async function markJobFailed(jobId, code) {
  if (!UUID_RE.test(String(jobId || ''))) return null;
  const kod = String(code || 'scan_failed').toLowerCase()
    .replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'scan_failed';
  const rows = await request('scan_jobs?id=eq.' + encodeURIComponent(jobId), {
    method: 'PATCH',
    body: { status: 'failed', error_code: kod, completed_at: new Date().toISOString() },
    headers: { 'Prefer': 'return=representation' }
  });
  return rows && rows[0] ? rows[0] : null;
}

/** Kuyruk işleri için sahiplik süzgeci: hesap varsa hesap, yoksa oturum. */
function queueOwnerFilter(owner) {
  return owner.userId
    ? 'user_id=eq.' + encodeURIComponent(owner.userId)
    : 'session_id=eq.' + encodeURIComponent(owner.sessionId);
}

/**
 * İstemcinin yokladığı durum kaydı.
 *
 * Sahiplik filtresi SORGUNUN İÇİNDE: başka bir oturumun iş kimliğini bilmek
 * işe yaramaz. İş yok ile "sizin değil" arayüze AYNI görünür (null), çünkü
 * ayırmak "bu kimlik var ama sizin değil" demek olurdu.
 *
 * `result` bütünüyle dönmüyor; yalnızca istemcinin çizdiği alanlar. Ham
 * başlık değerleri geçmiş listesinde de tutulmuyor (bkz. sanitizeFindings).
 */
async function getJobStatus(owner, jobId) {
  if (!UUID_RE.test(String(jobId || ''))) return null;
  const rows = await request('scan_jobs'
    + '?' + queueOwnerFilter(owner)
    + '&id=eq.' + encodeURIComponent(jobId)
    + '&select=id,domain,url,status,score,error_code,scanner_mode,country,'
    + 'result,created_at,queued_at,completed_at,attempts&limit=1');
  const row = rows && rows[0] ? rows[0] : null;
  return isScanRow(row) ? row : null;
}

/* ============================================================
   Haftalık tarama için abonelik kaynağı.

   DİKKAT: `scan_jobs` tablosunda abonelik/plan sütunu YOK ve hiç olmadı.
   Haftalık taramanın kimi tarayacağını söyleyen bir kayıt gerekiyor; bu
   `cl_subscriptions` tablosu onun için (göç dosyası:
   db/2026-10-01-cl-subscriptions.sql). Tablo HENÜZ UYGULANMADIYSA bu
   fonksiyon uydurma bir liste döndürmüyor: `available: false` ve sebep
   dönüyor, çağıran da hiçbir tarama tetiklemiyor. Olmayan müşteriyi
   varsaymak, hiç taramamaktan kötüdür.
   ============================================================ */
async function enterpriseScanTargets(limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const query = 'cl_subscriptions'
    + '?plan=eq.enterprise'
    + '&active=is.true'
    + '&select=user_id,domain'
    + '&order=created_at.asc'
    + '&limit=' + n;

  let rows;
  try {
    rows = await request(query, {});
  } catch (err) {
    /* Tablo yoksa PostgREST 404 veriyor. Bunu "abone yok" diye SESSİZCE
       yutmak, kurulumun eksik olduğunu gizlemek olurdu. */
    if (/db_error_404/.test(err.message)) {
      return { available: false, reason: 'no_subscriptions_table', targets: [] };
    }
    throw err;
  }

  const list = (Array.isArray(rows) ? rows : []).filter(function (r) {
    return r && UUID_RE.test(String(r.user_id || ''))
      && typeof r.domain === 'string' && /^[a-z0-9.-]{1,253}\.[a-z]{2,}$/i.test(r.domain);
  });

  return {
    available: true,
    reason: list.length ? null : 'no_active_subscriptions',
    targets: list.map(function (r) {
      return { userId: r.user_id, domain: r.domain.toLowerCase() };
    })
  };
}

/* ============================================================
   Abonelik okuma ve yazma (iyzico).

   OKUMA panelden geliyor ve her zaman kullanıcı kimliğiyle sınırlı: filtre
   sorgunun İÇİNDE (`user_id=eq.…`). YAZMA yalnızca webhook'tan geliyor ve
   servis rolüyle yapılıyor; tabloda anon/authenticated INSERT ya da UPDATE
   policy'si bilerek yok, yoksa bir kullanıcı kendini Enterprise ilan ederdi.
   ============================================================ */

const SUBS_TABLE = 'cl_subscriptions';
const SUB_SELECT = 'id,domain,plan,active,status,iyzico_env,'
  + 'iyzico_subscription_ref,iyzico_customer_ref,created_at,updated_at';

/** Hesabın kendi abonelikleri. Başkasının satırı bu sorgudan ÇIKAMAZ. */
async function listSubscriptions(userId) {
  if (!UUID_RE.test(String(userId || ''))) return [];
  const rows = await request(SUBS_TABLE
    + '?user_id=eq.' + encodeURIComponent(userId)
    + '&select=' + SUB_SELECT
    + '&order=created_at.desc&limit=50', {});
  return Array.isArray(rows) ? rows : [];
}

/**
 * Webhook'tan gelen abonelik durumunu yazar.
 *
 * Eşleme anahtarı iyzico'nun abonelik referansı: aynı webhook iki kez
 * gelirse (iyzico yeniden deniyor) ikinci çağrı yeni satır açmıyor, mevcut
 * satırı güncelliyor. `user_id` ve `domain` İSTEKTEN GELMİYOR — webhook'un
 * gövdesi bunları taşısa bile güvenilmez; kendi tarafımızdaki müşteri
 * eşlemesinden geliyor (çağıran veriyor).
 */
async function upsertIyzicoSubscription(row) {
  if (!UUID_RE.test(String(row.userId || ''))) throw new Error('subscription_user_invalid');
  if (!row.subscriptionRef) throw new Error('subscription_ref_missing');

  const body = {
    user_id: row.userId,
    /* Alan adı YOKSA null yazılıyor, boş dizge DEĞİL: tabloda
       unique (user_id, domain) var ve boş dizge gerçek bir değer sayılır.
       '' yazılsa aynı hesabın ikinci aboneliği (Pro'dan sonra Enterprise)
       tekillik ihlaliyle reddedilirdi; NULL'lar birbirinden farklı sayılıyor. */
    domain: row.domain ? String(row.domain).toLowerCase() : null,
    plan: row.plan,
    active: row.active === true,
    status: row.status || null,
    iyzico_env: row.env || null,
    iyzico_subscription_ref: String(row.subscriptionRef),
    iyzico_customer_ref: row.customerRef ? String(row.customerRef) : null,
    iyzico_product_ref: row.productRef ? String(row.productRef) : null,
    iyzico_plan_ref: row.planRef ? String(row.planRef) : null,
    updated_at: new Date().toISOString()
  };

  const rows = await request(SUBS_TABLE + '?on_conflict=iyzico_subscription_ref', {
    method: 'POST',
    body: body,
    headers: {
      'Prefer': 'resolution=merge-duplicates,return=representation'
    }
  });
  return rows && rows[0] ? rows[0] : null;
}

/** Abonelik satırını iyzico referansıyla bulur (webhook için). */
async function findSubscriptionByRef(subscriptionRef) {
  if (!subscriptionRef) return null;
  const rows = await request(SUBS_TABLE
    + '?iyzico_subscription_ref=eq.' + encodeURIComponent(subscriptionRef)
    + '&select=' + SUB_SELECT + ',user_id&limit=1', {});
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Var olan abonelik satırının durumunu günceller.
 *
 * Webhook YENİ satır açmıyor: hangi kullanıcıya ait olduğunu söyleyen eşleme
 * yalnızca ödeme dönüşünde (oturumlu istekte) kuruluyor. Eşlemesi olmayan bir
 * referans için satır açmak, aboneliği rastgele bir kullanıcıya yazmak olurdu.
 */
async function updateSubscriptionStatusByRef(subscriptionRef, patch) {
  if (!subscriptionRef) throw new Error('subscription_ref_missing');
  const body = {
    active: patch.active === true,
    status: patch.status || null,
    updated_at: new Date().toISOString()
  };
  const rows = await request(SUBS_TABLE
    + '?iyzico_subscription_ref=eq.' + encodeURIComponent(subscriptionRef), {
    method: 'PATCH',
    body: body,
    headers: { 'Prefer': 'return=representation' }
  });
  return Array.isArray(rows) ? rows.length : 0;
}

module.exports = {

  isConfigured, saveScan, saveOwaspJob, saveAutofixJob, saveAutofixFinding, countryCounts, listScans, getScan, deleteScan, deleteAllScans,
  sanitizeFindings, claimAnonymousScans, scanStats,
  listJobs, jobScoreTrend, getJob, getJobWithFindings, SEVERITY_ORDER,
  enterpriseScanTargets,
  createPendingJob, markJobQueued, markJobFailed, getJobStatus,
  listSubscriptions, upsertIyzicoSubscription,
  findSubscriptionByRef, updateSubscriptionStatusByRef
};
