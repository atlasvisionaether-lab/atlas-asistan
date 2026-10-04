'use strict';

/**
 * Haftalık Enterprise taraması.
 *
 *   POST /api/cron/weekly-scan        (QStash zamanlayıcısından)
 *   GET  /api/cron/weekly-scan        (Vercel Cron'dan)
 *
 * İKİ ÇAĞIRAN, İKİ FARKLI DOĞRULAMA
 *
 * Brief hem QStash imza doğrulaması hem `vercel.json` içinde bir cron istedi.
 * Bunlar aynı şey değil ve ikisi tek bir doğrulamayla karşılanamaz:
 *
 *   - QStash kendi zamanlayıcısından POST atar ve isteği `Upstash-Signature`
 *     başlığındaki JWT ile imzalar. Doğrulama QSTASH_CURRENT_SIGNING_KEY /
 *     QSTASH_NEXT_SIGNING_KEY ile yapılır (ayrıntı: _lib/qstash.js).
 *   - Vercel Cron, `vercel.json` içindeki takvime göre kendi altyapısından
 *     GET atar ve imza GÖNDERMEZ; doğrulama `Authorization: Bearer
 *     <CRON_SECRET>` üzerinden olur.
 *
 * İkisi de destekleniyor, ama ikisi de İSTEĞE BAĞLI DEĞİL: hiçbir doğrulama
 * yapılandırılmamışsa uç 503 ile kapanıyor. Açık bir tarama tetikleyicisi
 * herkese açık kalırsa, üçüncü biri bizim altyapımızı başka sitelere istek
 * atmak için kullanabilir.
 *
 * GÜVENLİK NOTU: hiçbir anahtar, token ya da imza loglanmıyor; log satırları
 * yalnızca sebep kodunu taşıyor.
 */

const db = require('../_lib/db.js');
const ownership = require('../_lib/ownership.js');
const tg = require('../_lib/telegram.js');

/* Skor bu kadar ya da daha çok düşerse uyarı. Küçük oynamalar (bir başlığın
   ölçülememesi gibi) kanalı doldurmasın. */
const SCORE_DROP_ALERT = 5;

/** Hesabın bu alan adındaki son tamamlanmış taramasının skoru (yoksa null). */
async function previousScore(userId, domain) {
  try {
    const rows = await db.request('scan_jobs?user_id=eq.' + encodeURIComponent(userId)
      + '&domain=eq.' + encodeURIComponent(domain)
      + '&status=eq.completed&score=not.is.null&select=score&order=created_at.desc&limit=1');
    return rows && rows[0] && typeof rows[0].score === 'number' ? rows[0].score : null;
  } catch (err) {
    return null;
  }
}
const qstash = require('../_lib/qstash.js');
const { scanSite, SCANNER_VERSION, REPORT_VERSION } = require('../_lib/scanner.js');

/* Tek koşuda taranacak en çok alan adı. Serverless fonksiyonun süresi 60 saniye;
   listeyi tüketmeye çalışıp yarıda kesilmek, hiçbirini kaydetmemek demek
   olurdu. Kalanlar sonraki koşuda taranır (sıra `created_at` ile sabit). */
const MAX_TARGETS_PER_RUN = 5;

/** Ham gövdeyi okur. İmza gövde özetini de kapsıyor, bu yüzden gerekli. */
function readRawBody(req) {
  /* Vercel gövdeyi ayrıştırmışsa ham hali kaybolmuş olabilir. Bu uç gövde
     BEKLEMEDİĞİ için bu bir sorun değil: boş olmayan gövde reddediliyor. */
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) return null;
  return '';
}

