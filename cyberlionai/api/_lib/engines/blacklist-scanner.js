'use strict';

/**
 * Kara liste motoru: alan adı (ya da üst alanı) URLhaus host listesinde mi.
 *
 * Kaynak: abuse.ch URLhaus host listesi (CC0; ticari kullanım serbest).
 * Liste koşu başına en çok bir kez indirilir ve işlev örneğinde 30 dk
 * önbelleklenir. İndirme düşerse kontrol 'skipped' (yok sayılmaz).
 *
 * Ağırlık 'info' (0): ana skor web yapılandırmasını ölçüyor; kara listede
 * olmak ayrı ve ciddi bir sinyal, rapor ve izleme uyarısında öne çıkıyor.
 *
 * @returns {{ checks, findings, fixCode }}
 */

const { check } = require('./common.js');

const URL_HOSTFILE = 'https://urlhaus.abuse.ch/downloads/hostfile/';
const MAX_BYTES = 4 * 1024 * 1024;
const CACHE_MS = 30 * 60 * 1000;
const UA = 'CyberLionAI-Scanner/1.3 (+https://www.cyberlionai.com/pages/tarama-yetkisi)';

let cache = null; // { at, set }

/** "127.0.0.1<TAB>host" satırlarını kümeye çevirir. */
function parseHostfile(text) {
  const set = new Set();
  String(text || '').split('\n').forEach(function (line) {
    const l = line.trim();
    if (!l || l[0] === '#') return;
    const parts = l.split(/\s+/);
    const host = (parts[1] || parts[0] || '').toLowerCase();
    if (host && host !== 'localhost') set.add(host);
  });
  return set;
}

/** Alan adı ya da üst alanlarından biri listede mi; eşleşen adı döner. */
function blacklistedHost(domain, set) {
  if (!set || !set.size) return null;
  const parts = String(domain).toLowerCase().split('.');
  for (let i = 0; i <= parts.length - 2; i++) {
    const cand = parts.slice(i).join('.');
    if (set.has(cand)) return cand;
  }
  return null;
}

/** Listeyi indirir (önbellekli). Düşerse null. */
async function loadBlacklist(fetcher) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.set;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 8000);
  try {
    const res = await (fetcher || fetch)(URL_HOSTFILE, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) return null;
    let text = await res.text();
    if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES);
    cache = { at: Date.now(), set: parseHostfile(text) };
    return cache.set;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * context.blacklist: Set (indirildi) | null (indirilemedi) | undefined (hiç
 * sorulmadı — kontrol eklenmez; kalibrasyon sınaması bu yoldan geçer).
 */
function analyze(context) {
  const checks = [];
  if (context.blacklist !== undefined) {
    const host = context.finalUrl && context.finalUrl.hostname;
    if (context.blacklist === null || !host) {
      checks.push(check('blacklist', 'info', 'skipped', null, { note: 'not_measured' }));
    } else {
      const hit = blacklistedHost(host, context.blacklist);
      checks.push(check('blacklist', 'info', hit ? 'fail' : 'pass', hit ? 'URLhaus: ' + hit : 'URLhaus'));
    }
  }
  return { checks: checks, findings: [], fixCode: {} };
}

function _resetCache() { cache = null; }

module.exports = { analyze, loadBlacklist, parseHostfile, blacklistedHost, IDS: ['blacklist'], _resetCache };
