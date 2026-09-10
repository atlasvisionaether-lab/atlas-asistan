'use strict';

/**
 * Açık tehdit beslemeleri — sunucu tarafı çekme ve normalleştirme.
 *
 * Neden sunucuda: tarayıcının CSP'si `connect-src 'self'` ile dar tutuluyor ve
 * öyle kalmalı. Harita için üçüncü taraf adres eklemek yerine istek burada
 * yapılır; tarayıcı yalnızca kendi origin'imizle konuşur.
 *
 * Alan adları TAHMİN EDİLMEDİ. Üçünün de gerçek yanıtı bir GitHub runner'ından
 * ölçüldü (`tools/feeds-probe.sh`, çalışma 34538699395, 2026-09-10):
 *
 *   feodo    dizi kökü, kayıtta `country` (ISO-2), `malware`, `status`
 *   urlhaus  sayısal kimlikle anahtarlanmış nesne kökü; her değer TEK elemanlı
 *            dizi; kayıtta `url`, `threat`, `tags`, `dateadded` — ÜLKE YOK
 *   torexit  düz metin, satır başına bir IP — ÜLKE YOK
 *
 * Bunun doğrudan sonucu: haritaya ülke işareti koyabilen tek besleme feodo.
 * Diğer ikisi için konum UYDURULMAZ; sayaç olarak sunulur.
 *
 * Ticari tehdit haritalarının (Kaspersky, Check Point, Fortinet, Radware)
 * verisi ve adlandırması bilerek kullanılmıyor: açık API'leri yok ve şartları
 * yeniden yayını yasaklıyor.
 */

const FETCH_TIMEOUT_MS = 5000;

/* Bir beslemeden okunacak azami gövde. urlhaus ölçümde 6.6 MB geldi; sınır
   onun üstünde ama sunucusuz belleği koruyacak kadar dar. Sınır aşılırsa
   besleme sessizce yarım ayrıştırılmaz, açıkça başarısız sayılır. */
const MAX_BYTES = 12 * 1024 * 1024;

const UA = 'CyberLionAI-WorldMap/1.0 (+https://www.cyberlionai.com)';

const ISO2_RE = /^[A-Z]{2}$/;

/* ------------------------------------------------------------------
   Çekme
   ------------------------------------------------------------------ */

async function fetchBody(url) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': '*/*' }
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('feed_unreachable');
  }

  if (!response.ok) {
    clearTimeout(timer);
    throw new Error('feed_status_' + response.status);
  }

  /* Content-Length güvenilmez (sıkıştırma, eksik başlık). Gövde parça parça
     okunup sınır gerçekten aşıldığında kesilir. */
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.length;
      if (total > MAX_BYTES) {
        reader.cancel().catch(function () {});
        throw new Error('feed_too_large');
      }
      chunks.push(step.value);
    }
  } finally {
    clearTimeout(timer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/* ------------------------------------------------------------------
   Ayrıştırıcılar — her biri ölçülmüş biçime birebir yazıldı
   ------------------------------------------------------------------ */

/**
 * feodo: `[{ ip_address, port, status, hostname, as_number, as_name,
 *             country, first_seen, last_online, malware }, ...]`
 *
 * IP adresleri BİLEREK dışarı verilmiyor. Haritanın ihtiyacı ülke başına sayı
 * ve zararlı yazılım ailesi; blokaj listesini yeniden yayınlamak değil.
 */
function parseFeodo(text) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('feed_shape');

  const byCountry = new Map();
  let skipped = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') { skipped++; continue; }
    const cc = typeof row.country === 'string' ? row.country.toUpperCase() : '';
    if (!ISO2_RE.test(cc)) { skipped++; continue; }   // ülkesiz kayıt haritaya girmez

    let entry = byCountry.get(cc);
    if (!entry) { entry = { country: cc, count: 0, online: 0, malware: new Map() }; byCountry.set(cc, entry); }

    entry.count++;
    if (row.status === 'online') entry.online++;
    if (typeof row.malware === 'string' && row.malware) {
      entry.malware.set(row.malware, (entry.malware.get(row.malware) || 0) + 1);
    }
  }

  const countries = Array.from(byCountry.values())
    .map(function (e) {
      return {
        country: e.country,
        count: e.count,
        online: e.online,
        /* En sık üç aile yeter; kuyruk hem gürültü hem gereksiz yük. */
        malware: Array.from(e.malware.entries())
          .sort(function (a, b) { return b[1] - a[1]; })
          .slice(0, 3)
          .map(function (p) { return { name: p[0], count: p[1] }; })
      };
    })
    .sort(function (a, b) { return b.count - a.count; });

  return { total: rows.length, skipped: skipped, countries: countries };
}

