'use strict';

/**
 * POST /api/scan  →  { url: "ornek.com" }
 *
 * Gerçek tarama ucu. Hedefe sunucudan istek atılır, güvenlik başlıkları ve
 * TLS yapılandırması ölçülür, sonuç dinamik bir skorla döner.
 *
 * Sınırlar sunucu tarafında ve kalıcı depoda tutulur:
 *   - IP başına hız sınırı (kötüye kullanım)
 *   - Oturum başına ücretsiz tarama kotası (ürün politikası)
 * Tarayıcıdaki sayaç yalnızca gösterim içindir; karar burada verilir.
 *
 * İKİ YOL — EŞZAMANLI VE KUYRUKLU
 *
 * `SCAN_QUEUE_ENABLED=true` ise tarama BURADA yapılmaz: `scan_jobs` satırı
 * açılır, iş Supabase Edge Function üzerinden SQS'e bırakılır ve uç 202 ile
 * iş kimliğini döner. İstemci sonucu `/api/scan-status` üzerinden yoklar.
 * Bayrak kapalıysa (varsayılan) eski eşzamanlı davranış AYNEN sürüyor.
 *
 * Bayrak NEDEN var: kuyruk yolu AWS kaynakları (SQS, S3, Lambda) yayına
 * alınmadan çalışamaz. Bayrak olmasa, kodun yayına çıktığı ile Lambda'nın
 * mesaj tüketmeye başladığı an arasında ana sayfadaki tarayıcı ölürdü.
 * Bayrak yalnızca Lambda'nın gerçekten iş bitirdiği doğrulandıktan sonra
 * açılmalı.
 *
 * Sınırlar (IP hızı ve ücretsiz kota) İKİ YOLDA DA aynı yerde uygulanıyor:
 * kuyruğa bırakmak da bir tarama harcar, yoksa kota kuyruk üzerinden
 * sınırsız hâle gelirdi.
 */

const { scanSite, SCANNER_VERSION, REPORT_VERSION } = require('./_lib/scanner.js');
const scanqueue = require('./_lib/scanqueue.js');
const { startQueuedScan } = require('./_lib/queuestart.js');
/* EŞZAMANLI yol sonucu buraya yazıyor (saveScan / saveOwaspJob). Kuyruk
   dalı `queuestart.js`'e taşınırken bu satır yanlışlıkla silinmişti ve
   bayrak kapalı olduğu için HER tarama ReferenceError ile 500 döndü.
   tools/scanhandler-test.js artık ucu gerçekten çağırıyor. */
const db = require('./_lib/db.js');
const store = require('./_lib/store.js');
const tg = require('./_lib/telegram.js');
const { resolveOwner, ownerRef, clientIp, ipKey } = require('./_lib/session.js');
const { RATE_WINDOW_SECONDS, RATE_MAX } = require('./_lib/limits.js');
const entitlement = require('./_lib/entitlement.js');
const scanGate = require('./_lib/scan-gate.js');

/** Motorun fırlattığı teknik hataları istemcinin çevirebileceği kodlara eşler. */
const ERROR_STATUS = {
  empty: 400, invalid_url: 400, too_long: 400, bad_protocol: 400,
  credentials_not_allowed: 400, blocked_port: 400, dns_failed: 400,
  blocked_target: 403,
  timeout: 504, unreachable: 502, bad_redirect: 502, too_many_redirects: 502
};

