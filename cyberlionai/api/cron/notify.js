'use strict';

/**
 * Tarama bitti bildirimi (FCM) — WORKFLOW 4'ün ikinci adımı.
 *
 *   POST /api/cron/notify?jobId=<uuid>   (QStash imzası)
 *   GET  aynı yol                        (Bearer CRON_SECRET)
 *   → { ok, via, sent, failed, dropped }
 *
 * NEDEN BİR "JETONLARI DÖNDÜR" UCU DEĞİL: istenen tasarım
 * `/api/cron/users/tokens?jobId=` ile jetonları n8n'e vermekti. Bir FCM
 * kayıt jetonu, o cihaza bildirim gönderme YETKİSİDİR. Bu PR'ın amacı
 * n8n'den bir kimlik bilgisini (servis rolü anahtarı) çıkarmak; yerine
 * başka bir kimlik bilgisini (müşterilerin cihaz jetonları) koymak aynı
 * yüzeyi geri açardı — üstelik o n8n bir dizüstü bilgisayarda
 * `localhost:5678`'de çalışıyor. Bu yüzden bildirimi sunucu gönderiyor:
 * jetonlar veritabanıyla bu uç arasında kalıyor, n8n'de ne Firebase
 * kimliği ne de bir cihaz jetonu bulunuyor.
 *
 * YANIT MÜŞTERİ VERİSİ TAŞIMIYOR: alan adı, puan, jeton, kullanıcı kimliği
 * yok; yalnızca sayılar.
 *
 * ANONİM TARAMA = BİLDİRİM YOK. `scan_jobs.user_id` null ise jeton listesi
 * boş döner (bkz. db.deviceTokensForJob); bir iş kimliğini tahmin eden biri
 * kimsenin cihazına bildirim yollatamaz.
 */

const cronauth = require('../_lib/cronauth.js');
const db = require('../_lib/db.js');
const fcm = require('../_lib/fcm.js');
const tg = require('../_lib/telegram.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RISK_TR = { low: 'Düşük risk', medium: 'Orta risk', high: 'Yüksek risk', critical: 'Kritik risk' };

/**
 * Bildirim metni. Alan adı BİLEREK YOK: bildirim kilit ekranında, cihazın
 * sahibi olmayan biri de görebilir — hangi siteyi taradığı onun işi.
 * Ayrıntı uygulamada, `data.jobId` ile açılıyor.
 */
function metin(rapor) {
  const seviye = (rapor && RISK_TR[rapor.risk_level]) || null;
  const puan = rapor && typeof rapor.scanner_score === 'number' ? rapor.scanner_score : null;
  if (seviye && puan !== null) return seviye + ' · Güvenlik puanı ' + puan + '/100';
  if (seviye) return seviye;
  if (puan !== null) return 'Güvenlik puanı ' + puan + '/100';
  return 'Raporunuz hazır.';
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const yetki = cronauth.authorize(req);
  if (!yetki.ok) return res.status(yetki.status).json({ error: { code: yetki.code } });

  const jobId = String((req.query && req.query.jobId) || '').trim();
  if (!UUID_RE.test(jobId)) return res.status(400).json({ error: { code: 'bad_job_id' } });

  if (!db.isConfigured()) return res.status(503).json({ error: { code: 'db_unavailable' } });
  if (!fcm.isConfigured()) return res.status(503).json({ error: { code: 'fcm_unconfigured' } });

  let hedef;
  try {
    hedef = await db.deviceTokensForJob(jobId);
  } catch (err) {
    if (console && console.error) console.error('notify: token query failed:', err.message);
    return res.status(503).json({ error: { code: 'tokens_unavailable' } });
  }

  if (!hedef.job) return res.status(404).json({ error: { code: 'no_job' } });

  /* Cihaz yoksa bu bir hata DEĞİL: anonim tarama, ya da sahibi mobil
     uygulamayı hiç açmamış. Akış kırmızıya dönmemeli. */
  if (!hedef.tokens.length) {
    return res.status(200).json({ ok: true, via: yetki.via, sent: 0, failed: 0, dropped: 0, reason: 'no_devices' });
  }

  let rapor = null;
  try {
    rapor = await db.aiReportOf(jobId);
  } catch (err) {
    /* Rapor okunamazsa bildirim yine gidiyor, sadece metni genel oluyor. */
    if (console && console.warn) console.warn('notify: report read failed');
  }

  const govde = metin(rapor);
  let sent = 0, failed = 0, dropped = 0;
  let yetkiHatasi = null;

  for (const satir of hedef.tokens) {
    const sonuc = await fcm.send(satir.token, {
      title: 'Tarama bitti',
      body: govde,
      data: { jobId: jobId, pdfKey: 'ai/' + jobId + '.pdf' }
    });

    if (sonuc.ok) { sent += 1; continue; }
    failed += 1;

    /* Ölü jeton tablodan düşüyor, yoksa her bildirimde aynı hatayı alırız. */
    if (sonuc.invalid) {
      try { await db.dropDeviceToken(satir.token); dropped += 1; }
      catch (e) { if (console && console.error) console.error('notify: drop failed'); }
      continue;
    }

    /* Kimlik hatası koşunun tamamını boşa çıkarır: ilkinde dur. */
    if (sonuc.code === 'fcm_unauthorized' || sonuc.code === 'unconfigured') {
      yetkiHatasi = sonuc.code;
      break;
    }
  }

  if (yetkiHatasi) {
    try {
      await tg.sendTelegram(tg.mesaj.hata('/api/cron/notify', 502, yetkiHatasi), { type: 'alert' });
    } catch (e) { /* bildirim ucu kırmaz */ }
    tg.bildirimIsaretle(res);
    return res.status(502).json({ error: { code: yetkiHatasi } });
  }

  return res.status(200).json({ ok: true, via: yetki.via, sent: sent, failed: failed, dropped: dropped });
}

module.exports = tg.ucuSar(handler, '/api/cron/notify');
