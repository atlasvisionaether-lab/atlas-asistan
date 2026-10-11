// CyberLion AI — sign-report
//
// S3'teki rapor PDF'i için SÜRELİ, imzalı bir indirme adresi üretir. Dosyayı
// kendisi indirmez ve gövdesini hiç görmez; yalnızca imzayı atar.
//
// NEDEN BU ARA KATMAN
//
// `enqueue-scan` ile aynı gerekçe: AWS gizli anahtarı tek bir yerde durur,
// Supabase'in gizli değişkenleri. Alternatif, Vercel'e S3 okuma kimliği
// koymaktı; o zaman aynı anahtar iki platformda bulunur ve sızma hâlinde
// döndürülecek yer ikiye çıkardı. Vercel tarafı S3'ü tanımıyor, yalnızca bu
// işlevden bir adres isteyip tarayıcıyı 302 ile oraya yönlendiriyor.
//
// NEDEN SORGU DİZGESİNDE İMZA (presigned URL)
//
// Tarayıcı bu adrese Authorization başlığı EKLEYEMEZ: 302 sonrası isteği o
// atıyor. İmza sorgu dizgesine gömülünce adres tek başına yeterli oluyor.
// Süre KISA (varsayılan 120 sn): adres bir kez kullanılıp ölmeli, kopyalanıp
// paylaşılan kalıcı bir bağlantı olmamalı.
//
// KİMLİK DOĞRULAMA
//
// Çağıran Vercel sunucu ucudur, tarayıcı DEĞİL. Servis rolü anahtarının
// üstüne paylaşılan bir sır (`SIGN_SHARED_SECRET`) sabit zamanlı
// karşılaştırmayla doğrulanıyor. Sır `ENQUEUE_SHARED_SECRET`'ten AYRI: biri
// sızdığında öteki yetki vermemeli — kuyruğa iş bırakmak ile başkasının
// raporunu imzalatmak farklı iki yetki.
//
// SAHİPLİK BURADA DEĞİL, ÇAĞIRANDA doğrulanıyor: bu işlev yalnızca "şu
// anahtarı imzala" diyor. `/api/report-download` işi sahiplik süzgeciyle
// okuyup `report_key`'i oradan alıyor; istemci anahtar seçemiyor. Bu yüzden
// anahtar biçimi burada da ayrıca doğrulanıyor (bkz. isReportKey).
//
// HİÇBİR SIR LOGLANMAZ. Hata yollarında yalnızca kısa kodlar yazılır.
//
// GİZLİ DEĞİŞKENLER (Supabase > Edge Functions > Secrets; depoda DURMAZ)
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — yalnızca s3:GetObject izni
//   S3_BUCKET          — cyberlionai-reports
//   S3_REGION          — eu-central-1 (verilmezse AWS_REGION, sonra eu-central-1)
//   SIGN_SHARED_SECRET — Vercel'deki aynı değer

const ALGORITHM = 'AWS4-HMAC-SHA256';
const DEFAULT_EXPIRES = 120;
const MAX_EXPIRES = 300;

/* Lambda'nın ürettiği anahtar biçimi: reports/<yıl>/<ay>/<uuid>.pdf
   (bkz. aws/lambda-scanner/lib/s3.js → reportKey). Serbest bir yol kabul
   edilmiyor: çağıran hatalı bir değer geçirse bile kovada başka bir nesne
   imzalanamaz. */
const KEY_RE = /^reports\/[0-9]{4}\/[0-9]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

const encoder = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

/** Sabit zamanlı karşılaştırma (bkz. enqueue-scan'deki aynı gerekçe). */
function secretEquals(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let fark = 0;
  for (let i = 0; i < x.length; i++) fark |= x[i] ^ y[i];
  return fark === 0;
}

function isReportKey(key: unknown): boolean {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** Her yol parçası ayrı ayrı kodlanır; '/' ayırıcı olarak KORUNUR. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/**
 * S3 GET isteği için süreli imzalı adres üretir.
 *
 * Gövde özeti `UNSIGNED-PAYLOAD`: sorgu dizgesi imzalı adreslerde S3'ün
 * beklediği değer bu ve GET'in gövdesi yok.
 */
async function presignGet(
  bucket: string, region: string, key: string, expiresIn: number,
  accessKeyId: string, secretAccessKey: string, sessionToken?: string
): Promise<string> {
  const host = bucket + '.s3.' + region + '.amazonaws.com';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = dateStamp + '/' + region + '/s3/aws4_request';

  /* Kanonik sorgu parametreleri ADA GÖRE SIRALI olmak zorunda; sıra bozulursa
     imza S3'ün hesapladığıyla eşleşmez. */
  const params: [string, string][] = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', accessKeyId + '/' + scope],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host']
  ];
  if (sessionToken) params.push(['X-Amz-Security-Token', sessionToken]);
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const canonicalQuery = params
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');

  const canonicalRequest = [
    'GET',
    '/' + encodeKey(key),
    canonicalQuery,
    'host:' + host + '\n',
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [
    ALGORITHM, amzDate, scope, await sha256Hex(canonicalRequest)
  ].join('\n');

  const kDate = await hmac(encoder.encode('AWS4' + secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));

  return 'https://' + host + '/' + encodeKey(key)
    + '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

function reddet(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code: code } }), {
    status: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reddet('method_not_allowed', 405);

  const beklenen = Deno.env.get('SIGN_SHARED_SECRET');
  /* Sır tanımlı değilse uç KAPALI. Açık bırakmak, servis rolü anahtarını
     bilen herkesin rapor imzalatabilmesi demekti. */
  if (!beklenen) return reddet('not_configured', 503);

  const gelen = req.headers.get('x-cl-sign-secret') || '';
  if (!secretEquals(gelen, beklenen)) return reddet('forbidden', 403);

  const bucket = Deno.env.get('S3_BUCKET');
  const region = Deno.env.get('S3_REGION') || Deno.env.get('AWS_REGION') || 'eu-central-1';
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
  const sessionToken = Deno.env.get('AWS_SESSION_TOKEN') || undefined;
  if (!bucket || !accessKeyId || !secretAccessKey) return reddet('not_configured', 503);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch (_e) {
    return reddet('bad_request', 400);
  }

  const key = payload.report_key;
  if (!isReportKey(key)) return reddet('bad_report_key', 400);

  const istenen = parseInt(String(payload.expires_in || ''), 10);
  const expiresIn = istenen > 0 ? Math.min(istenen, MAX_EXPIRES) : DEFAULT_EXPIRES;

  let url: string;
  try {
    url = await presignGet(
      bucket, region, key as string, expiresIn,
      accessKeyId, secretAccessKey, sessionToken);
  } catch (_e) {
    /* İmzalama yerel bir işlem; buraya düşmek yapılandırma hatası demek.
       Hata metni DÖNMÜYOR: kova adı ve anahtar sızabilirdi. */
    return reddet('sign_failed', 500);
  }

  return new Response(JSON.stringify({ url: url, expiresIn: expiresIn }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
});