/** Hedefe ulaşılamamasından kaynaklanan hatalarda ücretsiz hak iade edilir. */
const REFUNDABLE = ['timeout', 'unreachable', 'bad_redirect', 'too_many_redirects', 'dns_failed'];

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  // Kalıcı depo yoksa sınırlar uygulanamaz. Bu durumda taramayı açık
  // bırakmak ücretsiz katmanı sınırsız hâle getirirdi; bu yüzden kapatılır.
  if (!store.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  // IP sınırı önce: yalnızca isteğin kendisine bakar, kimlik çözümü için
  // ağ turu gerektirmez. Kötüye kullanım en ucuz noktada durur.
  const rateKey = 'cl:rl:' + ipKey(clientIp(req));

  let rate;
  try {
    rate = await store.hitRateLimit(rateKey, RATE_WINDOW_SECONDS);
  } catch (err) {
    // Depoya ulaşılamıyorsa sınır uygulanamıyor demektir; istek reddedilir.
    if (console && console.error) console.error('rate limit store error:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (rate.count > RATE_MAX) {
    const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
  }
  res.setHeader('X-RateLimit-Limit', String(RATE_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_MAX - rate.count)));

  // Sahiplik: giriş yapmışsa hesap, değilse anonim oturum. Kota da buna bağlı;
  // hesabın kotası çerez silinerek sıfırlanamaz.
  const owner = await resolveOwner(req, res);
  /* Sınır plana göre: free/anonim ömür boyu, Pro aylık, Enterprise sınırsız
     (bkz. _lib/entitlement.js). Eskiden herkese ücretsiz sınır uygulanıyordu. */
  const policy = await entitlement.resolvePolicy(owner, store.quotaKey(owner));
  const refundQuota = function () {
    return policy.unlimited ? Promise.resolve() : store.refundQuota(policy.key);
  };

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const url = body && body.url;
  if (!url) return res.status(400).json({ error: { code: 'empty' } });

  /* Onay kutusu bir BEYAN. Aktif kontroller (XSS/SQLi yoklaması, hassas yol
     denemesi) yalnızca beyan + DOĞRULANMIŞ sahiplik birlikteyken çalışır;
     karar scan-gate.js'te. Kapı kotadan önce: reddedilen istek hak harcamaz. */
  const declared = body && body.consent === true;
  if (declared && !(body && typeof body.domainOwnership === 'boolean' ? body.domainOwnership : true)) {
    return res.status(400).json({ error: { code: 'consent_required' } });
  }
  const gate = await scanGate.checkScan(req, {
    url: url, owner: owner, consent: declared,
    level: (body && body.level) || (req.query && req.query.level),
    lang: body && body.lang
  });
  if (!gate.ok) return scanGate.reject(res, gate);
  const consent = gate.activeConsent;

  // Kota önce ayrılır: eşzamanlı iki istek son hakkı iki kez harcayamaz.
  let quota;
  try {
    /* Sınırsız planda sayaç tutulmuyor; IP hız sınırı yukarıda zaten uygulandı. */
    quota = policy.unlimited
      ? { ok: true, used: null }
      : await store.reserveQuota(policy.key, policy.limit, policy.ttl);
  } catch (err) {
    if (console && console.error) console.error('quota store error:', err.message);
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  if (!quota.ok) {
    return res.status(402).json({
      error: {
        code: 'quota_exceeded',
        used: quota.used,
        limit: policy.limit,
        remaining: 0,
        plan: policy.plan,
        period: policy.period
      }
    });
  }

  /* Bildirim buradan sonra: adres doğrulandı ve kota ayrıldı, yani bu
     gerçekten başlayan bir tarama. Daha önce gönderilse geçersiz istekler ve
     kotası dolmuş denemeler de Telegram'a düşerdi.
     BEKLENİYOR, arka plana atılmıyor: sunucusuz fonksiyon handler'ın sözü
     çözülünce donuyor, beklenmeyen bir fetch yola çıkmadan kesilir. */
  await tg.sendTelegram(tg.mesaj.taramaBasladi(url), { type: 'scan' });

  /* ---- Kuyruklu yol ----
     Adımların kendisi `_lib/queuestart.js` içinde: aynı iş `/api/enqueue-scan`
     ucundan da başlatılıyor ve iki uç tek uygulamayı paylaşıyor. Buradaki
     tek fark yanıt biçimi (202 + jobId + kota). */
  if (scanqueue.isEnabled()) {
    const kuyruk = await startQueuedScan({
      url: url,
      consent: consent,
      owner: owner,
      ip: clientIp(req),
      refund: refundQuota
    });

    if (!kuyruk.ok) {
      tg.bildirimIsaretle(res);
      await tg.sendTelegram(tg.mesaj.taramaBasarisiz(url, kuyruk.code),
        { type: kuyruk.status >= 500 ? 'alert' : 'scan' });
      return res.status(kuyruk.status).json({ error: { code: kuyruk.code } });
    }

    await tg.sendTelegram(tg.mesaj.taramaKuyruga(kuyruk.host || url), { type: 'scan' });

    return res.status(202).json({
      jobId: kuyruk.jobId,
      status: 'queued',
      host: kuyruk.host,
      url: kuyruk.url,
      statusUrl: '/api/scan-status?id=' + encodeURIComponent(kuyruk.jobId),
      quota: entitlement.quotaView(policy, quota.used, owner.isAuthenticated ? 'account' : 'anonymous'),
      ownership: gate.ownership,
      versions: { scanner: SCANNER_VERSION, report: REPORT_VERSION }
    });
  }

  /* ---- Eşzamanlı yol (varsayılan) ---- */
  try {
    const result = await scanSite(url, { consent: consent });
    result.quota = entitlement.quotaView(policy, quota.used, owner.isAuthenticated ? 'account' : 'anonymous');
    result.ownership = gate.ownership;

    // Geçmişe kaydet. Kayıt başarısız olursa tarama sonucu yine döner:
    // geçmiş bir kolaylık, taramanın kendisi değil.
    if (db.isConfigured()) {
      /* OWASP job kaydı: aktif kontrollerde sahiplik onayı IP ve zaman
         damgasıyla loglanır (hukuki ispat). İstisnada tarama yine döner. */
      try {
        result.jobId = await db.saveOwaspJob(result,
          { userId: owner.userId, ip: clientIp(req) },
          { scanner: SCANNER_VERSION, report: REPORT_VERSION }, consent);
      } catch (err) {
        if (console && console.error) console.error('owasp job save failed:', err.message);
        result.jobId = null;
      }
      try {
        result.scanId = await db.saveScan(result, ownerRef(owner),
          { scanner: SCANNER_VERSION, report: REPORT_VERSION });
      } catch (err) {
        if (console && console.error) console.error('history save failed:', err.message);
        result.scanId = null;
      }
    } else {
      result.scanId = null;
    }

    /*
     * TODO (Görev 6 — e-posta): RESEND_API_KEY eklendiğinde aktif olacak.
     * TODO (Görev 6 — e-posta): await resend.emails.send({
     *   from: 'Cyber Lion AI <destek@cyberlionai.com>',
     *   to: owner.email || null,
     *   subject: 'Cyber Lion AI - Tarama Raporu: ' + result.host,
     *   attachments: [{ filename: 'rapor.pdf', content: pdfBase64 }]
     * });
     * Not: Google Workspace aktif olunca destek@ maili test et.
     *
     * TODO (Görev 6 — Telegram): TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID
     * eklendiğinde aktif olacak:
     * TODO (Görev 6 — Telegram): await fetch('https://api.telegram.org/bot'
     *   + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
     *   method: 'POST',
     *   headers: { 'Content-Type': 'application/json' },
     *   body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID,
     *     text: 'Yeni tarama: ' + result.host })
     * });
     */

    await tg.sendTelegram(
      tg.mesaj.taramaBitti(result.host || url,
        (result.summary && result.summary.failed) || 0, result.score),
      { type: 'scan' });

    return res.status(200).json(result);
  } catch (err) {
    const code = (err && err.message) || 'scan_failed';

    // Kullanıcının hatası olmayan başarısızlıklarda hak geri verilir.
    if (REFUNDABLE.indexOf(code) !== -1) {
      try { await refundQuota(); } catch (e) { /* iade edilemedi, sessiz geç */ }
    }

    const status = ERROR_STATUS[code] || 500;
    if (status >= 500 && console && console.error) console.error('scan error:', code);

    /* Bildirim ucun KENDİ mesajıyla gidiyor, çünkü alan adını taşıyor;
       `ucuSar`ın genel "500" uyarısı taşımıyor. İşaret, ikisinin birden
       gönderilmesini engelliyor. */
    tg.bildirimIsaretle(res);
    await tg.sendTelegram(tg.mesaj.taramaBasarisiz(url, code),
      { type: status >= 500 ? 'alert' : 'scan' });

    return res.status(status).json({ error: { code: code } });
  }
}

/* Sarmalayıcı: try/catch DIŞINDA fırlatan bir hata (örneğin kimlik çözümü)
   yoksa sessizce 500 dönerdi ve kimse haber almazdı. */
module.exports = tg.ucuSar(handler, '/api/scan');
