'use strict';

/**
 * Faz 5.5 sınaması: imzalı rapor indirme, cl_scans kaydı, anonim PDF düğmesi.
 * Ağ yok, AWS yok, veritabanı yok.
 *
 * NE SINANIYOR
 *
 *  1. Presign (sorgu dizgesinde imzalı S3 adresi) GERÇEKTEN ÇALIŞTIRILIYOR:
 *     kanonik isteğin biçimi, parametre sıralaması, `UNSIGNED-PAYLOAD`,
 *     imzalama anahtarının `s3` kapsamı ve adresin yapısı.
 *  2. Deno kaynağının (`supabase/functions/sign-report`) aynı sözleşmeyi
 *     kurduğu — YAPISAL denetim, canlı imza DEĞİL (bu ortamda Deno yok;
 *     `enqueue-scan` için de aynı sınır geçerli, bkz. sigv4-test.js).
 *  3. Sahipliğin sorguda olduğu ve `report_key`'in İSTEMCİDEN ALINMADIĞI.
 *  4. `cl_scans` satırının `db.saveScan()` ile AYNI alanları taşıdığı —
 *     ayrışırsa haritada kuyruklu ve eşzamanlı taramalar farklı görünür.
 *  5. Ham başlık değerinin ve IP'nin haritaya yazılmadığı.
 *  6. CSP'nin gevşetilmediği: imzalı adres 302 ile veriliyor, tarayıcı S3'e
 *     TEPE SEVİYE GEZİNME ile gidiyor; `connect-src` açılmıyor.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const KOK = path.join(__dirname, '..');
const oku = function (p) { return fs.readFileSync(path.join(KOK, p), 'utf8'); };

const denoSrc = oku('supabase/functions/sign-report/index.ts');
const signSrc = oku('api/_lib/reportsign.js');
const dlSrc = oku('api/report-download.js');
const statusSrc = oku('api/scan-status.js');
const dbSrc = oku('api/_lib/db.js');
const lambdaSrc = oku('aws/lambda-scanner/index.js');
const html = oku('index.html');
const vercel = oku('vercel.json');
const headers = oku('_headers');
const gocSrc = oku('db/2026-10-02-clscans-job-link.sql');

const sigv4 = require('../aws/lambda-scanner/lib/sigv4.js');
const { buildClScanRow, sanitizeFindings } = require('../aws/lambda-scanner/lib/clscan.js');
const { reportKey } = require('../aws/lambda-scanner/lib/s3.js');

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

/* ============================================================
   1. Presign — çalıştırılıyor
   ============================================================ */

const CREDS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
};
const AN = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const ANAHTAR = 'reports/2026/10/0d517ead-cbcb-4bba-8b34-5d8e3da53847.pdf';

const url = sigv4.presignS3Get(
  { bucket: 'cyberlionai-reports', key: ANAHTAR, region: 'eu-central-1', expiresIn: 120 },
  CREDS, AN);

dogru('imzalı adres kovanın S3 konağına gidiyor',
  url.indexOf('https://cyberlionai-reports.s3.eu-central-1.amazonaws.com/') === 0);
dogru('imzalı adres nesne anahtarını taşıyor', url.indexOf('/' + ANAHTAR + '?') !== -1);
dogru('imza sorgu dizgesinde', /&X-Amz-Signature=[0-9a-f]{64}$/.test(url));
dogru('algoritma bildiriliyor', url.indexOf('X-Amz-Algorithm=AWS4-HMAC-SHA256') !== -1);
dogru('kapsam s3 servisinde', url.indexOf('%2Fs3%2Faws4_request') !== -1);
dogru('kapsam doğru bölgede', url.indexOf('%2Feu-central-1%2F') !== -1);
esit('süre adreste', /X-Amz-Expires=(\d+)/.exec(url)[1], '120');
dogru('yalnızca host imzalı', url.indexOf('X-Amz-SignedHeaders=host') !== -1);

