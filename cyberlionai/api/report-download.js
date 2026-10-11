'use strict';

/**
 * GET /api/report-download?id=<uuid>
 *
 * Kuyruklu taramanın Lambda tarafından üretilip S3'e konan PDF raporuna
 * SÜRELİ, imzalı bir adres verir ve tarayıcıyı 302 ile oraya yönlendirir.
 *
 * NEDEN BU UÇ VAR
 *
 * Kova ÖZEL (herkese kapalı, şifrelenmemiş yazma reddediliyor) ve `report_url`
 * imzasız duruyor; yani o adres doğrudan açılmıyor. Rapor üretildiği hâlde
 * indirilemiyordu.
 *
 * NEDEN `/api/report` YETMİYOR
 *
 * O uç raporu istek anında ÜRETİYOR ve `jobId` yolu GİRİŞ İSTİYOR (sorgu
 * `user_id`'ye bağlı). Ana sayfadaki taramaların çoğu ANONİM: kullanıcı
 * taramayı yapıyor, Lambda PDF'i üretiyor, ama kullanıcı ona erişemiyordu.
 * Bu uç sahipliği `user_id` VEYA `session_id` üzerinden kuruyor, yani anonim
 * oturum da kendi raporunu indirebiliyor — başkasının raporunu değil.
 *
 * SAHİPLİK: süzgeç sorgunun içinde (`db.getJobStatus`). `report_key` İSTEMCİDEN
 * ALINMIYOR, işin satırından okunuyor: istemci hangi nesnenin imzalanacağını
 * seçemez. Yok ile "sizin değil" aynı 404.
 *
 * İMZA BURADA ATILMIYOR: AWS anahtarı Supabase'de (bkz. _lib/reportsign.js).
 */

const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const reportsign = require('./_lib/reportsign.js');
const { resolveOwner, clientIp, ipKey } = require('./_lib/session.js');

/* İndirme sınırı. Yoklamadan ayrı ve DAHA SIKI bir kova: her istek bir imza
   üretiyor, yani Edge Function çağrısı demek. Rapor indirmek seyrek bir
   eylem; dakikada 10 fazlasıyla yeter. */
const DOWNLOAD_WINDOW_SECONDS = 60;
const DOWNLOAD_MAX = 10;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!db.isConfigured() || !reportsign.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  const id = (req.query && req.query.id) || '';
  if (!id) return res.status(400).json({ error: { code: 'empty' } });

  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit(
        'cl:rl:dl:' + ipKey(clientIp(req)), DOWNLOAD_WINDOW_SECONDS);
      if (rate.count > DOWNLOAD_MAX) {
        const retryAfter = rate.ttl > 0 ? rate.ttl : DOWNLOAD_WINDOW_SECONDS;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
      }
    } catch (err) {
      /* Sınır uygulanamadı. Burada istek REDDEDİLİYOR (yoklama ucunun
         tersine): her istek bir imza üretiyor, sınırsız bırakmak imzalama
         işlevini bedava bir kaldıraç hâline getirirdi. */
      if (console && console.error) console.error('download rate limit unavailable:', err.message);
      return res.status(503).json({ error: { code: 'service_unavailable' } });
    }
  }

  const owner = await resolveOwner(req, res);

  let row;
  try {
    row = await db.getJobStatus(owner, id);
  } catch (err) {
    if (console && console.error) console.error('job read failed:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (!row) return res.status(404).json({ error: { code: 'not_found' } });

  /* İş bitmemiş ya da PDF üretilememiş olabilir: Lambda rapor yüklemesi
     başarısız olsa bile taramayı 'completed' yazıyor (sonucu çöpe atmamak
     için), o yüzden `report_key` boş olabilir. Bu bir hata değil, "henüz/hiç
     yok" durumu ve ayrı bir kod olarak dönüyor: arayüz düğmeyi buna göre
     gizliyor. */
  if (!row.report_key) {
    return res.status(404).json({ error: { code: 'report_not_available' } });
  }

  let url;
  try {
    url = await reportsign.signReportUrl(row.report_key);
  } catch (err) {
    const kod = (err && err.message) || 'sign_rejected';
    if (console && console.error) console.error('report sign failed:', kod);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  /* 302 — imzalı adres yanıt GÖVDESİNDE dönmüyor. Gövdede dönse istemci onu
     saklayabilir, loglayabilir ya da paylaşabilirdi; yönlendirme tarayıcıda
     tek kullanımlık kalıyor. */
  res.setHeader('Location', url);
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(302).end();
};
