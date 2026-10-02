'use strict';

/**
 * Supabase PostgREST — servis rolüyle, yalnızca bu Lambda'nın ihtiyacı kadar.
 *
 * `api/_lib/db.js` ile AYNI erişim modeli: RLS açık, yazma politikası yok,
 * yazan tek şey servis rolü. Lambda da bir sunucu; tarayıcı değil.
 *
 * SERVICE ROLE ANAHTARI LOGLANMAZ. Hata yollarında yalnızca durum kodu
 * yazılıyor; yanıt gövdesi yazılmıyor çünkü PostgREST hata gövdesi sorguyu
 * (ve dolayısıyla süzgeç değerlerini) yansıtabiliyor.
 */

const TIMEOUT_MS = 8000;

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key: key } : null;
}

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
    if (console && console.error) console.error('supabase error', response.status);
    throw new Error('db_error_' + response.status);
  }
  if (response.status === 204) return null;
  return response.json().catch(function () { return null; });
}

/** İşin durumunu ilerletir. Dönen satır, iş gerçekten varsa gelir. */
async function patchJob(jobId, patch) {
  const rows = await request('scan_jobs?id=eq.' + encodeURIComponent(jobId), {
    method: 'PATCH', body: patch, headers: { 'Prefer': 'return=representation' }
  });
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Bulguları yazar. Önce o işin ESKİ bulguları silinir: SQS aynı mesajı
 * tekrar teslim edebiliyor ve ikinci denemede bulgular ikiye katlanırdı.
 */
async function replaceFindings(jobId, findings) {
  await request('scan_findings?job_id=eq.' + encodeURIComponent(jobId), {
    method: 'DELETE', headers: { 'Prefer': 'return=minimal' }
  });
  if (!findings || !findings.length) return;
  const payload = findings.map(function (f) {
    return {
      job_id: jobId,
      owasp_category: f.owasp_category,
      severity: f.severity,
      title: String(f.title || '').slice(0, 300),
      description: String(f.description || '').slice(0, 2000),
      evidence: String(f.evidence || '').slice(0, 500),
      fix_code: String(f.fix_code || '').slice(0, 4000)
    };
  });
  await request('scan_findings', {
    method: 'POST', body: payload, headers: { 'Prefer': 'return=minimal' }
  });
}

module.exports = { request, patchJob, replaceFindings, isConfigured: function () { return config() !== null; } };
