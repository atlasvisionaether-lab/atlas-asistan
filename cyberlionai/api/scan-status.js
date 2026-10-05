'use strict';

/**
 * GET /api/scan-status?id=<uuid>
 *
 * Asenkron taramanın durumu. İstemci `/api/scan`'den 202 ve bir iş kimliği
 * aldıktan sonra bu ucu kısa aralıklarla yokluyor.
 *
 * NEDEN SUPABASE REALTIME DEĞİL
 *
 * Realtime, tarayıcıdan `wss://<proje>.supabase.co` bağlantısı demek. İki
 * sorun: (1) CSP'de `connect-src`'ı dış bir kaynağa açmak gerekirdi — bu
 * depoda CSP gevşetmemek açık bir karar; (2) RLS yalnızca `auth.uid() =
 * user_id` satırlarını okutuyor, ana sayfadaki taramaların çoğu ANONİM
 * (user_id null) ve anon anahtarla hiç okunamaz. Yani Realtime ana akışı
 * zaten taşıyamazdı. Aynı köken üzerinden yoklama hem CSP'ye dokunmuyor hem
 * de anonim oturumda çalışıyor.
 *
 * SAHİPLİK: süzgeç sorgunun içinde (hesap ya da anonim oturum). Başka bir
 * oturumun iş kimliğini bilmek işe yaramaz; yok ile "sizin değil" aynı 404.
 */

const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const { resolveOwner, clientIp, ipKey } = require('./_lib/session.js');
const tg = require('./_lib/telegram.js');

/* Yoklama sınırı. Taramanın kendisinden ayrı bir kova: yoklama ucuz bir
   okuma, tarama sınırını harcamamalı. Yine de sınırsız değil — bir istemci
   döngüye girip uca yüklenebilir. */
const POLL_WINDOW_SECONDS = 60;
const POLL_MAX = 120;

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!db.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  const id = (req.query && req.query.id) || '';
  if (!id) return res.status(400).json({ error: { code: 'empty' } });

  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit(
        'cl:rl:poll:' + ipKey(clientIp(req)), POLL_WINDOW_SECONDS);
      if (rate.count > POLL_MAX) {
        const retryAfter = rate.ttl > 0 ? rate.ttl : POLL_WINDOW_SECONDS;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
      }
    } catch (err) {
      /* Yoklama sınırı uygulanamadı. Burada istek REDDEDİLMİYOR: bu uç
         yalnızca okuyor ve kapatmak, hâlihazırda ücreti ödenmiş bir
         taramanın sonucunu kullanıcıdan saklamak olurdu. */
    }
  }

  const owner = await resolveOwner(req, res);

  let row;
  try {
    row = await db.getJobStatus(owner, id);
  } catch (err) {
    if (console && console.error) console.error('job status read failed:', err.message);
    /* Bu 503 diğerlerinden farklı: yapılandırma eksikliği değil, okuma
       DENENDİ ve düştü. Bu yüzden uyarı üretiyor (`ucuSar` 503'leri atlıyor,
       bkz. telegram.js). */
    tg.bildirimIsaretle(res);
    await tg.sendTelegram(tg.mesaj.hata('/api/scan-status', 503, 'job_status_read_failed'),
      { type: 'alert' });
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (!row) return res.status(404).json({ error: { code: 'not_found' } });

  const sonuc = row.result || {};
  const bitti = row.status === 'completed';

  /* Kuyruktan biten taramanın bildirimi. Taramayı Lambda bitiriyor ve
     Vercel'e haber vermiyor; sonucu ilk gören yer bu yoklama. İş kimliği
     başına BİR kez (istemci bitişten sonra da yoklayabilir). */
  if ((bitti || row.status === 'failed') && await tg.tekSefer('done:' + row.id, 7 * 86400)) {
    await tg.sendTelegram(bitti
      ? tg.mesaj.taramaBittiKuyruk(row.domain,
          typeof row.score === 'number' ? row.score : null,
          (sonuc.summary && sonuc.summary.failed) || 0)
      : tg.mesaj.taramaBasarisizKuyruk(row.domain, row.error_code),
      { type: 'scan' });
  }

  return res.status(200).json({
    jobId: row.id,
    status: row.status,
    host: row.domain,
    url: sonuc.url || row.url,
    score: typeof row.score === 'number' ? row.score : null,
    scannerMode: row.scanner_mode,
    country: row.country || null,
    attempts: row.attempts || 0,
    /* İlerleme çubuğunun okuduğu alanlar. Sunucunun bildirdiği gerçek
       değerler: Lambda her adımda yazıyor (bkz. aws/lambda-scanner/index.js).
       Göç uygulanmadıysa PostgREST bu sütunları döndürmez; null kalır ve
       istemci çubuğu kendi tahminiyle sürdürür. */
    progress: typeof row.progress === 'number' ? row.progress : null,
    current_step: row.current_step || null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    /* Bulgu ayrıntısı yalnızca iş bittiğinde döner: yarı dolu bir sonucu
       çizmek, kullanıcıya eksik bir taramayı tam gibi göstermek olurdu. */
    checks: bitti ? (sonuc.checks || []) : [],
    warnings: bitti ? (sonuc.warnings || []) : [],
    summary: bitti ? (sonuc.summary || null) : null,
    httpStatus: bitti ? (sonuc.httpStatus || null) : null,
    error: row.status === 'failed'
      ? { code: row.error_code || 'scan_failed' }
      : null
  });
}

module.exports = tg.ucuSar(handler, '/api/scan-status');