/* Kanonik sorgu parametreleri ADA GÖRE SIRALI olmak zorunda; sıra bozulursa
   S3 farklı bir imza hesaplar ve adres reddedilir. */
const sorgu = url.slice(url.indexOf('?') + 1).split('&')
  .map(function (p) { return p.split('=')[0]; })
  .filter(function (k) { return k !== 'X-Amz-Signature'; });
esit('kanonik parametreler sıralı', JSON.stringify(sorgu),
  JSON.stringify(sorgu.slice().sort()));

/* Aynı girdi aynı imzayı vermeli (zaman sabitken): imza yeniden üretilebilir
   olmazsa sınama hiçbir şeyi sabitlemez. */
const url2 = sigv4.presignS3Get(
  { bucket: 'cyberlionai-reports', key: ANAHTAR, region: 'eu-central-1', expiresIn: 120 },
  CREDS, AN);
esit('imza yeniden üretilebilir', url2, url);

/* Anahtar değişince imza da değişmeli — yoksa imza nesneyi bağlamıyor demektir. */
const urlBaska = sigv4.presignS3Get(
  { bucket: 'cyberlionai-reports', key: 'reports/2026/10/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf',
    region: 'eu-central-1', expiresIn: 120 }, CREDS, AN);
dogru('imza nesne anahtarına bağlı',
  /X-Amz-Signature=([0-9a-f]+)/.exec(urlBaska)[1] !== /X-Amz-Signature=([0-9a-f]+)/.exec(url)[1]);

/* Gizli anahtar değişince imza değişmeli. */
const urlBaskaSir = sigv4.presignS3Get(
  { bucket: 'cyberlionai-reports', key: ANAHTAR, region: 'eu-central-1', expiresIn: 120 },
  { accessKeyId: CREDS.accessKeyId, secretAccessKey: 'bambaskabirgizlianahtar000000000000000000' }, AN);
dogru('imza gizli anahtara bağlı',
  /X-Amz-Signature=([0-9a-f]+)/.exec(urlBaskaSir)[1] !== /X-Amz-Signature=([0-9a-f]+)/.exec(url)[1]);

/* Geçici kimlik (görev rolü) kullanılırsa belirteç adrese girmeli. */
const urlToken = sigv4.presignS3Get(
  { bucket: 'cyberlionai-reports', key: ANAHTAR, region: 'eu-central-1', expiresIn: 120 },
  { accessKeyId: CREDS.accessKeyId, secretAccessKey: CREDS.secretAccessKey, sessionToken: 'GEC1C1' }, AN);
dogru('oturum belirteci adrese giriyor', urlToken.indexOf('X-Amz-Security-Token=GEC1C1') !== -1);

/* İmzalama anahtarı türetimi, resmî AWS vektörleriyle doğrulanmış `sign()`
   ile AYNI zincir olmalı: AWS4+sır → gün → bölge → servis → aws4_request.
   Burada zinciri bağımsız kurup aynı imzayı ürettiğini doğruluyoruz. */
