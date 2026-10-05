'use strict';

/**
 * Asenkron tarama kuyruğunun sınaması. Ağ yok, AWS yok, veritabanı yok.
 *
 * NE SINANIYOR
 *
 *  1. Bayrak kapalıyken eşzamanlı yolun BOZULMADIĞI (en önemlisi: kuyruk
 *     kodu yayına çıktığında ana sayfadaki tarayıcı çalışmaya devam etmeli).
 *  2. Kuyruk yolunda harcanan ücretsiz hakkın her başarısızlıkta İADE
 *     edildiği — iade edilmezse kullanıcı hiç tarama almadan hak kaybeder.
 *  3. Sahiplik süzgecinin sorgunun içinde olduğu (iş kimliğini bilmek
 *     başkasının sonucunu okutmamalı).
 *  4. Lambda'nın bulgu gruplamasının `db.getJobWithFindings()` ile aynı
 *     sırayı ürettiği ve PDF'in gerçekten üretildiği — bu bölüm GERÇEKTEN
 *     ÇALIŞTIRILIYOR, kaynak okumakla yetinilmiyor.
 *  5. TR ve EN sözlüklerinin kuyruk metinleri bakımından EŞİT olduğu.
 *  6. CSP'de `connect-src`'ın gevşetilmediği: yoklama aynı köken üzerinden
 *     yapılıyor, dışa açılan yeni bir hedef YOK.
 *  7. Yeniden denenecek bir hatanın iş satırına TERMİNAL 'failed' YAZMADIĞI
 *     — yazarsa istemci, SQS yeniden teslim etmeden önce çalışan bir
 *     taramayı başarısız görür (PR #57 üzerinde bildirilen bulgu).
 *  8. `/api/enqueue-scan` ile `/api/scan`'in kuyruk adımlarını PAYLAŞTIĞI ve
 *     kuyruk kapalıyken verilen 404'ün KOTA HARCAMADIĞI.
 */

const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..');
const oku = function (p) { return fs.readFileSync(path.join(KOK, p), 'utf8'); };

const scanSrc = oku('api/scan.js');
const statusSrc = oku('api/scan-status.js');
const queueSrc = oku('api/_lib/scanqueue.js');
const dbSrc = oku('api/_lib/db.js');
const lambdaSrc = oku('aws/lambda-scanner/index.js');
const enqueueSrc = oku('api/enqueue-scan.js');
const startSrc = oku('api/_lib/queuestart.js');
const html = oku('index.html');
const vercel = oku('vercel.json');
const headers = oku('_headers');

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) {
  if (kosul) { gecti += 1; return; }
  hatalar.push(ad);
}
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen)
    + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

/* ---- 1. Bayrak ---- */

dogru('kuyruk bayrağı SCAN_QUEUE_ENABLED ortam değişkeninden okunuyor',
  /SCAN_QUEUE_ENABLED/.test(queueSrc));
dogru("bayrak yalnızca 'true' değerinde açılıyor",
  /=== 'true'/.test(queueSrc));
dogru('/api/scan bayrağa bakıyor', /scanqueue\.isEnabled\(\)/.test(scanSrc));
dogru('eşzamanlı yol hâlâ scanSite çağırıyor',
  /const result = await scanSite\(url, \{ consent: consent \}\)/.test(scanSrc));