/**
 * urlhaus: `{ "3901218": [ { url, url_status, threat, tags, dateadded } ], ... }`
 *
 * Kök nesne, her değer TEK elemanlı dizi. Ülke alanı YOK — bu yüzden burada
 * ülke üretilmiyor, yalnızca tehdit türü dağılımı çıkarılıyor. URL'lerin
 * kendisi dışarı verilmiyor: canlı zararlı yazılım bağlantılarını kendi
 * ucumuzdan yeniden yayınlamak istemiyoruz.
 */
function parseUrlhaus(text) {
  const root = JSON.parse(text);
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('feed_shape');

  const byThreat = new Map();
  let total = 0;
  let online = 0;

  for (const key of Object.keys(root)) {
    const bucket = root[key];
    const row = Array.isArray(bucket) ? bucket[0] : bucket;
    if (!row || typeof row !== 'object') continue;

    total++;
    if (row.url_status === 'online') online++;
    const threat = typeof row.threat === 'string' && row.threat ? row.threat : 'bilinmiyor';
    byThreat.set(threat, (byThreat.get(threat) || 0) + 1);
  }

  return {
    total: total,
    online: online,
    threats: Array.from(byThreat.entries())
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 6)
      .map(function (p) { return { name: p[0], count: p[1] }; })
  };
}

/**
 * torexit: satır başına bir IP, düz metin.
 *
 * Ülke yok, dolayısıyla harita işareti yok. Yalnızca çıkış düğümü sayısı
 * sunuluyor; IP listesi dışarı verilmiyor.
 */
function parseTorExit(text) {
  let count = 0;
  for (const line of text.split('\n')) {
    const v = line.trim();
    if (v && v.charAt(0) !== '#') count++;
  }
  return { total: count };
}

/* ------------------------------------------------------------------
   Kaynak tanımları
   ------------------------------------------------------------------ */

/**
 * `ttl` kaynak başına ayrı: urlhaus her tazelemede ~6.6 MB indiriyor. Beş
 * dakikada bir çekmek günde ~2 GB eder — hem bize gereksiz yük, hem ücretsiz
 * hizmet veren abuse.ch'ye karşı kabalık. Sunduğumuz şey yalnızca bir sayaç
 * olduğu için yarım saatlik tazelik fazlasıyla yeterli.
 *
 * `geo` alanı ölçüm sonucudur, tercih değil: yalnızca feodo ülke taşıyor.
 */
const SOURCES = [
  {
    id: 'feodo',
    label: 'Feodo Tracker',
    attribution: 'abuse.ch — Feodo Tracker',
    url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.json',
    geo: true,
    ttl: 5 * 60,
    parse: parseFeodo
  },
  {
    id: 'urlhaus',
    label: 'URLhaus',
    attribution: 'abuse.ch — URLhaus',
    url: 'https://urlhaus.abuse.ch/downloads/json_recent/',
    geo: false,
    ttl: 30 * 60,
    parse: parseUrlhaus
  },
  {
    id: 'torexit',
    label: 'Tor çıkış düğümleri',
    attribution: 'Tor Project',
    url: 'https://check.torproject.org/torbulkexitlist',
    geo: false,
    ttl: 30 * 60,
    parse: parseTorExit
  }
];

/**
 * Tek kaynağı çeker ve ayrıştırır.
 *
 * Hata YAYILMAZ: bir besleme düşerse diğerleri gösterilmeye devam eder.
 * Harita "üç kaynaktan ikisi" ile de doğru bir haritadır; hepsini birden
 * kaybetmek çok daha kötü bir sonuç.
 */
async function loadSource(source) {
  try {
    const text = await fetchBody(source.url);
    return {
      id: source.id,
      label: source.label,
      attribution: source.attribution,
      geo: source.geo,
      ok: true,
      fetchedAt: new Date().toISOString(),
      data: source.parse(text)
    };
  } catch (err) {
    const code = err && err.message ? String(err.message) : 'feed_error';
    return {
      id: source.id,
      label: source.label,
      attribution: source.attribution,
      geo: source.geo,
      ok: false,
      fetchedAt: new Date().toISOString(),
      error: /^feed_/.test(code) ? code : 'feed_error'
    };
  }
}

function findSource(id) {
  return SOURCES.find(function (s) { return s.id === id; }) || null;
}

module.exports = { SOURCES, loadSource, findSource };
