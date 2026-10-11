// CyberLion AI — enqueue-scan
//
// Taranacak hedefi AWS SQS kuyruğuna bırakır. Taramayı KENDİSİ yapmaz.
//
// NEDEN BU ARA KATMAN
//
// AWS gizli anahtarı tek bir yerde durur: Supabase'in gizli değişkenleri.
// Vercel tarafı SQS'i hiç tanımaz, yalnızca bu işlevi çağırır. Anahtar iki
// platformda birden bulunmadığı için döndürülecek yer de tek.
//
// KİMLİK DOĞRULAMA
//
// Çağıran Vercel sunucu ucudur, tarayıcı DEĞİL. Supabase işlev ucu varsayılan
// olarak `Authorization` ister; servis rolü anahtarıyla çağrılıyor. Ayrıca
// paylaşılan bir sır (`ENQUEUE_SHARED_SECRET`) sabit zamanlı karşılaştırmayla
// doğrulanıyor: yayınlanan anon anahtarını bilen biri bu uca iş bırakamasın.
//
// HİÇBİR SIR LOGLANMAZ. Hata yollarında yalnızca kısa kodlar yazılır.
//
// GİZLİ DEĞİŞKENLER (Supabase > Edge Functions > Secrets; depoda DURMAZ)
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — yalnızca sqs:SendMessage izni
//   SQS_URL            — https://sqs.eu-central-1.amazonaws.com/<hesap>/cyberlionai-scan-queue
//   SQS_REGION         — eu-central-1 (verilmezse SQS_URL'den çıkarılır)
//   ENQUEUE_SHARED_SECRET — Vercel'deki aynı değer

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Sabit zamanlı karşılaştırma. `===` ile kıyaslamak sırrı uzunluk ve ilk
    ayrışan bayt üzerinden ölçülebilir hâle getirirdi. */
function secretEquals(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let fark = 0;
  for (let i = 0; i < x.length; i++) fark |= x[i] ^ y[i];
  return fark === 0;
}

/**
 * SQS'e form kodlu `Action=SendMessage` isteği imzalar ve gönderir.
 *
 * Sorgu protokolü (JSON protokolü değil) kullanılıyor: imzaya giren gövde
 * düz bir form dizesi, yani imzalanan baytlar ile gönderilen baytlar
 * birebir aynı ve yeniden üretilebilir. AWS'in `post-x-www-form-urlencoded`
 * sınama vektörü de bu biçim üzerinden doğrulanıyor.
 */
async function sendMessage(queueUrl: string, region: string, body: string): Promise<void> {
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID') ?? '';
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? '';
  if (!accessKeyId || !secretAccessKey) throw new Error('aws_credentials_missing');

  const url = new URL(queueUrl);
  const payload = new URLSearchParams({
    Action: 'SendMessage',
    Version: '2012-11-05',
    MessageBody: body,
  }).toString();

  const stamp = new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  const day = stamp.slice(0, 8);
  const payloadHash = await sha256Hex(payload);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    'host': url.host,
    'x-amz-date': stamp,
  };
  const sessionToken = Deno.env.get('AWS_SESSION_TOKEN');
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    'POST', url.pathname, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const scope = `${day}/${region}/sqs/aws4_request`;
  const stringToSign = [
    ALGORITHM, stamp, scope, await sha256Hex(canonicalRequest),
  ].join('\n');

  let key: ArrayBuffer | Uint8Array = encoder.encode(`AWS4${secretAccessKey}`);
  for (const part of [day, region, 'sqs', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, stringToSign));

  headers['authorization'] = `${ALGORITHM} Credential=${accessKeyId}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(queueUrl, { method: 'POST', headers, body: payload });
  if (!response.ok) {
    // Gövde SQS'in XML hatası; kuyruk adresi taşıdığı için loglanmıyor.
    console.error('sqs send failed', response.status);
    throw new Error('sqs_send_failed');
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json(405, { error: { code: 'method_not_allowed' } });
  }

  const beklenen = Deno.env.get('ENQUEUE_SHARED_SECRET') ?? '';
  const gelen = req.headers.get('x-cl-enqueue-secret') ?? '';
  // Sır TANIMLI DEĞİLSE uç kapalıdır. Açık bırakmak, yapılandırma eksikken
  // herkesin iş bırakabildiği bir kuyruk demek olurdu.
  if (!beklenen || !secretEquals(beklenen, gelen)) {
    return json(401, { error: { code: 'unauthorized' } });
  }

  const queueUrl = Deno.env.get('SQS_URL') ?? '';
  if (!queueUrl) return json(503, { error: { code: 'queue_unconfigured' } });
  const region = Deno.env.get('SQS_REGION')
    ?? (queueUrl.match(/^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\//)?.[1] ?? '');
  if (!region) return json(503, { error: { code: 'queue_unconfigured' } });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: { code: 'bad_request' } });
  }

  const scanId = String(payload.scan_id ?? '');
  const url = String(payload.url ?? '');
  if (!UUID_RE.test(scanId)) return json(400, { error: { code: 'bad_scan_id' } });
  if (!url || url.length > 2048) return json(400, { error: { code: 'bad_url' } });

  const userId = payload.user_id == null ? null : String(payload.user_id);
  if (userId !== null && !UUID_RE.test(userId)) {
    return json(400, { error: { code: 'bad_user_id' } });
  }

  // Kuyruğa giden gövde SADECE bu dört alan. İstemciden gelen başka hiçbir
  // alan taşınmıyor: Lambda'nın ne yapacağını istek gövdesi belirlemesin.
  const message = JSON.stringify({
    url,
    user_id: userId,
    scan_id: scanId,
    consent: payload.consent === true,
  });

  try {
    await sendMessage(queueUrl, region, message);
  } catch (err) {
    console.error('enqueue failed', (err as Error).message);
    return json(502, { error: { code: 'enqueue_failed' } });
  }

  return json(202, { ok: true, scan_id: scanId });
});