function cronSecretOk(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = String((req.headers && req.headers.authorization) || '');
  const expected = 'Bearer ' + secret;
  if (header.length !== expected.length) return false;
  const crypto = require('node:crypto');
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const hasQstash = qstash.isConfigured();
  const hasCronSecret = typeof process.env.CRON_SECRET === 'string' && process.env.CRON_SECRET.length > 0;

  /* Doğrulanamayan tetikleyici KAPALI kalır (fail-closed). */
  if (!hasQstash && !hasCronSecret) {
    if (console && console.error) console.error('weekly-scan: no trigger auth configured');
    return res.status(503).json({ error: { code: 'cron_unconfigured' } });
  }

  const signature = (req.headers && (req.headers['upstash-signature'] || req.headers['Upstash-Signature'])) || null;

  if (signature) {
    const raw = readRawBody(req);
    if (raw === null) {
      return res.status(400).json({ error: { code: 'unexpected_body' } });
    }
    const check = qstash.verify(String(signature), raw);
    if (!check.ok) {
      if (console && console.warn) console.warn('weekly-scan: signature rejected -', check.reason);
      return res.status(401).json({ error: { code: 'invalid_signature' } });
    }
  } else if (!cronSecretOk(req)) {
    /* İmza yok ve cron sırrı da eşleşmiyor: kim olduğu bilinmiyor. */
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  if (!db.isConfigured()) {
    return res.status(503).json({ error: { code: 'db_unavailable' } });
  }

  /* Tarama günlüğü saklama süresi (12 ay, gizlilik metniyle aynı). Silme
     düşerse tarama yine sürer; bir sonraki haftada tekrar denenir. */
  let purgedBefore = null;
  try {
    purgedBefore = await ownership.purgeOldLogs();
  } catch (err) {
    if (console && console.error) console.error('scan log purge failed:', err.message);
  }

  let source;
  try {
    source = await db.enterpriseScanTargets(MAX_TARGETS_PER_RUN);
  } catch (err) {
    if (console && console.error) console.error('weekly-scan target query failed:', err.message);
    return res.status(503).json({ error: { code: 'targets_unavailable' } });
  }

  /* Abonelik kaynağı yoksa HİÇBİR ŞEY taranmıyor ve bu gizlenmiyor: yanıt
     sebebi taşıyor, böylece kurulumun eksik olduğu koşu kayıtlarından
     görülebiliyor. Uydurma bir hedef listesiyle tarama yapmak, parası
     olmayan birinin sitesine bizim adımıza istek atmak olurdu. */
  if (!source.available || !source.targets.length) {
    return res.status(200).json({
      ok: true,
      triggered: 0,
      skipped: 0,
      reason: source.reason,
      ranAt: new Date().toISOString()
    });
  }

  /* Hedefler SIRAYLA taranıyor, paralel değil: tarama ağ ağırlıklı ve
     paralel koşmak hem fonksiyon belleğini hem hedef sitelerin sırtını
     zorlar. Bir hedefin düşmesi diğerlerini götürmüyor. */
  const results = [];
  for (const target of source.targets) {
    try {
      const onceki = await previousScore(target.userId, target.domain);
      const scan = await scanSite('https://' + target.domain, { consent: false });
      let jobId = null;
      try {
        jobId = await db.saveOwaspJob(scan,
          /* Haftalık tarama PASİF: etkin kontroller müşterinin o an verdiği
             onaya bağlı ve bir cron o onayı taşıyamaz. `consent: false`
             bu yüzden sabit; IP de yok, çünkü isteği eden bir kullanıcı yok. */
          { userId: target.userId, ip: null },
          { scanner: SCANNER_VERSION, report: REPORT_VERSION }, false);
      } catch (err) {
        if (console && console.error) console.error('weekly-scan save failed for a target:', err.message);
      }
      results.push({ domain: target.domain, ok: true, jobId: jobId, score: scan.score, previous: onceki });
      if (typeof onceki === 'number' && typeof scan.score === 'number'
          && onceki - scan.score >= SCORE_DROP_ALERT) {
        await tg.sendTelegram(tg.mesaj.skorDustu(target.domain, onceki, scan.score), { type: 'alert' });
      }
    } catch (err) {
      /* Hedefin alan adı loglanıyor (müşterinin kendi alan adı, sır değil);
         hata metni kısaltılıyor. */
      if (console && console.warn) console.warn('weekly-scan failed for', target.domain, '-', String(err.message).slice(0, 120));
      results.push({ domain: target.domain, ok: false });
    }
  }

  return res.status(200).json({
    ok: true,
    triggered: results.filter(function (r) { return r.ok; }).length,
    skipped: results.filter(function (r) { return !r.ok; }).length,
    results: results,
    logsPurgedBefore: purgedBefore,
    ranAt: new Date().toISOString()
  });
};
