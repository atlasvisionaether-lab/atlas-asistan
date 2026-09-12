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

const geo = require('./geo.js');

const FETCH_TIMEOUT_MS = 5000;

/* Bir beslemeden okunacak azami gövde. urlhaus ölçümde 6.6 MB geldi; sınır
   onun üstünde ama sunucusuz belleği koruyacak kadar dar. Sınır aşılırsa
   besleme sessizce yarım ayrıştırılmaz, açıkça başarısız sayılır. */
const MAX_BYTES = 12 * 1024 * 1024;

const UA = 'CyberLionAI-WorldMap/1.0 (+https://www.cyberlionai.com)';

const ISO2_RE = /^[A-Z]{2}$/;

/**
 * Besleme tarihi → epoch ms.
 *
 * Ölçülen biçim `"2026-09-10 21:45:25 UTC"` — boşluklu ve sondaki "UTC" ile,
 * yani Date'in güvenilir ayrıştırdığı bir biçim DEĞİL. Araya "T" konup sonek
 * "Z" yapılmadan tarayıcı/Node bunu yerel saat sanabilir ve kovalar saatlerce
 * kayar. Ayrıştırılamayan değer null döner ve kovalara hiç girmez —
 * uydurulmuş bir zamana yerleştirmektense saymamak doğru.
 */
function parseFeedDate(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value.trim());
  if (!m) return null;
  const ms = Date.parse(m[1] + 'T' + m[2] + 'Z');
  return isNaN(ms) ? null : ms;
}

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

/**
 * Büyük bir beslemeyi BELLEĞE ALMADAN tarar ve GİRDİ başına ülke sayar.
 *
 * Neden akış: PhishTank'in toplu indirmesi ölçümde 41.6 MB geldi. Onu
 * JSON.parse'a vermek, sunucusuz bir fonksiyonda yüzlerce MB'lık bir nesne
 * demek. Gövde parça parça okunuyor; bellek gövde boyutundan bağımsız.
 *
 * NEDEN GİRDİ BAŞINA — ÖLÇÜLDÜ (koşu 34663226505)
 *
 *   kimlik avı adresi (girdi)    :  75.630
 *   ülke taşıyan detay satırı    : 104.083
 *   birden fazla detayı olan     :     305
 *   bir girdideki en fazla detay :   1.405
 *
 * Ülke `details[]` dizisinin içinde ve bir adres birden çok barındırma kaydı
 * taşıyabiliyor. Önceki sürüm her eşleşmeyi ayrı ayrı sayıyordu; sonuç
 * haritada "kayıt" diye gösterilen %37 şişik bir sayıydı. Daha kötüsü: 305
 * girdi ~28.700 satır taşıdığı için TEK bir adres bir ülkenin sayısını
 * tek başına şişirebiliyordu — sıralama da bozuluyordu.
 *
 * Şimdi her girdi, bulunduğu her ülkede BİR kez sayılıyor. Aynı girdide aynı
 * ülke kaç kez geçerse geçsin bir kez. `girdiIsareti` girdi sınırını gösteren
 * dizedir (PhishTank için `"phish_id"`); her girdide tam bir kez geçmelidir.
 */
