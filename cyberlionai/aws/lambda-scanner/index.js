'use strict';

/**
 * CyberLion AI — SQS tüketicisi tarama işçisi (Lambda, Node 20).
 *
 * AKIŞ
 *
 *   Vercel /api/scan      → scan_jobs satırını 'pending' açar
 *   Supabase enqueue-scan → SQS'e { url, user_id, scan_id } bırakır, 'queued'
 *   BU LAMBDA             → 'running' → tarama → bulgular → PDF → S3 → 'completed'
 *   Vercel /api/scan-status → istemciye durum döner (istemci kısa aralıkla sorar)
 *
 * TARAMA KODU ÇOĞALTILMADI. `scanSite` depodaki `api/_lib/scanner.js`'in
 * kendisi; `build.sh` onu ve bağımlılıklarını paketin içine KOPYALAR. İki ayrı
 * tarayıcı olsaydı skorlar iki yerde ayrışır ve hangisinin doğru olduğu
 * belirsizleşirdi.
 *
 * KISMİ BAŞARISIZLIK (`batchItemFailures`)
 *
 * Bir mesajın başarısız olması diğerlerini kuyruğa geri atmaz. Yalnızca
 * GERÇEKTEN yeniden denenebilir hatalar (hedefe ulaşılamadı, S3/DB geçici
 * hatası) geri bildirilir. Kullanıcı kaynaklı hatalar (geçersiz adres,
 * engelli hedef) yeniden denenmez: her denemede aynı sonucu verir ve mesaj
 * kuyruk ömrü boyunca dönüp durur. Bu yüzden iş 'failed' yazılır ve mesaj
 * başarıyla tüketilmiş sayılır.
 *
 * ORTAM DEĞİŞKENLERİ (değerleri konsolda girilir, bu depoda DURMAZ)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   — servis rolü, yalnızca sunucuda
 *   S3_BUCKET                                 — rapor kovası
 *   AWS_REGION                                — Lambda'nın kendisi koyar
 * AWS kimliği ortam değişkeniyle VERİLMEZ: Lambda'nın görev rolü kullanılır.
 */

const { scanSite, SCANNER_VERSION, REPORT_VERSION } = require('./_lib/scanner.js');
const { buildOwaspReport } = require('./_lib/report-owasp.js');
const supabase = require('./lib/supabase.js');
const s3 = require('./lib/s3.js');
const { buildDetail } = require('./lib/detail.js');
const { parseMessage, errorCode, RETRYABLE } = require('./lib/message.js');

/** Tek bir işi baştan sona yürütür. */
async function processJob(message) {
  /* 'running' yazarken dönen satır GÜNCELLEME SONRASI hâli, yani
     `attempts` hâlâ önceki değer. Deneme sayacı bu yüzden ikinci bir
     yazımda artırılıyor; tek yazımda artırmak için PostgREST'te sütunu
     kendisine ekleyen bir ifade gerekir ki REST katmanında yok. */
  const jobRow = await supabase.patchJob(message.scanId, { status: 'running' });

  if (!jobRow) {
    /* İş kaydı yok: silinmiş ya da hiç açılmamış. Yeniden denemek aynı
       sonucu verir, mesaj tüketilmiş sayılır. */
    throw new Error('job_not_found');
  }

  await supabase.patchJob(message.scanId, {
    attempts: (parseInt(jobRow.attempts, 10) || 0) + 1
  });

  const result = await scanSite(message.url, { consent: message.consent });

  const findings = (result.owaspFindings || []).map(function (f) {
    return {
      owasp_category: f.owasp_category,
      severity: f.severity,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      fix_code: f.fix_code
    };
  });

  await supabase.replaceFindings(message.scanId, findings);

  /* PDF ve S3 yüklemesi taramanın SONUCUNU geçersiz kılmamalı: rapor
     üretilemezse iş yine 'completed' yazılır, `report_url` boş kalır ve
     panel raporu /api/report üzerinden istek anında üretmeye devam eder.
     Taramayı 'failed' saymak, elde olan sonucu çöpe atmak olurdu. */
  let rapor = null;
  try {
    const detail = buildDetail(jobRow, result, findings);
    const pdf = buildOwaspReport(detail, 'tr');
    rapor = await s3.putReport(message.scanId, pdf);
  } catch (err) {
    if (console && console.error) console.error('report upload failed:', errorCode(err));
  }

  await supabase.patchJob(message.scanId, {
    status: 'completed',
    score: typeof result.score === 'number' ? result.score : null,
    country: result.country || null,
    completed_at: new Date().toISOString(),
    error_code: null,
    report_url: rapor ? rapor.url : null,
    report_key: rapor ? rapor.key : null,
    result: {
      score: result.score,
      summary: result.summary,
      owaspFailedCategories: result.owaspFailedCategories || {},
      activeChecksConsent: message.consent === true,
      checks: result.checks || [],
      warnings: result.warnings || [],
      httpStatus: result.httpStatus || null,
      url: result.url,
      versions: { scanner: SCANNER_VERSION, report: REPORT_VERSION }
    }
  });
}

exports.handler = async function handler(event) {
  if (!supabase.isConfigured()) {
    /* Yapılandırma eksikse işler 'queued' kalsın ve mesajlar kuyrukta
       beklesin: 'failed' yazmak, düzeltildikten sonra kurtarılamayacak
       işler bırakırdı. */
    throw new Error('db_not_configured');
  }

  const records = (event && event.Records) || [];
  const basarisiz = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    let message = null;
    try {
      message = parseMessage(record);
      await processJob(message);
    } catch (err) {
      const kod = errorCode(err);

      if (message && kod !== 'job_not_found') {
        try {
          await supabase.patchJob(message.scanId, {
            status: 'failed',
            error_code: kod,
            completed_at: new Date().toISOString()
          });
        } catch (e) { /* durum yazılamadı; aşağıda yeniden denemeye bırakılır */ }
      }

      if (RETRYABLE.indexOf(kod) !== -1) {
        basarisiz.push({ itemIdentifier: record.messageId });
      } else if (console && console.error) {
        console.error('scan job failed:', kod);
      }
    }
  }

  return { batchItemFailures: basarisiz };
};

