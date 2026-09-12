'use strict';

/**
 * Dünya haritası verisi.
 *
 *   GET /api/worldmap
 *
 * Tarayıcı üçüncü taraf beslemelere DOĞRUDAN çıkmaz: CSP `connect-src 'self'`
 * dar kalsın diye istekler burada, sunucuda yapılır. Bu uç, haritanın tek veri
 * kaynağıdır.
 *
 * Tazeleme okumada yapılır, cron'la değil. Sebep: istek gelmeyen saatlerde
 * besleme çekmek boşa maliyet; ilk okuyan zaten bayat kaydı tazeliyor. Süresi
 * dolmamış önbellek kaydı varsa besleme hiç çağrılmaz.
 *
 * Kaynak biçimleri ölçüldü, tahmin edilmedi — ayrıntı `api/_lib/feeds.js`.
 */

const store = require('./_lib/store.js');
const feeds = require('./_lib/feeds.js');
const geo = require('./_lib/geo.js');
const { clientIp, ipKey } = require('./_lib/session.js');

/* Uç herkese açık ve her istek Redis'e dokunuyor; ayrıca bayat önbellekte
   dışarı çıkıyor. Sınır olmadan bu uç hem bizim hem abuse.ch'nin sırtına
   binebilir. Tarama ucundan daha cömert, çünkü harita sayfa açılışında bir
   kez çağrılıyor. */
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 30;

/* Tarayıcı önbelleği: en kısa kaynak ömrünün yarısı. Kullanıcı yenilediğinde
   veri hemen hemen taze olsun, ama arka arkaya yenilemeler ucu dövmesin. */
const BROWSER_CACHE_SECONDS = 150;

/* Anahtardaki surum eki, saklanan kaydin BICIMI ya da ANLAMI degistiginde
   artirilir. Sayac girdi basina sayacak sekilde duzeltildiginde eski kayitlar
   hala sisik sayilari tutuyordu ve phishtank'in TTL'i 6 saat: duzeltme
   dagitildiktan sonra saatlerce eski sayi gosterilecekti. Surum ekiyle eski
   kayitlar hicbir zaman okunmuyor, kendiliklerinden suresi dolup siliniyor. */
const CACHE_VERSION = 'v2';
function cacheKey(id) { return 'cl:wm:' + CACHE_VERSION + ':' + id; }

/**
 * Bir kaynağı önbellekten okur; yoksa çeker ve yazar.
 *
 * Çağrılmadan önce deponun yapılandırıldığı ve erişilebildiği doğrulanmış
 * olur. Yine de tek tek okuma/yazma hataları yutulur: veri elimizdeyken
 * önbelleğe yazamamak, kullanıcıya sonuç göstermemek için sebep değil.
 */