async function fetchCountingCountries(url, limitBytes, girdiIsareti) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS * 4);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal, redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': '*/*' }
    });
  } catch (err) { clearTimeout(timer); throw new Error('feed_unreachable'); }
  if (!response.ok) { clearTimeout(timer); throw new Error('feed_status_' + response.status); }

  const CC = /"country"\s*:\s*"([A-Za-z]{2})"/g;
  const sayac = new Map();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf8');
  let toplamBayt = 0;
  let girdiSayisi = 0;

  /* Bir girdinin metnindeki BENZERSIZ ulkeleri sayaca isler. Ayni girdide ayni
     ulke kac kez gecerse gecsin bir kez sayilir. */
  function girdiyiIsle(metin) {
    if (!metin) return;
    girdiSayisi++;
    const gorulen = new Set();
    CC.lastIndex = 0;
    let m;
    while ((m = CC.exec(metin)) !== null) {
      const cc = m[1].toUpperCase();
      if (ISO2_RE.test(cc)) gorulen.add(cc);
    }
    gorulen.forEach(function (cc) { sayac.set(cc, (sayac.get(cc) || 0) + 1); });
  }

  let tampon = '';
  try {
    for (;;) {
      const adim = await reader.read();
      if (adim.done) break;
      toplamBayt += adim.value.length;
      if (toplamBayt > limitBytes) { reader.cancel().catch(function () {}); throw new Error('feed_too_large'); }

      tampon += decoder.decode(adim.value, { stream: true });

      /* Tamamlanmis girdiler islenip tampondan dusuluyor; tamponda en fazla
         BIR yarim girdi kalir, yani bellek govde boyutundan bagimsiz. */
      let kesim;
      while ((kesim = tampon.indexOf(girdiIsareti, 1)) !== -1) {
        girdiyiIsle(tampon.slice(0, kesim));
        tampon = tampon.slice(kesim);
      }
    }
    tampon += decoder.decode();
    girdiyiIsle(tampon);
  } finally {
    clearTimeout(timer);
  }

  /* Ilk parca girdi isaretinden ONCE gelen JSON basligini icerir ("[" gibi);
     o dilim ulke tasimadigi icin sayaci bozmaz ama girdi sayisini bir fazla
     gosterir. Isaret hic bulunmadiysa girdi sayisi 1 kalir ve o da yanlistir;
     iki durumda da gercek girdi sayisi bir eksiktir. */
  if (girdiSayisi > 0) girdiSayisi--;

  /* `toplam` artik DETAY SATIRI degil, (girdi, ulke) cifti sayisi: bir adres
     kac ayri ulkede barindiriliyorsa o kadar. Ulke toplamlarinin toplamina
     esittir, yani haritayla tutarlidir. */
  let ciftToplami = 0;
  sayac.forEach(function (n) { ciftToplami += n; });

  return { sayac: sayac, toplam: ciftToplami, girdi: girdiSayisi, bayt: toplamBayt };
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

  /* En sık üç zararlı yazılım ailesi yeter; kuyruk hem gürültü hem gereksiz yük. */
  return { total: rows.length, skipped: skipped, unresolved: skipped,
           countries: ulkeListesi(byCountry) };
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
  /* Ulke kirilimini IP->ulke cozumu veriyor. urlhaus'un kendi semasinda ulke
     YOK (olculdu); URL'deki ciplak IP cozuluyor. Alan adi tasiyan kayitlar
     cozulemez ve "konumu bilinmeyen" olarak AYRICA sayilir — haritada
     gorunmeyen kayit da kayittir. */
  const byCountry = new Map();
  let cozulemeyen = 0;
  let total = 0;
  let online = 0;

  /* Zaman kovaları. Arayüzdeki 1s/24s/7g filtresi BU beslemeden besleniyor:
     ölçümde `dateadded` gerçekten güncel damgalar taşıyor (örnek kayıt aynı
     günün 21:45'i). feodo ise anlık bir blokaj listesi — orada aynı filtre
     neredeyse her zaman boş dönerdi, o yüzden oraya bağlanmadı. */
  const now = Date.now();
  const buckets = { h1: 0, h24: 0, d7: 0 };

  for (const key of Object.keys(root)) {
    const bucket = root[key];
    const row = Array.isArray(bucket) ? bucket[0] : bucket;
    if (!row || typeof row !== 'object') continue;

    total++;
    if (row.url_status === 'online') online++;
    const threat = typeof row.threat === 'string' && row.threat ? row.threat : 'bilinmiyor';
    byThreat.set(threat, (byThreat.get(threat) || 0) + 1);

    /* Kaydin yasi ULKE KIRILIMINDEN ONCE hesaplaniyor: arayuzdeki 1s/24s/7g
       filtresi haritayi da degistirebilsin diye pencereler ulke basina da
       tutuluyor. Eskiden yalnizca genel toplam vardi ve o toplamin tek
       tuketicisi arayuzden dusunce filtre sessizce islevsiz kaldi. */
    const added = parseFeedDate(row.dateadded);
    const yas = added === null ? null : now - added;
    const kova = { h1: false, h24: false, d7: false };
    if (yas !== null && yas >= 0) {
      kova.h1 = yas <= 3600e3;
      kova.h24 = yas <= 86400e3;
      kova.d7 = yas <= 7 * 86400e3;
      if (kova.h1) buckets.h1++;
      if (kova.h24) buckets.h24++;
      if (kova.d7) buckets.d7++;
    }

    const ip = geo.ipFromUrl(row.url);
    const cc = ip ? geo.countryOfIp(ip) : null;
    if (cc) {
      let e = byCountry.get(cc);
      if (!e) {
        e = { country: cc, count: 0, online: 0, threats: new Map(),
              windows: { h1: 0, h24: 0, d7: 0 } };
        byCountry.set(cc, e);
      }
      e.count++;
      if (row.url_status === 'online') e.online++;
      e.threats.set(threat, (e.threats.get(threat) || 0) + 1);
      if (kova.h1) e.windows.h1++;
      if (kova.h24) e.windows.h24++;
      if (kova.d7) e.windows.d7++;
    } else {
      cozulemeyen++;
    }
  }

  return {
    total: total,
    online: online,
    windows: buckets,
    unresolved: cozulemeyen,
    countries: ulkeListesi(byCountry),
    threats: Array.from(byThreat.entries())
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 6)
      .map(function (p) { return { name: p[0], count: p[1] }; })
  };
}

