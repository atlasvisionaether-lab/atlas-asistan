'use strict';

/**
 * Ana sayfadaki sayacın verisi.
 *
 *   GET /api/stats
 *
 * NEDEN VAR
 *
 * Ana sayfada uzun süre "10.000+ Taranan Site" ve "%98 Doğruluk" yazdı. İkisi
 * de ölçülmüş bir sayı değildi; biri uydurma, diğeri tanımsızdı ("doğruluk"
 * neyin oranı?). Bir güvenlik ürününün kendi ana sayfasında kanıtlanamayan
 * sayı tutması, sattığı şeyle çelişiyor. O yüzden uydurma sayılar kaldırıldı
 * ve yerine yalnızca veritabanından ÖLÇÜLEN bir sayaç kondu: bu uç.
 *
 * NE DÖNÜYOR, NE DÖNMÜYOR
 *
 * Yanıt SAHİPSİZ ve KİMLİKSİZ. Dönen: tamamlanmış tarama sayısı, kaç ayrı
 * alan adı tarandığı, skoru olan taramaların ortalaması ve son yedi günün
 * günlük dağılımı. DÖNMEYEN: alan adlarının kendisi, host, IP, kullanıcı ya
 * da oturum kimliği. Hangi kullanıcının neyi taradığı bu uçtan çıkmaz —
 * ziyaretçiye gösterilen bir sayaç, müşterinin tarama listesi değildir.
 *
 * Sayılar `scan_jobs` tablosundan geliyor (OWASP Lite şeması). Eski `cl_scans`
 * tablosundaki kayıtlar BU SAYIYA KATILMIYOR; sayaç "yeni motorla yapılmış
 * tarama" sayıyor ve yanıttaki `source` alanı bunu açıkça söylüyor.
 */

const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const { clientIp, ipKey } = require('./_lib/session.js');

/* Uç herkese açık ve her istek veritabanına bir sorgu demek. Harita ucundan
   daha cömert değil: sayaç da sayfa açılışında bir kez çağrılıyor. */
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 30;

/* Tarayıcı önbelleği: sayaç saniye saniye doğru olmak zorunda değil, ama
   aynı ziyaretçinin her gezinmesi veritabanına gitmesin. */
const BROWSER_CACHE_SECONDS = 60;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=' + BROWSER_CACHE_SECONDS);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  /* Veritabanı yoksa SIFIR DÖNMÜYORUZ: "henüz tarama yok" ile "sayamadım"
     birbirinden farklı ve ikincisini sıfır diye göstermek ölçüm değil uydurma
     olurdu. Arayüz 503'ü görüp sayacı hiç göstermiyor. */
  if (!db.isConfigured()) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: { code: 'stats_unavailable' } });
  }

  /* Hız sınırı Redis'e bağlı. Depo yoksa uç KAPANMIYOR (haritadan farklı
     olarak burada üçüncü taraf bir besleme yok, tek bir sınırlı sorgu var);
     yalnızca sınır uygulanmıyor ve bu sessizce geçilmiyor, loga yazılıyor. */
  if (store.isConfigured()) {
    try {
      const hit = await store.hitRateLimit('cl:rl:stats:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
      if (hit.count > RATE_MAX) {
        res.setHeader('Retry-After', String(hit.ttl > 0 ? hit.ttl : RATE_WINDOW_SECONDS));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(429).json({ error: { code: 'rate_limited' } });
      }
    } catch (err) {
      if (console && console.warn) console.warn('stats rate limit store error:', err.message);
    }
  }

  let stats;
  try {
    stats = await db.scanStats();
  } catch (err) {
    if (console && console.error) console.error('stats query failed:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: { code: 'stats_unavailable' } });
  }

  return res.status(200).json({
    generatedAt: new Date().toISOString(),

    /* Sayacın gösterdiği sayı. Tamamlanmış taramalar; Cloudflare düzeltme
       denetim satırları ayıklanmış halde. */
    totalScans: stats.totalScans,

    /* Kaç AYRI alan adı tarandı. Alan adlarının kendisi dönmüyor. */
    uniqueDomains: stats.uniqueDomains,

    /* Skoru olan taramaların ortalaması ve kaç taramadan hesaplandığı.
       Ortalamayı kaç kayda dayandığını söylemeden vermek, üç taramadan
       çıkan bir sayıyı bin taramadan çıkmış gibi gösterirdi. */
    averageScore: stats.averageScore,
    scoredScans: stats.scoredScans,

    /* Son yedi gün, eskiden yeniye, tarama olmayan günler 0 ile. */
    last7Days: stats.last7Days,

    /* Üst sınıra dayanıldıysa bu SAKLANMIYOR. */
    truncated: stats.truncated,

    source: 'scan_jobs'
  });
};