function hmacB(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
const gun = '20261002';
const kSigning = hmacB(hmacB(hmacB(hmacB(
  'AWS4' + CREDS.secretAccessKey, gun), 'eu-central-1'), 's3'), 'aws4_request');
const kanonikSorgu = url.slice(url.indexOf('?') + 1).replace(/&X-Amz-Signature=[0-9a-f]+$/, '');
const kanonikIstek = [
  'GET', '/' + ANAHTAR, kanonikSorgu,
  'host:cyberlionai-reports.s3.eu-central-1.amazonaws.com\n', 'host', 'UNSIGNED-PAYLOAD'
].join('\n');
const imzalanacak = ['AWS4-HMAC-SHA256', '20261002T120000Z',
  gun + '/eu-central-1/s3/aws4_request', sigv4.sha256Hex(kanonikIstek)].join('\n');
const beklenenImza = crypto.createHmac('sha256', kSigning).update(imzalanacak, 'utf8').digest('hex');
esit('kanonik istek ve anahtar türetimi bağımsız kurulumla eşleşiyor',
  /X-Amz-Signature=([0-9a-f]+)/.exec(url)[1], beklenenImza);

/* Lambda'nın ürettiği anahtar, Deno tarafındaki biçim süzgecinden GEÇMELİ.
   İki yer ayrışırsa rapor üretilir ama imzalanamaz. */
const KEY_RE = new RegExp(
  /^reports\/[0-9]{4}\/[0-9]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/.source, 'i');
const uretilen = reportKey('0d517ead-cbcb-4bba-8b34-5d8e3da53847', new Date(Date.UTC(2026, 9, 2)));
dogru('Lambda anahtarı imzalama süzgecinden geçiyor', KEY_RE.test(uretilen));
dogru('süzgeç dizin çıkışını reddediyor', !KEY_RE.test('reports/2026/10/../../../etc/passwd'));
dogru('süzgeç başka nesneyi reddediyor', !KEY_RE.test('secrets/key.pem'));
dogru('süzgeç PDF olmayanı reddediyor',
  !KEY_RE.test('reports/2026/10/0d517ead-cbcb-4bba-8b34-5d8e3da53847.txt'));
dogru('Deno kaynağındaki süzgeç aynı biçimi arıyor',
  denoSrc.indexOf('reports\\/[0-9]{4}\\/[0-9]{2}\\/') !== -1);

/* ============================================================
   2. Deno kaynağı — yapısal sözleşme
   ============================================================ */

dogru('imzalama UNSIGNED-PAYLOAD kullanıyor', denoSrc.indexOf('UNSIGNED-PAYLOAD') !== -1);
dogru('yalnızca host imzalanıyor', denoSrc.indexOf("'X-Amz-SignedHeaders', 'host'") !== -1);
dogru('kapsam s3 servisinde', denoSrc.indexOf("'s3'") !== -1);
dogru('parametreler sıralanıyor', /params\.sort\(/.test(denoSrc));
dogru('sır sabit zamanlı karşılaştırılıyor', denoSrc.indexOf('secretEquals') !== -1);
dogru('sır yoksa uç KAPALI', /if \(!beklenen\) return reddet\('not_configured'/.test(denoSrc));
/* Sırrın AYRI olması: okunan değişken SIGN_SHARED_SECRET olmalı ve
   ENQUEUE_SHARED_SECRET hiç OKUNMAMALI. Yorumda geçmesi serbest — orada
   ikisinin neden ayrı olduğu anlatılıyor. */
dogru('imzalama sırrı SIGN_SHARED_SECRET okunuyor',
  denoSrc.indexOf("Deno.env.get('SIGN_SHARED_SECRET')") !== -1);
dogru('enqueue sırrı bu işlevde OKUNMUYOR',
  denoSrc.indexOf("Deno.env.get('ENQUEUE_SHARED_SECRET')") === -1);
dogru('Vercel tarafı da ayrı sırrı okuyor',
  signSrc.indexOf('process.env.SIGN_SHARED_SECRET') !== -1
  && signSrc.indexOf('process.env.ENQUEUE_SHARED_SECRET') === -1);
dogru('süre üst sınırı var', /MAX_EXPIRES\s*=\s*\d+/.test(denoSrc));
dogru('süre üst sınırı uygulanıyor', /Math\.min\(istenen, MAX_EXPIRES\)/.test(denoSrc));
dogru('Deno kaynağı sır loglamıyor',
  !/console\.(log|error|warn)[\s\S]{0,80}(SECRET|secretAccessKey|beklenen)/.test(denoSrc));
dogru('Deno kaynağı imzalı adresi loglamıyor',
  !/console\.(log|error|warn)[\s\S]{0,40}url/.test(denoSrc));
dogru('depoda AWS gizli anahtarı yok',
  !/AKIA[0-9A-Z]{16}/.test(denoSrc + signSrc + dlSrc));

/* ============================================================
   3. Sahiplik ve açık yönlendirme
   ============================================================ */

dogru('indirme ucu sahiplik süzgeçli okumayı kullanıyor',
  dlSrc.indexOf('db.getJobStatus(owner, id)') !== -1);
dogru('report_key işin satırından okunuyor', dlSrc.indexOf('row.report_key') !== -1);
dogru('report_key İSTEMCİDEN alınmıyor',
  !/report_key\s*=\s*(req|body|query)/.test(dlSrc) && dlSrc.indexOf('query.report_key') === -1);
dogru('durum sorgusu report_key seçiyor', dbSrc.indexOf('report_key&limit=1') !== -1);
dogru('iş yoksa ya da sizin değilse 404',
  /if \(!row\) return res\.status\(404\)/.test(dlSrc));
dogru('PDF yoksa ayrı kod dönüyor', dlSrc.indexOf('report_not_available') !== -1);
dogru('yanıt 302 ile yönlendiriyor', /res\.status\(302\)\.end\(\)/.test(dlSrc));
dogru('imzalı adres gövdede DÖNMÜYOR', !/json\([^)]*url/.test(dlSrc));
dogru('yönlendirme hedefi amazonaws ile sınırlı',
  /amazonaws\\\.com/.test(signSrc) || signSrc.indexOf('.amazonaws.com\\/') !== -1);
dogru('sınır uygulanamazsa istek reddediliyor',
  /download rate limit unavailable[\s\S]{0,200}status\(503\)/.test(dlSrc));
dogru('indirme kendi hız sınırı kovasında', dlSrc.indexOf("'cl:rl:dl:'") !== -1);
dogru('durum ucu anahtarı DEĞİL varlığını dönüyor',
  statusSrc.indexOf('reportAvailable: !!row.report_key') !== -1
  && !/report_key: row\.report_key/.test(statusSrc));

/* ============================================================
   4. cl_scans satırı — saveScan ile aynı alanlar
   ============================================================ */

const jobRow = {
  id: '0d517ead-cbcb-4bba-8b34-5d8e3da53847',
  user_id: null,
  session_id: 'oturum-1'
};
const result = {
  host: 'ornek.com', country: 'TR', score: 88,
  summary: { total: 10, passed: 8, failed: 2, skipped: 0 },
  httpStatus: 200, redirects: 1, durationMs: 1234,
  checks: [{ id: 'hsts', severity: 'high', status: 'fail', note: 'yok',
             raw: 'max-age=0', value: 'GIZLI' }],
  warnings: ['redirected']
};
const satir = buildClScanRow(jobRow, result, { scanner: 's1', report: 'r1' });

/* Alan kümesi `db.saveScan()` ile birebir aynı olmalı (+ scan_job_id). */
const saveScanGovde = dbSrc.slice(dbSrc.indexOf('async function saveScan'),
  dbSrc.indexOf('const rows = await request(TABLE'));
const beklenenAlanlar = (saveScanGovde.match(/^\s{4}([a-z_]+):/gm) || [])
  .map(function (m) { return m.trim().replace(':', ''); });
const eksik = beklenenAlanlar.filter(function (a) { return !(a in satir); });
esit('saveScan alanlarının hepsi cl_scans satırında', JSON.stringify(eksik), '[]');
dogru('saveScan en az 16 alan taşıyor (süzgeç gerçekten alan buldu)',
  beklenenAlanlar.length >= 16);
const fazla = Object.keys(satir).filter(function (a) {
  return beklenenAlanlar.indexOf(a) === -1;
});
esit('fazladan yalnızca scan_job_id var', JSON.stringify(fazla), '["scan_job_id"]');

esit('anonim oturum kimliği yazılıyor', satir.anonymous_session_id, 'oturum-1');
esit('anonim satırda user_id boş', satir.user_id, null);
esit('iş kimliği satıra bağlanıyor', satir.scan_job_id, jobRow.id);

const hesapliJob = buildClScanRow(
  { id: 'j', user_id: 'kullanici-1', session_id: 'oturum-1' }, result, { scanner: 's', report: 'r' });
esit('hesap varsa oturum kimliği YAZILMIYOR', hesapliJob.anonymous_session_id, null);
esit('hesap varsa user_id yazılıyor', hesapliJob.user_id, 'kullanici-1');

/* Ham başlık değeri haritaya GİTMEMELİ. */
const satirJson = JSON.stringify(satir);
dogru('ham başlık değeri yazılmıyor', satirJson.indexOf('max-age=0') === -1);
dogru('ham değer alanı yazılmıyor', satirJson.indexOf('GIZLI') === -1);
esit('bulgu yalnızca dört alan taşıyor',
  JSON.stringify(Object.keys(sanitizeFindings(result.checks)[0])),
  JSON.stringify(['id', 'severity', 'status', 'note']));
dogru('IP adresi yazılmıyor', satirJson.indexOf('consent_ip') === -1
  && Object.keys(satir).indexOf('ip') === -1);

/* Ülke biçimi: iki büyük harf ya da null. */
esit('geçersiz ülke null yazılıyor',
  buildClScanRow(jobRow, Object.assign({}, result, { country: 'Turkiye' }),
    { scanner: 's', report: 'r' }).country, null);

/* ============================================================
   5. Lambda bağlantısı ve göç
   ============================================================ */

dogru('Lambda cl_scans satırını yazıyor', lambdaSrc.indexOf('supabase.insertScanRow(') !== -1);
dogru('cl_scans yazımı taramayı geçersiz KILMIYOR (try/catch içinde)',
  /try \{\s*await supabase\.insertScanRow\(/.test(lambdaSrc));
dogru('cl_scans yazımı completed yazımından ÖNCE',
  lambdaSrc.indexOf('insertScanRow(') < lambdaSrc.indexOf("status: 'completed'"));
dogru('tekrar teslimde çift kayıt engelli',
  oku('aws/lambda-scanner/lib/supabase.js').indexOf('resolution=ignore-duplicates') !== -1);
dogru('göç tekil indeks kuruyor', /CREATE UNIQUE INDEX IF NOT EXISTS/.test(gocSrc));
dogru('göç kısmi indeks KURMUYOR (PostgREST 42P10)',
  gocSrc.indexOf('CREATE UNIQUE INDEX') !== -1
  && !/CREATE UNIQUE INDEX[\s\S]{0,200}WHERE/.test(gocSrc));
dogru('göç RLS ve policy değiştirmiyor',
  gocSrc.indexOf('POLICY') === -1 && gocSrc.indexOf('ROW LEVEL SECURITY') === -1);
dogru('göç yalnızca sütun ve indeks ekliyor',
  gocSrc.indexOf('DROP TABLE') === -1 && gocSrc.indexOf('DELETE FROM') === -1);

/* ============================================================
   6. Arayüz ve CSP
   ============================================================ */

dogru('anonim kuyruk taramasında indirme düğmesi gösteriliyor',
  /result\.jobId && result\.reportAvailable/.test(html));
dogru('düğme imzalı indirme ucuna gidiyor',
  html.indexOf("'/api/report-download?id='") !== -1);
dogru('oturum açıkken dil duyarlı rapor tercih ediliyor',
  html.indexOf('authManager.isSignedIn()') < html.indexOf('result.reportAvailable'));

/* İmzalı adrese TEPE SEVİYE GEZİNME ile gidiliyor (302), fetch ile değil:
   `connect-src` dışa açılmıyor. Açılsaydı CSP gevşetilmiş olurdu. */
[['vercel.json', vercel], ['_headers', headers]].forEach(function (c) {
  const m = c[1].match(/connect-src ([^;"]+)/);
  esit(c[0] + ' connect-src gevşetilmedi', m && m[1].trim(), "'self' https://ipapi.co");
  dogru(c[0] + ' içinde amazonaws hedefi yok', c[1].indexOf('amazonaws.com') === -1);
});

/* ---- Sonuç ---- */
if (hatalar.length) {
  console.error('\nFaz 5.5 sınaması: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
  hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
  process.exit(1);
}
console.log('Faz 5.5 sınaması: ' + gecti + ' / ' + gecti + ' geçti');
