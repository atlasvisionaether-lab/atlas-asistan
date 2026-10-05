'use strict';

/**
 * Güven Damgası ÖN KONTROLÜ ve KVKK çerez / üçüncü taraf betik analizi.
 *
 * NE DEĞİLDİR: TOBB ETBİS Güven Damgası'nın resmi değerlendirmesi değildir;
 * TOBB ya da ETBİS ile bağlantımız yoktur. Başvurularda sıkça istenen
 * unsurların sitede görünür olup olmadığını otomatik olarak işaretler.
 * Sonuç "başvuruya hazır" anlamına gelmez; arayüz bunu açıkça söyler.
 *
 * PASİF (seviye 1): yalnızca ana sayfa ve ana sayfadan bağlantı verilen
 * yasal sayfalar okunur (en çok 7 sayfa, her biri tek GET). İstekler
 * ownership.safeGet'ten geçer: genel adres denetimi, yalnızca https, yalnızca
 * aynı site içinde yönlendirme, 256 KB, 5 sn.
 *
 * Analiz kısmı saf (analyzeHome): ağsız sınanabilir.
 */

const { safeGet } = require('./ownership.js');

/* Yasal sayfa türleri: bağlantı adresinde ya da metninde aranan kalıplar
   (küçük harf, Türkçe karakter sadeleştirilmiş). */
const PAGES = [
  { id: 'distance_sales', re: /mesafeli|distance.?sales/ },
  { id: 'pre_information', re: /on.?bilgilendirme|pre.?(contract|information)/ },
  { id: 'returns', re: /iade|cayma|teslimat|refund|return/ },
  { id: 'kvkk_notice', re: /kvkk|aydinlatma/ },
  { id: 'privacy', re: /gizlilik|privacy/ },
  { id: 'cookie_policy', re: /cerez|cookie/ },
  { id: 'contact', re: /iletisim|contact/ }
];

/* Bilinen çerez onay yönetim araçları (CMP) — betik adresinde aranır. */
const CMP_HOSTS = ['cookiebot', 'onetrust', 'cookieyes', 'cookiehub', 'iubenda', 'usercentrics',
  'termly', 'osano', 'didomi', 'quantcast', 'complianz', 'cookie-script', 'cookiefirst'];

function fold(s) {
  return String(s || '').toLowerCase()
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/İ/g, 'i');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

/** <a href> listesi: { href, text }. */
function links(html) {
  const out = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < 2000) {
    out.push({ href: m[1].trim(), text: stripTags(m[2]).trim() });
  }
  return out;
}

/** Dış betik ana bilgisayarları (aynı site hariç). */
function thirdPartyScripts(html, siteHost) {
  const hosts = new Set();
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  const base = String(siteHost || '').replace(/^www\./, '');
  while ((m = re.exec(String(html || '')))) {
    let u;
    try { u = new URL(m[1], 'https://' + siteHost + '/'); } catch (e) { continue; }
    const h = u.hostname.toLowerCase();
    if (h === siteHost || h.replace(/^www\./, '') === base || h.endsWith('.' + base)) continue;
    hosts.add(h);
  }
  return Array.from(hosts).sort();
}

/**
 * Ana sayfa analizi (saf).
 * @returns {{ pages: Object<string,string|null>, contact: Object<string,boolean>, cookies: object }}
 *   pages[id] = bulunan aynı-site bağlantı adresi ya da null
 */
function analyzeHome(html, siteHost) {
  const pages = {};
  const all = links(html);
  PAGES.forEach(function (p) {
    pages[p.id] = null;
    for (let i = 0; i < all.length; i++) {
      const l = all[i];
      if (!p.re.test(fold(l.href + ' ' + l.text))) continue;
      let u;
      try { u = new URL(l.href, 'https://' + siteHost + '/'); } catch (e) { continue; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      if (u.hostname.replace(/^www\./, '') !== String(siteHost).replace(/^www\./, '')) continue;
      pages[p.id] = u.href;
      break;
    }
  });

  const text = stripTags(html);
  const folded = fold(text);
  const contact = {
    email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text) || /href\s*=\s*["']mailto:/i.test(html),
    phone: /(\+90|0)\s*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/.test(text) || /href\s*=\s*["']tel:/i.test(html),
    taxId: /(vkn|vergi\s*(kimlik\s*)?no|mersis)\D{0,20}\d{10,16}/.test(folded),
    address: /(mahallesi|mah\.|caddesi|cad\.|sokak|sok\.|bulvari|blv\.)/.test(folded)
  };

  const scripts = thirdPartyScripts(html, siteHost);
  const cmp = scripts.some(function (h) { return CMP_HOSTS.some(function (c) { return h.indexOf(c) !== -1; }); });
  const bannerText = /(cerez|cookie)/.test(folded) && /(kabul|accept|reddet|reject|tercih|preferences|onay|consent)/.test(folded);
  return {
    pages: pages,
    contact: contact,
    cookies: { consentBanner: cmp || bannerText, cmp: cmp, thirdPartyScripts: scripts }
  };
}

/**
 * Tam ön kontrol. `deps.fetch` sınamada saplanır.
 * @returns {Promise<{ok: boolean, code?: string, domain?: string, items?: Array, thirdPartyScripts?: string[], checkedAt?: string}>}
 */
async function run(domain, deps) {
  const d = deps || {};
  const html = await safeGet('https://' + domain + '/', d.fetch);
  if (html === null) return { ok: false, code: 'unreachable' };
  const a = analyzeHome(html, domain);

  const items = [{ id: 'https', status: 'pass' }];

  for (const p of PAGES) {
    const url = a.pages[p.id];
    if (!url) { items.push({ id: p.id, status: 'fail' }); continue; }
    /* Bağlantı var: sayfa gerçekten açılıyor mu (tek GET). */
    const body = url.indexOf('https://') === 0 ? await safeGet(url, d.fetch) : null;
    items.push({ id: p.id, status: body !== null ? 'pass' : 'warn', url: url });
  }

  ['email', 'phone', 'taxId', 'address'].forEach(function (k) {
    items.push({ id: 'contact_' + k, status: a.contact[k] ? 'pass' : 'fail' });
  });
  items.push({ id: 'cookie_banner', status: a.cookies.consentBanner ? 'pass' : (a.cookies.thirdPartyScripts.length ? 'fail' : 'warn') });

  return {
    ok: true,
    domain: domain,
    items: items,
    thirdPartyScripts: a.cookies.thirdPartyScripts,
    summary: {
      pass: items.filter(function (i) { return i.status === 'pass'; }).length,
      total: items.length
    },
    checkedAt: new Date().toISOString()
  };
}

module.exports = { analyzeHome, run, links, thirdPartyScripts, PAGES, CMP_HOSTS };
