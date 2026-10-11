'use strict';

/**
 * AWS SigV4 imzalayıcısının sınaması. Ağ yok, anahtar yok.
 *
 * 1. BÖLÜM — Node imzalayıcısı (aws/lambda-scanner/lib/sigv4.js) AWS'in
 *    YAYINLADIĞI sınama vektörleriyle karşılaştırılıyor. Beklenen imza
 *    elle yazılmadı: `aws-sig-v4-test-suite` içindeki `get-vanilla` ve
 *    `post-x-www-form-urlencoded` senaryolarının resmî çıktıları. Kendi
 *    ürettiğimiz değeri kendimize doğrulatmak hiçbir şey kanıtlamazdı.
 *
 * 2. BÖLÜM — Supabase Edge Function (Deno/TypeScript) aynı algoritmayı
 *    kendi çalışma ortamında uyguluyor ve bu depoda Deno YOK, yani
 *    çalıştırılarak sınanamıyor. Bunun yerine KAYNAĞI okunup imzaya giren
 *    sözleşmenin 1. bölümde doğrulanan biçimle aynı olduğu denetleniyor:
 *    imzalanan başlık kümesi, boş sorgu dizesi, servis adı ve form gövdesi.
 *    Bu bir yapı sınaması; imzanın kendisini AWS'e karşı doğrulamıyor.
 *    Canlı doğrulama, bir kez `supabase functions invoke` ile yapılmalı
 *    (bkz. docs/scan-queue.md).
 */

const fs = require('node:fs');
const path = require('node:path');
const sigv4 = require('../aws/lambda-scanner/lib/sigv4.js');

let gecti = 0;
const hatalar = [];

function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + '\n    beklenen: ' + beklenen + '\n    bulunan : ' + bulunan);
}

function dogru(ad, kosul) { esit(ad, !!kosul, true); }

/* ---- 1. Resmî AWS sınama vektörleri ---- */

const CREDS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
};
const AN = new Date('2015-08-30T12:36:00Z');

const vanilla = sigv4.sign({
  method: 'GET', host: 'example.amazonaws.com', path: '/', query: {},
  headers: {}, body: '', service: 'service', region: 'us-east-1',
  contentSha256Header: false
}, CREDS, AN);

esit('get-vanilla imzalanan başlıklar',
  vanilla.authorization.match(/SignedHeaders=([^,]+)/)[1], 'host;x-amz-date');
esit('get-vanilla imzası',
  vanilla.authorization.match(/Signature=([0-9a-f]+)/)[1],
  '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');

const formPost = sigv4.sign({
  method: 'POST', host: 'example.amazonaws.com', path: '/', query: {},
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'Param1=value1', service: 'service', region: 'us-east-1',
  contentSha256Header: false
}, CREDS, AN);

esit('post-x-www-form-urlencoded imzalanan başlıklar',
  formPost.authorization.match(/SignedHeaders=([^,]+)/)[1],
  'content-type;host;x-amz-date');
esit('post-x-www-form-urlencoded imzası',
  formPost.authorization.match(/Signature=([0-9a-f]+)/)[1],
  'ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a');

/* Gövde özeti imzaya GİRİYOR: aynı istek, farklı gövde → farklı imza.
   Girmeseydi imzalı bir isteğin gövdesi değiştirilip tekrar gönderilebilirdi. */
const digerGovde = sigv4.sign({
  method: 'POST', host: 'example.amazonaws.com', path: '/', query: {},
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'Param1=value2', service: 'service', region: 'us-east-1',
  contentSha256Header: false
}, CREDS, AN);
dogru('gövde değişince imza değişiyor',
  digerGovde.authorization !== formPost.authorization);

/* S3 yolunda `x-amz-content-sha256` ZORUNLU; imzalanan kümeye girmeli. */
const s3Put = sigv4.sign({
  method: 'PUT', host: 'kova.s3.eu-central-1.amazonaws.com',
  path: '/reports/2026/10/abc.pdf', query: {},
  headers: { 'content-type': 'application/pdf' },
  body: Buffer.from('pdf'), service: 's3', region: 'eu-central-1'
}, CREDS, AN);
dogru('S3 imzası x-amz-content-sha256 içeriyor',
  /x-amz-content-sha256/.test(s3Put.authorization.match(/SignedHeaders=([^,]+)/)[1]));