async function loadCached(source) {
  const key = cacheKey(source.id);

  try {
    const hit = await store.cacheGet(key);
    if (hit) { hit.cached = true; return hit; }
  } catch (err) { /* önbellek okunamadı; taze çekilecek */ }

  const fresh = await feeds.loadSource(source);
  fresh.cached = false;

  /* Başarısız sonuç da kısa süre önbelleklenir: düşmüş bir besleme her
     istekte 5 saniye zaman aşımı bekletmesin. */
  const ttl = fresh.ok ? source.ttl : 60;
  try { await store.cacheSet(key, fresh, ttl); } catch (err) { /* yazılamadı, önemli değil */ }

  return fresh;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=' + BROWSER_CACHE_SECONDS);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  /* Depo burada isteğe bağlı DEĞİL. Redis düştüğünde yalnızca hız sınırı
     kalkmaz; önbellek de kalkar. İkisi birden gittiğinde her istek abuse.ch'ye
     taze bir çekim demektir ve bunu sınırlayan hiçbir şey kalmaz. Ücretsiz
     hizmet veren bir kaynağa bu yükü bindirmektense ucu kapatmak doğru. */
  if (!store.isConfigured()) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: { code: 'worldmap_unavailable' } });
  }

  try {
    const hit = await store.hitRateLimit('cl:rl:wm:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
    if (hit.count > RATE_MAX) {
      res.setHeader('Retry-After', String(hit.ttl > 0 ? hit.ttl : RATE_WINDOW_SECONDS));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(429).json({ error: { code: 'rate_limited' } });
    }
  } catch (err) {
    if (console && console.error) console.error('worldmap rate limit store error:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  /* Kaynaklar paralel ve BİRBİRİNDEN BAĞIMSIZ yüklenir. loadSource hata
     fırlatmaz, başarısızlığı sonuç nesnesine yazar; bu yüzden allSettled
     gerekmez ve bir beslemenin düşmesi diğerlerini götürmez. */
  const results = await Promise.all(feeds.SOURCES.map(loadCached));

  /* Harita işaretleri ülke taşıyan kaynaklardan üretilir. Ülke ya beslemenin
     kendi alanından (`native`) ya da IP→ülke tablosundan (`resolved`) gelir;
     hangisi olduğu her kaynakta beyan edilir. Çözülemeyen kayda konum
     ATFEDİLMEZ — uydurulmuş bir nokta, boş bir haritadan daha yanıltıcıdır;
     onun yerine "konumu bilinmeyen" olarak ayrıca sayılır. */
  const countries = new Map();
  const threatTypes = new Map();
  let unresolved = 0;

  for (const r of results) {
    if (!r.ok || !r.data) continue;
    if (typeof r.data.unresolved === 'number') unresolved += r.data.unresolved;
    (r.data.threats || []).forEach(function (t) {
      threatTypes.set(t.name, (threatTypes.get(t.name) || 0) + t.count);
    });
    if (!r.geo || !Array.isArray(r.data.countries)) continue;

    for (const c of r.data.countries) {
      let entry = countries.get(c.country);
      if (!entry) { entry = { country: c.country, total: 0, sources: [] }; countries.set(c.country, entry); }
      entry.total += c.count;
      entry.sources.push({
        id: r.id, label: r.label, geoSource: r.geoSource,
        count: c.count, online: c.online, malware: c.malware, threats: c.threats
      });
    }
  }

  const markers = Array.from(countries.values())
    .sort(function (a, b) { return b.total - a.total; });

  /* Isı haritası için normalleştirilmiş yoğunluk. Doğrusal ölçek en yoğun bir
     iki ülkeyi kırmızı, kalan yüzlercesini ayırt edilemez kılardı; bu yüzden
     logaritmik. Değer 0..1 aralığında ve arayüzde renge çevriliyor. */
  const enYogun = markers.length ? markers[0].total : 0;
  const lnMax = Math.log(enYogun + 1) || 1;
  markers.forEach(function (m) { m.intensity = Math.round((Math.log(m.total + 1) / lnMax) * 1000) / 1000; });

  return res.status(200).json({
    generatedAt: new Date().toISOString(),

    /* Haritaya nokta koyulabilen katman. */
    markers: markers,

    /* En yoğun on ülke — arayüzdeki sıralama listesi bunu kullanır. */
    topCountries: markers.slice(0, 10).map(function (m) {
      return { country: m.country, total: m.total, intensity: m.intensity };
    }),

    /* Tehdit türü filtresi için birleşik dağılım. */
    threatTypes: Array.from(threatTypes.entries())
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10)
      .map(function (p) { return { name: p[0], count: p[1] }; }),

    /* Konumu çözülemeyen kayıt sayısı. Haritada görünmeyen kayıt da kayıttır
       ve saklanmaz. */
    unresolved: unresolved,

    /* IP→ülke tablosunun durumu; arayüz kaynağını dürüstçe gösterebilsin. */
    geoTable: geo.tableInfo(),

    /* Kaynak durumu — arayüz hangi beslemenin düştüğünü DÜRÜSTÇE göstersin
       diye başarısızlar da listede kalır. */
    sources: results.map(function (r) {
      return {
        id: r.id, label: r.label, attribution: r.attribution,
        geo: r.geo, ok: r.ok, cached: r.cached === true,
        fetchedAt: r.fetchedAt,
        error: r.ok ? undefined : r.error,
        /* Ülkesiz kaynakların özeti: haritada nokta değil, sayaç olarak sunulur. */
        /* Özet her kaynak için veriliyor; artık dördü de coğrafi.
           Ülke listesi `markers` içinde birleştirildiği için burada
           tekrarlanmıyor — yanıt gereksiz büyümesin. */
        summary: r.ok && r.data ? {
          total: r.data.total, online: r.data.online,
          windows: r.data.windows, threats: r.data.threats,
          unresolved: r.data.unresolved,
          countries: Array.isArray(r.data.countries) ? r.data.countries.length : 0
        } : undefined
      };
    }),

    /* Kendi tarama etkinliğimiz. Şu an BOŞ ve bu bilerek böyle:
       `cl_scans` gizlilik gereği ülke bilgisi tutmuyor (bkz. 003_scan_history).
       Konum türetmeden bu katmana veri koymak uydurma olurdu. Alan, ön yüz
       sözleşmesi sabit kalsın diye şimdiden burada. */
    ownActivity: { available: false, reason: 'no_geo_in_scan_history', countries: [] }
  });
};