/** Ülke haritasını, en yoğundan aza sıralı düz listeye çevirir. */
function ulkeListesi(m) {
  return Array.from(m.values())
    .map(function (e) {
      const o = { country: e.country, count: e.count };
      if (e.online !== undefined) o.online = e.online;
      /* Zaman pencereleri yalnizca damga TASIYAN kaynaklarda var. Yoklugu
         "sifir" degil "olculemedi" demek; bu yuzden alan hic eklenmiyor ve
         arayuz farki gorebiliyor. */
      if (e.windows) o.windows = e.windows;
      if (e.malware) {
        o.malware = Array.from(e.malware.entries())
          .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3)
          .map(function (p) { return { name: p[0], count: p[1] }; });
      }
      if (e.threats) {
        o.threats = Array.from(e.threats.entries())
          .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3)
          .map(function (p) { return { name: p[0], count: p[1] }; });
      }
      return o;
    })
    .sort(function (a, b) { return b.count - a.count; });
}

/**
 * torexit: satır başına bir IP, düz metin.
 *
 * Ülke yok, dolayısıyla harita işareti yok. Yalnızca çıkış düğümü sayısı
 * sunuluyor; IP listesi dışarı verilmiyor.
 */
function parseTorExit(text) {
  const byCountry = new Map();
  let count = 0;
  let cozulemeyen = 0;
  for (const line of text.split('\n')) {
    const v = line.trim();
    if (!v || v.charAt(0) === '#') continue;
    count++;
    const cc = geo.countryOfIp(v);
    if (cc) {
      let e = byCountry.get(cc);
      if (!e) { e = { country: cc, count: 0 }; byCountry.set(cc, e); }
      e.count++;
    } else {
      cozulemeyen++;
    }
  }
  return { total: count, unresolved: cozulemeyen, countries: ulkeListesi(byCountry) };
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
    geoSource: 'native',
    /* OLCULDU (kosu 34668079640): beslemede su an 5 kayit var ve first_seen
       degerleri 2022'den; last_online ise saat tasimiyor ("2026-03-07"), yani
       parseFeedDate onu okuyamaz. Zaman filtresi bu kaynakta anlamli bir sonuc
       uretemez — destekleniyormus gibi gostermek yaniltici olurdu. */
    supportsWindows: false,
    ttl: 5 * 60,
    parse: parseFeodo
  },
  {
    id: 'urlhaus',
    label: 'URLhaus',
    attribution: 'abuse.ch — URLhaus',
    /* json_online DEGIL json_recent — ve bu OLCUMLE secildi.
       json_online'a gecmeyi onermistim: "daha cok kayit, ayni saglayici, yeni
       lisans yuzeyi yok". Olcum (kosu 34703503182) bunu curuttu:

         json_recent  12.637 kayit   ciplak IP tasiyan 11.298   7g=2.912
         json_online  13.861 kayit   ciplak IP tasiyan  5.459   7g=  729

       Kayit sayisi %10 artiyor ama ULKESI COZULEBILEN kayit YARIYA DUSUYOR.
       Ulkeyi URL'deki ciplak IP'den cozuyoruz; alan adi tasiyan kayit haritada
       gorunmez. Yani json_online haritayi zenginlestirmiyor, FAKIRLESTIRIYOR.
       7 gunluk pencere de 2.912'den 729'a iniyor. */
    url: 'https://urlhaus.abuse.ch/downloads/json_recent/',
    /* Beslemenin kendi semasinda ulke YOK; ulke IP->ulke tablosundan
       cozuluyor. Alan adi tasiyan kayitlar cozulemiyor ve ayrica sayiliyor. */
    geo: true,
    geoSource: 'resolved',
    /* OLCULDU (kosu 34668079640): 12.408 kaydin TAMAMINDA dateadded
       ayristirilabiliyor; 1s=9, 24s=352, 7g=2.919. Zaman filtresini gercekten
       destekleyen tek kaynak bu. */
    supportsWindows: true,
    ttl: 30 * 60,
    parse: parseUrlhaus
  },
  {
    id: 'torexit',
    label: 'Tor çıkış düğümleri',
    attribution: 'Tor Project',
    url: 'https://check.torproject.org/torbulkexitlist',
    geo: true,
    geoSource: 'resolved',
    /* Duz IP listesi; OLCULDU, tek bir tarih bile yok. */
    supportsWindows: false,
    ttl: 30 * 60,
    parse: parseTorExit
  },
  {
    id: 'phishtank',
    label: 'PhishTank',
    attribution: 'PhishTank / OpenDNS',
    /* HTTPS zorunlu: duz HTTP uzerinden cekilen bir besleme yolda
       degistirilebilir ve biz onu haritada yayinliyoruz. Olcum http ile
       yapilmisti; https calismazsa kaynak ok:false doner ve harita diger
       uclerle calismaya devam eder — sessizce HTTP'ye dusmez. */
    url: 'https://data.phishtank.com/data/online-valid.json',
    geo: true,
    geoSource: 'native',
    /* Olcumde 41.6 MB geldi ve kayitlarinda `details[].country` var. Bu boyut
       JSON.parse'a verilemez; akis halinde sayiliyor (bkz. stream:true). */
    stream: true,
    /* Girdi siniri. PhishTank'te `phish_id` her girdide tam bir kez gecer;
       sayac girdileri bununla ayirir. */
    entryMarker: '"phish_id"',
    /* Akis halinde yalnizca ulke sayiliyor; girdi basina zaman damgasi
       ayristirilmiyor. Destekleniyor demek icin once o damganin olculmesi
       gerekir. */
    supportsWindows: false,
    maxBytes: 80 * 1024 * 1024,
    ttl: 6 * 60 * 60,
    parse: null
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
    let data;
    if (source.stream) {
      const r = await fetchCountingCountries(
        source.url, source.maxBytes || MAX_BYTES, source.entryMarker);
      data = {
        /* `total` = (girdi, ulke) cifti sayisi; ulke toplamlarinin toplamina
           esit, yani haritayla tutarli. `entries` ayri tutuluyor cunku bir
           adres birden cok ulkede barinabiliyor ve ikisi ayni sey degil. */
        total: r.toplam,
        entries: r.girdi,
        bytes: r.bayt,
        unresolved: 0,
        countries: Array.from(r.sayac.entries())
          .map(function (p) { return { country: p[0], count: p[1] }; })
          .sort(function (a, b) { return b.count - a.count; })
      };
    } else {
      data = source.parse(await fetchBody(source.url));
    }
    return {
      id: source.id,
      label: source.label,
      attribution: source.attribution,
      geo: source.geo,
      geoSource: source.geoSource || null,
      supportsWindows: source.supportsWindows === true,
      ok: true,
      fetchedAt: new Date().toISOString(),
      data: data
    };
  } catch (err) {
    const code = err && err.message ? String(err.message) : 'feed_error';
    return {
      id: source.id,
      label: source.label,
      attribution: source.attribution,
      geo: source.geo,
      geoSource: source.geoSource || null,
      supportsWindows: source.supportsWindows === true,
      ok: false,
      fetchedAt: new Date().toISOString(),
      error: /^feed_/.test(code) ? code : 'feed_error'
    };
  }
}

function findSource(id) {
  return SOURCES.find(function (s) { return s.id === id; }) || null;
}

module.exports = { SOURCES, loadSource, findSource, ulkeListesi };