esit('S3 kapsamı doğru servis ve bölge',
  /Credential=AKIDEXAMPLE\/(\S+?),/.exec(s3Put.authorization)[1],
  '20150830/eu-central-1/s3/aws4_request');

/* Anahtar yoksa imza atılmıyor — sessizce imzasız istek gitmemeli. */
let fırladı = false;
try {
  sigv4.sign({ method: 'GET', host: 'h', path: '/', query: {}, headers: {},
    body: '', service: 's3', region: 'eu-central-1' }, null, AN);
} catch (e) { fırladı = e.message === 'aws_credentials_missing'; }
dogru('anahtar yoksa aws_credentials_missing', fırladı);

/* İmzalayıcı hiçbir şey LOGLAMIYOR: gizli anahtar kaza ile çıktıya düşmemeli. */
const sigv4Src = fs.readFileSync(
  path.join(__dirname, '..', 'aws', 'lambda-scanner', 'lib', 'sigv4.js'), 'utf8');
dogru('sigv4.js içinde console çağrısı yok', !/console\./.test(sigv4Src));

/* ---- 2. Edge Function kaynağının imza sözleşmesi ---- */

const edge = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'enqueue-scan', 'index.ts'), 'utf8');

dogru('Edge Function SQS sorgu protokolünü kullanıyor',
  edge.indexOf("Action: 'SendMessage'") !== -1
  && edge.indexOf("Version: '2012-11-05'") !== -1);
dogru('Edge Function gövdeyi form olarak kodluyor',
  edge.indexOf('new URLSearchParams(') !== -1);
dogru('Edge Function content-type form-urlencoded',
  edge.indexOf("'application/x-www-form-urlencoded; charset=utf-8'") !== -1);
dogru('Edge Function content-type, host ve x-amz-date imzalıyor',
  edge.indexOf("'content-type':") !== -1
  && edge.indexOf("'host': url.host") !== -1
  && edge.indexOf("'x-amz-date': stamp") !== -1);
dogru('Edge Function kanonik sorgu dizesi boş (sorgu protokolünde her şey gövdede)',
  /'POST', url\.pathname, '', canonicalHeaders, signedHeaders, payloadHash/.test(edge));
dogru('Edge Function kapsamı sqs servisi', /\$\{day\}\/\$\{region\}\/sqs\/aws4_request/.test(edge));
dogru('Edge Function gövde özetini imzalıyor (UNSIGNED-PAYLOAD yok)',
  edge.indexOf('UNSIGNED-PAYLOAD') === -1 && edge.indexOf('await sha256Hex(payload)') !== -1);

/* Paylaşılan sır sabit zamanlı karşılaştırılıyor ve tanımsızsa uç kapalı. */
dogru('paylaşılan sır sabit zamanlı karşılaştırılıyor',
  edge.indexOf('function secretEquals') !== -1 && /fark \|= x\[i\] \^ y\[i\]/.test(edge));
dogru('sır tanımsızsa uç kapalı', /if \(!beklenen \|\| !secretEquals\(/.test(edge));

/* Kuyruğa yalnızca dört alan gidiyor: istek gövdesi Lambda'nın davranışını
   belirlemesin. */
dogru('kuyruk mesajı yalnızca url/user_id/scan_id/consent taşıyor',
  /const message = JSON\.stringify\(\{\s*url,\s*user_id: userId,\s*scan_id: scanId,\s*consent: payload\.consent === true,\s*\}\)/.test(edge));
dogru('scan_id UUID olarak doğrulanıyor', /UUID_RE\.test\(scanId\)/.test(edge));
dogru('user_id UUID olarak doğrulanıyor', /UUID_RE\.test\(userId\)/.test(edge));

/* Sır loglanmıyor. */
dogru('Edge Function sırları loglamıyor',
  !/console\.(log|error|warn)\([^)]*(secret|SECRET|SECRET_ACCESS|accessKeyId)/.test(edge));

/* ---- Sonuç ---- */
if (hatalar.length) {
  console.error('\nSigV4 sınaması: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
  hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
  process.exit(1);
}
console.log('SigV4 sınaması: ' + gecti + ' / ' + gecti + ' geçti');