dogru('eşzamanlı yolda hâlâ saveScan ve saveOwaspJob yazılıyor',
  /db\.saveOwaspJob\(/.test(scanSrc) && /db\.saveScan\(/.test(scanSrc));
dogru('kuyruk dalı eşzamanlı yoldan ÖNCE ve ayrı',
  scanSrc.indexOf('scanqueue.isEnabled()')
    < scanSrc.indexOf('const result = await scanSite('));
dogru('bayrak açık ama yapılandırma eksikse eşzamanlı yola DÜŞÜLMÜYOR',
  /scanqueue\.isEnabled\(\) && scanqueue\.isConfigured\(\) && db\.isConfigured\(\)/.test(startSrc));

/* ---- 2. Kota iadesi ----

   Kuyruk adımları `_lib/queuestart.js` içinde (iki uç paylaşıyor). Her hata
   çıkışında `refund` çağrılmak ZORUNDA: iade edilmezse kullanıcı hiç tarama
   almadan hak kaybeder. Çıkış sayısı ile iade sayısı karşılaştırılıyor, yani
   yeni bir hata yolu eklenip iadesi unutulursa sınama kalır. */
const iade = (startSrc.match(/await refund\(\);/g) || []).length;
const hataCikis = (startSrc.match(/return \{ ok: false/g) || []).length;
esit('kuyruk adımlarındaki her hata çıkışında kota iadesi var', iade, hataCikis);
esit('kuyruk adımlarında 4 hata çıkışı var (yapılandırma, hedef, satır, kuyruk)',
  hataCikis, 4);
dogru('kuyruğa bırakılamayan iş failed yazılıyor',
  /db\.markJobFailed\(jobId, kod\)/.test(startSrc));
dogru('başarılı kuyruklama 202 dönüyor', /return res\.status\(202\)\.json\(/.test(scanSrc));
dogru('202 yanıtı jobId taşıyor', /jobId: kuyruk\.jobId/.test(scanSrc));
dogru('202 yanıtı kotayı bildiriyor', /quota: (\{|entitlement\.quotaView\()/.test(scanSrc));
dogru('hedef kuyruğa bırakılmadan önce doğrulanıyor',
  startSrc.indexOf('normalizeTarget(input.url)') !== -1
  && startSrc.indexOf('normalizeTarget(input.url)') < startSrc.indexOf('createPendingJob'));
dogru('iş kimliği SUNUCUDA üretiliyor (istemci kimlik seçemiyor)',
  !/scan_id:\s*body\./.test(scanSrc + enqueueSrc + startSrc)
    && !/jobId\s*=\s*body\./.test(scanSrc + enqueueSrc + startSrc));
dogru('kuyruk yolunda da IP hız sınırı ve kota uygulanıyor',
  scanSrc.indexOf('store.hitRateLimit') < scanSrc.indexOf('startQueuedScan({')
  && scanSrc.indexOf('store.reserveQuota') < scanSrc.indexOf('startQueuedScan({'));
dogru('ikinci uçta da IP hız sınırı ve kota uygulanıyor',
  enqueueSrc.indexOf('store.hitRateLimit') < enqueueSrc.indexOf('startQueuedScan({')
  && enqueueSrc.indexOf('store.reserveQuota') < enqueueSrc.indexOf('startQueuedScan({'));

/* ---- 3. Sahiplik ---- */

dogru('kuyruk işlerinde sahiplik süzgeci var', /function queueOwnerFilter/.test(dbSrc));
dogru('anonim sahiplik session_id üzerinden',
  /session_id=eq\.' \+ encodeURIComponent\(owner\.sessionId\)/.test(dbSrc));
dogru('getJobStatus sahiplik süzgecini SORGUYA koyuyor',
  /getJobStatus\(owner, jobId\)[\s\S]{0,400}queueOwnerFilter\(owner\)/.test(dbSrc));
dogru('getJobStatus kimliği UUID olarak doğruluyor',
  /async function getJobStatus[\s\S]{0,200}UUID_RE\.test/.test(dbSrc));
dogru('durum ucu yok ile "sizin değil" ayrımını yapmıyor (ikisi de 404)',
  /if \(!row\) return res\.status\(404\)\.json\(\{ error: \{ code: 'not_found' \} \} \)?;?/.test(statusSrc)
  || /if \(!row\) return res\.status\(404\)/.test(statusSrc));
dogru('durum ucu yalnızca GET', /req\.method !== 'GET'/.test(statusSrc));
dogru('durum ucu no-store', /'Cache-Control', 'no-store'/.test(statusSrc));
dogru('iş bitmeden bulgu ayrıntısı dönmüyor',
  /checks: bitti \? \(sonuc\.checks \|\| \[\]\) : \[\]/.test(statusSrc));
dogru('yoklama sınırı taramadan AYRI kovada',
  /'cl:rl:poll:'/.test(statusSrc));
dogru('yoklama sınırı uygulanamazsa okuma REDDEDİLMİYOR',
  /yalnızca okuyor ve kapatmak/.test(statusSrc));

/* ---- 4. Lambda: gruplama ve PDF (gerçekten çalıştırılıyor) ---- */

const { buildDetail } = require('../aws/lambda-scanner/lib/detail.js');
const { buildOwaspReport } = require('../api/_lib/report-owasp.js');

const jobRow = {
  id: '11111111-2222-3333-4444-555555555555',
  scanner_mode: 'passive', created_at: '2026-10-02T10:00:00Z', attempts: 0
};
const result = {
  host: 'ornek.com', url: 'https://ornek.com/', score: 63,
  summary: { passed: 4, failed: 3, skipped: 1 },
  owaspFailedCategories: { A05: 1 }, country: 'TR', checks: [], warnings: []
};
const findings = [
  { owasp_category: 'A05', severity: 'high', title: 'HSTS eksik' },
  { owasp_category: 'A02', severity: 'critical', title: 'TLS 1.0 açık' },
  { owasp_category: null, severity: 'low', title: 'Diğer' },
  { owasp_category: 'A05', severity: 'critical', title: 'CSP yok' }
];
const detail = buildDetail(jobRow, result, findings);

esit('gruplar kategori koduna göre artan, kategorisizler sonda',
  detail.groups.map(function (g) { return g.category; }).join(','), 'A02,A05,other');
esit('grup içi sıra önem derecesine göre',
  detail.groups.filter(function (g) { return g.category === 'A05'; })[0]
    .findings.map(function (f) { return f.severity; }).join(','), 'critical,high');
esit('önem sayacı doğru', JSON.stringify(detail.severityCounts),
  '{"critical":2,"high":1,"medium":0,"low":1,"info":0}');
esit('toplam bulgu', detail.totalFindings, 4);

const pdfTr = buildOwaspReport(detail, 'tr');
const pdfEn = buildOwaspReport(detail, 'en');
dogru('Lambda detayından TR PDF üretiliyor',
  Buffer.isBuffer(pdfTr) && pdfTr.slice(0, 5).toString('latin1') === '%PDF-');
dogru('Lambda detayından EN PDF üretiliyor',
  Buffer.isBuffer(pdfEn) && pdfEn.slice(0, 5).toString('latin1') === '%PDF-');

/* `index.js` DEĞİL, saf işlevlerin durduğu `lib/message.js` yükleniyor:
   index.js ilk satırında tarama motorunu çağırıyor ve motor paket içine
   build.sh tarafından kopyalanıyor. Sınamanın `build.sh` koşmuş olmasına
   bağlı kalması, CI'da adım sırası değiştiğinde sessizce kırılır (kırıldı). */
const T = require('../aws/lambda-scanner/lib/message.js');
esit('mesaj ayrıştırma scan_id okuyor',
  T.parseMessage({ body: JSON.stringify({
    url: 'ornek.com', user_id: null, scan_id: jobRow.id }) }).scanId, jobRow.id);
let reddedildi = [];
[['{}', 'bad_scan_id'], ['bozuk', 'bad_message'],
 [JSON.stringify({ scan_id: jobRow.id }), 'empty'],
 [JSON.stringify({ url: 'a', scan_id: 'uuid-degil' }), 'bad_scan_id']
].forEach(function (c) {
  try { T.parseMessage({ body: c[0] }); reddedildi.push('REDDEDİLMEDİ:' + c[0]); }
  catch (e) { if (e.message !== c[1]) reddedildi.push(e.message + '!==' + c[1]); }
});
esit('geçersiz mesajlar reddediliyor', reddedildi.join(','), '');
esit('hata kodu şemanın kabul ettiği biçime indiriliyor',
  /^[a-z0-9_]{1,40}$/.test(T.errorCode(new Error('Bir Şey Oldu!!'))), true);

/* Yeniden denenmeyecek hatalar kuyrukta dönüp durmamalı. */
dogru('kullanıcı kaynaklı hatalar yeniden denenmiyor',
  T.RETRYABLE.indexOf('blocked_target') === -1
  && T.RETRYABLE.indexOf('invalid_url') === -1
  && T.RETRYABLE.indexOf('bad_message') === -1);
dogru('geçici hatalar yeniden deneniyor',
  T.RETRYABLE.indexOf('timeout') !== -1
  && T.RETRYABLE.indexOf('db_unreachable') !== -1
  && T.RETRYABLE.indexOf('s3_unreachable') !== -1);
dogru('kısmi başarısızlık bildiriliyor (diğer mesajlar geri atılmıyor)',
  /batchItemFailures/.test(lambdaSrc));
/* Saf işlevler index.js'e geri taşınırsa bu sınama build.sh'e bağımlı
   hâle gelir; bağımlılığın yönü burada sabitleniyor. */
dogru('index.js saf işlevleri lib/message.js üzerinden alıyor',
  /require\('\.\/lib\/message\.js'\)/.test(lambdaSrc));
dogru('aynı mesaj tekrar gelirse bulgular ikiye katlanmıyor',
  /replaceFindings/.test(lambdaSrc)
  && /method: 'DELETE'/.test(oku('aws/lambda-scanner/lib/supabase.js')));
dogru('PDF üretilemezse tarama yine completed yazılıyor',
  /Taramayı 'failed' saymak, elde olan sonucu çöpe atmak olurdu/.test(lambdaSrc));
dogru('Lambda AWS kimliğini ortam değişkeniyle beklemiyor (görev rolü)',
  /Lambda'nın görev rolü kullanılır/.test(lambdaSrc));

/* ---- 5. İstemci: yoklama ve i18n ---- */

dogru('istemci 202 yanıtını tanıyor',
  /res\.status === 202 && data && data\.jobId/.test(html));
dogru('istemci yoklama işlevi var', /pollScan: function \(jobId, quota, onState\)/.test(html));
dogru('yoklama 429 aldığında işi başarısız SAYMIYOR',
  /if \(res\.status === 429\) return bekle\(API\.POLL_INTERVAL_MS \* 2\)\.then\(tur\)/.test(html));
dogru('yoklama ağ hatasında tek seferde vazgeçmiyor',
  /Ağ hatası tek seferde iş bitirmez/.test(html));
dogru('yoklama üst sınırı var', /tries > API\.POLL_MAX_TRIES/.test(html));
dogru('sınır dolunca queue_timeout dönüyor', /code: 'queue_timeout'/.test(html));
dogru('yoklama aynı köken (credentials: same-origin)',
  /scan-status\?id='[\s\S]{0,200}credentials: 'same-origin'/.test(html));
dogru('kuyruklu yolda rapor bağlantısı yalnızca oturum açıkken',
  /result\.jobId && authManager\.isSignedIn\(\)/.test(html));

['queued', 'running'].forEach(function (k) {
  esit('scan.' + k + ' iki dilde var',
    (html.match(new RegExp('^\\s*' + k + ": '", 'gm')) || []).length >= 2, true);
});
['queue_timeout', 'job_not_found'].forEach(function (k) {
  esit('scan.err.' + k + ' iki dilde var',
    (html.match(new RegExp(k + ": '", 'g')) || []).length >= 2, true);
});

/* i18n DÜZENEĞİ bozulmadı: data-i18n kancaları ve dil kalıcılığı yerinde. */
dogru('dil seçimi hâlâ saklanıyor',
  /store\.set\(CONFIG\.storageKeys\.lang, lang\)/.test(html));
dogru('data-i18n kancaları duruyor', (html.match(/data-i18n=/g) || []).length > 50);
dogru('fiyat bölümü id değişmedi',
  /<section class="section" id="pricing">/.test(html));

/* ---- 6. CSP ---- */

/* Yoklama aynı köken üzerinden. SQS ya da Supabase Realtime için
   `connect-src`'a YENİ hedef eklenmedi; eklenirse burada yakalanır. */
[['vercel.json', vercel], ['_headers', headers]].forEach(function (c) {
  const m = c[1].match(/connect-src ([^;\\"]+)/);
  esit(c[0] + ' connect-src gevşetilmedi',
    m && m[1].trim(), "'self' https://ipapi.co");
  dogru(c[0] + ' içinde amazonaws hedefi yok', c[1].indexOf('amazonaws.com') === -1);
  dogru(c[0] + ' içinde wss hedefi yok', c[1].indexOf('wss://') === -1);
});

/* ============================================================
   Yeniden deneme penceresinde iş satırı TERMİNAL OLMAMALI.

   Bildirilen bulgu: yeniden denenebilir hatalar (timeout, unreachable,
   db/s3_unreachable) satıra 'failed' yazılıp mesaj SQS'e geri veriliyordu.
   İstemci bu arada durumu yokluyor ve çalışmaya devam eden taramayı
   başarısız görüyordu. Karar artık saf bir işlevde ve BURADA ÇALIŞTIRILIYOR.
   ============================================================ */

const mesaj = require('../aws/lambda-scanner/lib/message.js');
const kayit = function (n) { return { attributes: { ApproximateReceiveCount: String(n) } }; };

const ilk = mesaj.retryDecision('timeout', kayit(1), {});
dogru('yeniden denenecek hata mesajı kuyruğa geri verir', ilk.retry === true);
esit('yeniden deneme penceresinde durum terminal değil', ilk.patch.status, 'queued');
esit('yeniden deneme penceresinde completed_at yazılmaz', ilk.patch.completed_at, null);
esit('yeniden deneme penceresinde hata kodu teşhis için yazılır',
  ilk.patch.error_code, 'timeout');

mesaj.RETRYABLE.forEach(function (kod) {
  const k = mesaj.retryDecision(kod, kayit(1), {});
  dogru('`' + kod + '` ilk denemede failed YAZMAZ', k.patch.status === 'queued');
});

const son = mesaj.retryDecision('timeout', kayit(3), {});
dogru('deneme hakkı tükendiğinde durum terminal', son.patch.status === 'failed');
dogru('terminal durumda completed_at yazılır', typeof son.patch.completed_at === 'string');

const ortam = mesaj.retryDecision('timeout', kayit(3), { SQS_MAX_RECEIVE_COUNT: '5' });
esit('teslim sınırı ortam değişkeninden okunur', ortam.patch.status, 'queued');

const kalici = mesaj.retryDecision('blocked_target', kayit(1), {});
dogru('kalıcı hata yeniden denenmez', kalici.retry === false);
esit('kalıcı hata terminal yazılır', kalici.patch.status, 'failed');

esit('iş kaydı yoksa satıra hiç yazılmaz',
  mesaj.retryDecision('job_not_found', kayit(1), {}).patch, null);

/* Lambda kararı KENDİ İÇİNDE tekrar etmemeli: hata yolunda elle yazılmış bir
   'failed' kalırsa yukarıdaki sınamalar yeşil kalır ama hata geri gelir. */
const yakalaBlok = lambdaSrc.slice(lambdaSrc.indexOf('} catch (err) {', lambdaSrc.indexOf('exports.handler')));
dogru('Lambda hata yolu kararı retryDecision\'a bırakır',
  yakalaBlok.indexOf('retryDecision') === -1
    ? false
    : !/status:\s*'failed'/.test(yakalaBlok));

/* İlerleme alanları gerçekten yazılıyor ve okunuyor mu. */
dogru('Lambda current_step yazıyor', /current_step:\s*'scanning_headers'/.test(lambdaSrc));
dogru('Lambda rapor adımını bildiriyor', /current_step:\s*'generating_report'/.test(lambdaSrc));
dogru('durum ucu progress döndürüyor', /progress:\s*typeof row\.progress/.test(statusSrc));
dogru('durum ucu current_step döndürüyor', statusSrc.indexOf('current_step: row.current_step') !== -1);
dogru('durum sorgusu ilerleme sütunlarını seçiyor',
  dbSrc.indexOf('attempts,progress,current_step') !== -1);

/* ============================================================
   İki uç tek uygulamayı paylaşıyor.
   ============================================================ */

dogru('/api/scan kuyruk adımlarını paylaşılan modülden çağırıyor',
  scanSrc.indexOf('startQueuedScan') !== -1);
dogru('/api/enqueue-scan kuyruk adımlarını paylaşılan modülden çağırıyor',
  enqueueSrc.indexOf('startQueuedScan') !== -1);
dogru('kuyruk adımları tek yerde: /api/scan satır açmıyor',
  scanSrc.indexOf('createPendingJob') === -1);
dogru('kuyruk adımları tek yerde: /api/enqueue-scan satır açmıyor',
  enqueueSrc.indexOf('createPendingJob') === -1);
dogru('paylaşılan modül hedefi doğruluyor', startSrc.indexOf('normalizeTarget') !== -1);
dogru('paylaşılan modül her hata yolunda hakkı iade ediyor',
  (startSrc.match(/await refund\(\)/g) || []).length === 4);

/* Kuyruk kapalıyken 404 — ve o 404 KOTA HARCAMAMALI. İstemci 404 görünce
   eşzamanlı /api/scan'e düşüyor; burada hak harcanırsa tek tarama iki hak
   yer. Bu yüzden 404 kontrolü kota ayırmadan ÖNCE gelmek zorunda. */
esit('kuyruk kapalıyken uç 404 dönüyor',
  /isAvailable\(\)\)\s*\{\s*return res\.status\(404\)/.test(enqueueSrc.replace(/\n/g, ' ')), true);
dogru('404 kota ayırmadan önce veriliyor',
  enqueueSrc.indexOf('status(404)') < enqueueSrc.indexOf('reserveQuota'));
dogru('404 hız sınırından önce veriliyor',
  enqueueSrc.indexOf('status(404)') < enqueueSrc.indexOf('hitRateLimit'));
dogru('uç istemcinin okuduğu scanId alanını dönüyor',
  /scanId:\s*kuyruk\.jobId/.test(enqueueSrc));
dogru('iki uç aynı hız sınırı kovasını kullanıyor',
  enqueueSrc.indexOf("'cl:rl:'") !== -1 && scanSrc.indexOf("'cl:rl:'") !== -1);

/* İstemci var olan ucu yokluyor. `/api/scan/<id>` diye bir uç YOK. */
dogru('istemci durum ucunu yokluyor',
  html.indexOf("'/api/scan-status?id=' + encodeURIComponent(scanId)") !== -1);
dogru('istemci olmayan /api/scan/<id> ucunu çağırmıyor',
  !/'\/api\/scan\/' \+ encodeURIComponent/.test(html));
/* Kuyruk yolunda tahmini sayaç durdurulmalı, yoksa çubuk sunucunun bildirdiği
   gerçek değer ile tahmin arasında zıplar. Artık yerel bir `ticker` yok;
   sayaç tek yerden (`stopProgress`) yönetiliyor — kaçak sayaç yayında
   taramayı %85'te dondurmuştu, bkz. tools/scanprogress-test.js. */
/* Araya yorum girebilir, bu yüzden bitişiklik değil SIRA sınanıyor:
   `return pollScan(` öncesindeki son DEYİM `stopProgress();` olmalı. */
var kuyrukDali = html.slice(html.indexOf('API.enqueueScan(domain)'),
  html.indexOf('return pollScan('));
var sonDurdurma = kuyrukDali.lastIndexOf('stopProgress();');
dogru('kuyruk yolunda tahmini ilerleme sayacı durduruluyor',
  sonDurdurma !== -1 &&
  kuyrukDali.slice(sonDurdurma + 'stopProgress();'.length)
    .replace(/\/\*[\s\S]*?\*\//g, '').trim() === '');
dogru('ilerleme sayacı tek yerden yönetiliyor (yerel ticker yok)',
  html.indexOf('var ticker') === -1 && html.indexOf('clearInterval(ticker)') === -1);

/* ---- Sırlar ---- */

dogru('depoda AWS gizli anahtarı yok',
  !/AKIA[0-9A-Z]{16}/.test(scanSrc + queueSrc + lambdaSrc + oku('supabase/functions/enqueue-scan/index.ts')));
dogru('kuyruk katmanı sır loglamıyor',
  !/console\.(log|error|warn)\([^)]*cfg\.(key|secret)/.test(queueSrc));

/* ---- Sonuç ---- */
if (hatalar.length) {
  console.error('\nKuyruk sınaması: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
  hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
  process.exit(1);
}
console.log('Kuyruk sınaması: ' + gecti + ' / ' + gecti + ' geçti');
