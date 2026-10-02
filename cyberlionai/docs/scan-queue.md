# Asenkron tarama: SQS + Lambda + S3

Bu belge iskeletin ne yaptığını, neyin **kodda bitmiş** olduğunu ve neyin
**elle bir kez yapılması** gerektiğini ayırır. Kod yayına çıktığında akış
değişmez: kuyruk `SCAN_QUEUE_ENABLED` açılmadan devreye girmez.

## Akış

```
tarayıcı
   │ POST /api/enqueue-scan    { url }   ← ana sayfanın kullandığı uç
   │ POST /api/scan            { url }   ← eski sözleşme, 202 + jobId
   ▼
Vercel (iki uç)                IP hız sınırı + ücretsiz kota (aynı kovalar)
   │                           _lib/queuestart.js: TEK uygulama
   │                           scan_jobs satırı açar → status 'pending'
   │ POST /functions/v1/enqueue-scan
   ▼
Supabase Edge Function          AWS SigV4 imzası (anahtar YALNIZCA burada)
   │ SendMessage
   ▼
AWS SQS  cyberlionai-scan-queue
   │
   ▼
AWS Lambda  cyberlionai-scan-worker   (Node 20, bağımlılık yok)
   ├── status 'running' + current_step/progress (ilerleme çubuğu bunu okur)
   ├── scanSite()  ← api/_lib/scanner.js'in KENDİSİ (build.sh kopyalar)
   ├── scan_findings yazar (önce eski bulguları siler → tekrar teslimde çift kayıt yok)
   ├── PDF üretir → S3 cyberlionai-reports  (özel kova, AES256)
   └── status 'completed' + score + report_url/report_key

tarayıcı  GET /api/scan-status?id=<jobId>   her 2 sn, en çok 60 tur (2 dk)

tarayıcı  GET /api/report-download?id=<jobId>
   │                           sahiplik süzgeci (hesap VEYA anonim oturum)
   │ POST /functions/v1/sign-report   (report_key, DB'den)
   ▼
Supabase Edge Function          süreli imzalı S3 adresi (varsayılan 120 sn)
   │ 302
   ▼
tarayıcı → S3'ten PDF
```

### İki uç, tek uygulama

Kuyruklu taramanın iki istemcisi var ve ikisi de yayında:

| Uç | Yanıt | Kullanan |
|---|---|---|
| `POST /api/enqueue-scan` | **200** + `{ scanId }` | ana sayfa tarama kutusu |
| `POST /api/scan` | **202** + `{ jobId, statusUrl, quota }` | eski sözleşme (`API.startScan`) |

Adımların kendisi **tek yerde**: `api/_lib/queuestart.js`. Hedef doğrulama,
satır açma, kuyruğa bırakma, kota iadesi ve `'queued'` yazımı iki uçta da
aynı kodla yürüyor; uçlar yalnızca yanıt biçiminde ayrışıyor. Ayrı ayrı
dursalardı biri düzeltilip öteki unutulurdu.

Kuyruk **kapalıyken** `/api/enqueue-scan` **404** döner. Bu bir kaza değil,
istemcinin sözleşmesi: 404 görünce eşzamanlı `/api/scan`'e düşüyor. O yüzden
404, hız sınırından ve **kotadan önce** veriliyor — geri düşülecek istek hak
harcarsa tek tarama iki hak yerdi.

İstemci sonucu `/api/scan-status?id=` üzerinden yokluyor. `/api/scan/<id>`
diye bir uç **yok ve hiç olmadı**; istemci önce oraya soruyordu ve her istek
404 dönüyordu (yoklama döngüsü hatayı yutuyor, sınır dolunca tarama eşzamanlı
yola düşüyordu).

### Yeniden deneme penceresinde durum

Yeniden denenebilir bir hatada (`timeout`, `unreachable`, `db_unreachable`,
`s3_unreachable` …) iş satırına **terminal `'failed'` yazılmaz**: mesaj SQS'e
geri veriliyor ve istemci bu arada durumu yokluyor; `'failed'` görürse
çalışmaya devam eden —büyük olasılıkla başarıyla bitecek— bir taramayı
başarısız sanar. Satır `'queued'`a geri alınır, hata kodu teşhis için
yazılır, `completed_at` boş bırakılır. `'failed'` ancak teslim hakkı
tükendiğinde (`maxReceiveCount`) ya da hata hiç yeniden denenmeyecek
türdense yazılır. Karar `aws/lambda-scanner/lib/message.js` →
`retryDecision` içinde ve sınanıyor.

## Neden Realtime değil, yoklama

İstek "Realtime ile polling" diyordu. Realtime bu akışta **ana kullanımı
taşıyamaz**:

1. Tarayıcıdan `wss://<proje>.supabase.co` açmak, CSP'de `connect-src`'ı dış
   bir kaynağa açmak demek. Bu depoda CSP gevşetmemek açık bir karar.
2. `scan_jobs` üzerindeki RLS yalnızca `auth.uid() = user_id` satırlarını
   okutuyor. Ana sayfadaki taramaların çoğu **anonim** (`user_id` null) ve
   yayınlanan anahtarla hiç okunamaz. Realtime bu satırlar için hiçbir olay
   yayınlayamaz.
3. Realtime ayrıca tabloyu `supabase_realtime` yayınına eklemeyi gerektirir
   (ek DDL) ve RLS'i okuma tarafında gevşetmeden anonim akış çalışmaz.

Aynı köken üzerinden yoklama hem CSP'ye dokunmuyor hem anonim oturumda
çalışıyor. `/api/scan-status` sahiplik süzgecini sorgunun içinde uyguluyor:
hesap varsa `user_id`, yoksa `session_id`.

Giriş yapmış kullanıcılar için Realtime sonradan **ek** olarak açılabilir
(yoklamanın yerine değil); o zaman CSP'ye `connect-src wss://...` eklenmesi
bilinçli bir karar olarak ayrıca verilir.

## CSP

**Yeni bir hash gerekmedi ve yeni bir `connect-src` hedefi eklenmedi.**

- CSP `sha256-...` değerleri **satır içi script**'leri kapsar, uç adreslerini
  değil. Bir dış adres `connect-src` girdisidir, hash değil.
- Tarayıcı SQS ile **hiç konuşmuyor**: mesajı Edge Function bırakıyor. Yoklama
  da aynı köken (`/api/scan-status`), yani `'self'` zaten kapsıyor.
- `index.html` içindeki satır içi script değiştiği için o bloğun hash'i
  yenilendi (`tools/csp-hashes.py`). Eski hash silinmedi — betik listeyi
  bütünüyle yeniden yazıyor, elle silme/ekleme yok.

`tools/scanqueue-test.js` `connect-src`'ın tam değerini sabitliyor: ileride
biri `amazonaws.com` ya da `wss://` eklerse CI'da düşer.

## Elle yapılacaklar (bir kez)

Bu kaplar AWS'de **oluşturulmadı**: bu oturumda AWS kimliği ve AWS aracı yok.
Aşağıdakiler konsolda ya da `aws` CLI ile uygulanır.

### 1. SQS kuyruğu

```bash
# Önce ölü mesaj kuyruğu: üç kez başarısız olan mesaj sonsuza kadar dönmesin.
aws sqs create-queue --region eu-central-1 \
  --queue-name cyberlionai-scan-dlq

DLQ_ARN=$(aws sqs get-queue-attributes --region eu-central-1 \
  --queue-url "$(aws sqs get-queue-url --region eu-central-1 \
    --queue-name cyberlionai-scan-dlq --query QueueUrl --output text)" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# VisibilityTimeout, Lambda'nın zaman aşımından BÜYÜK olmalı (90 > 60):
# küçük olsa aynı mesaj iş hâlâ sürerken ikinci kez teslim edilirdi.
aws sqs create-queue --region eu-central-1 \
  --queue-name cyberlionai-scan-queue \
  --attributes "{\"VisibilityTimeout\":\"90\",\"MessageRetentionPeriod\":\"86400\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"
```

### 2. S3 kovası

```bash
aws s3api create-bucket --bucket cyberlionai-reports \
  --region eu-central-1 \
  --create-bucket-configuration LocationConstraint=eu-central-1

# Herkese açık erişim KAPALI. Raporlar bulgu kanıtı taşıyor.
aws s3api put-public-access-block --bucket cyberlionai-reports \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

aws s3api put-bucket-encryption --bucket cyberlionai-reports \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-bucket-policy --bucket cyberlionai-reports \
  --policy file://aws/iam/s3-bucket-policy.json
```

### 3. Lambda

```bash
cd cyberlionai/aws/lambda-scanner && ./build.sh     # scanner.zip üretir (~1 MB)

aws lambda create-function --region eu-central-1 \
  --function-name cyberlionai-scan-worker \
  --runtime nodejs20.x --handler index.handler \
  --timeout 60 --memory-size 1024 \
  --role arn:aws:iam::<HESAP>:role/cyberlionai-scan-worker-role \
  --zip-file fileb://scanner.zip

# AWS kimliği ortam değişkeniyle VERİLMEZ: görev rolü kullanılır.
aws lambda update-function-configuration --region eu-central-1 \
  --function-name cyberlionai-scan-worker \
  --environment 'Variables={SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,S3_BUCKET=cyberlionai-reports}'

# BatchSize 1: bir taramanın yavaşlaması diğerlerini bekletmesin.
aws lambda create-event-source-mapping --region eu-central-1 \
  --function-name cyberlionai-scan-worker \
  --event-source-arn arn:aws:sqs:eu-central-1:<HESAP>:cyberlionai-scan-queue \
  --batch-size 1 --function-response-types ReportBatchItemFailures
```

Rol izinleri: `aws/iam/lambda-role-policy.json`.
Kuyruğa iş bırakan IAM kullanıcısının izni: `aws/iam/enqueue-user-policy.json`
(tek izin: `sqs:SendMessage`).

### 4. Veritabanı göçü

Üç göç dosyası canlı Supabase'de **bu sırayla** koşulmalı:
`db/migrations/007_scan_jobs_progress.sql` (status kısıtının tek sahibi),
`db/2026-10-02-scan-queue.sql`, `db/2026-10-02-clscans-job-link.sql`.
Hiçbiri RLS'e dokunmuyor,
yeni policy eklemiyor: yazma yalnızca servis rolünde kalıyor. Eklediği
sütunlar: `session_id`, `report_url`, `report_key`, `queued_at`, `error_code`,
`attempts`; `status` kontrolüne `'queued'` ekliyor.

Doğrulama:

```sql
select column_name from information_schema.columns
 where table_name = 'scan_jobs'
   and column_name in ('session_id','report_url','report_key','queued_at','error_code','attempts');
-- 6 satır beklenir

select pg_get_constraintdef(oid) from pg_constraint
 where conname = 'scan_jobs_status_check';
-- 'queued' listede görünmeli
```

### 5. Edge Function

```bash
cd cyberlionai && supabase functions deploy enqueue-scan

supabase secrets set \
  AWS_ACCESS_KEY_ID=... \
  AWS_SECRET_ACCESS_KEY=... \
  SQS_URL=https://sqs.eu-central-1.amazonaws.com/<HESAP>/cyberlionai-scan-queue \
  SQS_REGION=eu-central-1 \
  ENQUEUE_SHARED_SECRET=<rastgele 32 bayt>
```

Bu depoda Deno yok, yani Edge Function **çalıştırılarak sınanamadı**. İmza
algoritması Node tarafında AWS'in resmî `get-vanilla` ve
`post-x-www-form-urlencoded` vektörleriyle doğrulandı; Deno kaynağının aynı
sözleşmeyi kurduğu `tools/sigv4-test.js` ile yapı olarak denetleniyor. Canlı
imza bir kez elle doğrulanmalı:

```bash
supabase functions invoke enqueue-scan \
  --header "x-cl-enqueue-secret: <ENQUEUE_SHARED_SECRET>" \
  --data '{"url":"https://ornek.com/","user_id":null,"scan_id":"<gerçek bir scan_jobs id>"}'
# 202 beklenir; sonra kuyrukta mesaj görünmeli:
aws sqs get-queue-attributes --region eu-central-1 \
  --queue-url <SQS_URL> --attribute-names ApproximateNumberOfMessages
```

### 6. Vercel ortam değişkenleri

| Değişken | Nerede | Not |
|---|---|---|
| `ENQUEUE_SHARED_SECRET` | Vercel + Supabase | iki tarafta **aynı** değer |
| `SCAN_QUEUE_ENABLED` | Vercel | **en son** `true` yapılır |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel | zaten var |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SQS_URL` | **yalnızca Supabase** | Vercel'e girilmez |
| `S3_BUCKET`, `SUPABASE_*` | Lambda | AWS kimliği girilmez (görev rolü) |
| `SIGN_SHARED_SECRET` | Vercel + Supabase | iki tarafta **aynı** değer; `ENQUEUE_SHARED_SECRET`'ten **farklı** olmalı |
| `SQS_MAX_RECEIVE_COUNT` | Lambda (isteğe bağlı) | kuyruğun `maxReceiveCount` değeriyle **aynı** olmalı; verilmezse 3 varsayılır |

`SQS_MAX_RECEIVE_COUNT` neden gerekiyor: Lambda, işi hangi teslimde terminal
`'failed'` yazacağına buna bakarak karar veriyor. Redrive ilkesindeki değer
3'ten farklı yapılırsa bu değişken de güncellenmeli, yoksa iş DLQ'ya giderken
satır `'queued'` kalır (kullanıcı sonsuza kadar yoklar) ya da erken `'failed'`
yazılır.

`AWS_ACCESS_KEY` adı istenmişti; AWS'in kendi adı `AWS_ACCESS_KEY_ID` ve
Lambda çalışma ortamı bu adı kendisi kullanıyor. Farklı bir ad koymak,
üç yerde iki ayrı isimle aynı anahtarı taşımak olurdu.

## Açma sırası

Bayrak **en son** açılır, çünkü açıldığı an ana sayfadaki tarayıcı kuyruğa
bağımlı hâle gelir:

1. Göç koşulur (adım 4). `db/migrations/007_scan_jobs_progress.sql` **önce**
   uygulanmış olmalı: `progress` ve `current_step` sütunları ile `status`
   kısıtının tek sahibi o dosya.
2. SQS, S3, Lambda ayağa kalkar (1–3), event source mapping etkin.
3. Edge Function dağıtılır ve `invoke` ile 202 alınır (5).
4. Bir `scan_jobs` satırı elle açılıp kuyruğa bırakılır; Lambda'nın satırı
   `completed` yaptığı ve `report_url` yazdığı görülür.
5. **Ancak o zaman** Vercel'de `SCAN_QUEUE_ENABLED=true`, Preview'da doğrulanır,
   sonra Production.

Geri alma: `SCAN_QUEUE_ENABLED`'ı silmek yeter. Kod eşzamanlı yola döner,
kuyrukta kalan işler Lambda tarafından yine bitirilir.

## Bayrağı açmadan önce

Adım adım sınama planı ayrı bir belgede: `docs/scan-queue-preview-test.md`.
Önkoşullar, Preview'da koşulacak 30'dan fazla ölçüt, hata yolları ve geri alma
koşulları orada.

## Bilinen eksikler

- **Pro 50 tarama kotası** hâlâ uygulanmıyor (Faz 6; bilinçli).
- ~~S3 raporu için imzalı indirme ucu yok.~~ **Kapandı:**
  `/api/report-download?id=<jobId>` sahipliği hesap VEYA anonim oturum
  üzerinden kuruyor, `report_key`'i işin satırından okuyor (istemci nesne
  seçemez) ve `sign-report` Edge Function'ın ürettiği süreli imzalı adrese 302
  ile yönlendiriyor. İmza Supabase'de atılıyor: AWS anahtarı Vercel'e
  girmiyor. Adres yanıt gövdesinde dönmüyor ve varsayılan ömrü 120 saniye.
- **S3'teki PDF yalnızca Türkçe.** Lambda raporu `tr` ile üretiyor. Oturum
  açık kullanıcıya seçilen dilde rapor `/api/report?jobId=` üzerinden
  veriliyor; anonim kullanıcı Türkçe kopyayı iniyor. Dil başına nesne üretmek
  ayrı bir iş.
- ~~Anonim kuyruk taramasında ana sayfadaki PDF düğmesi gizli.~~ **Kapandı:**
  düğme `/api/report-download?id=` ucuna gidiyor; o uç anonim oturumu da sahip
  sayıyor (sahiplik `user_id` VEYA `session_id`). Oturum açıkken dil duyarlı
  `/api/report?jobId=` tercih ediliyor.
- ~~Eşzamanlı yol `cl_scans`'e yazıyor, kuyruk yolu yazmıyor.~~ **Kapandı:**
  Lambda taramayı bitirirken satırı kendisi açıyor (`lib/clscan.js`; alan
  kümesi `db.saveScan()` ile aynı ve sınamada karşılaştırılıyor). Tekrar
  teslimde harita aynı taramayı iki kez saymasın diye `scan_job_id` üzerinde
  TAM bir tekil indeks var ve yazım `resolution=ignore-duplicates` ile
  yapılıyor (göç: `db/2026-10-02-clscans-job-link.sql`). Yazım başarısız
  olursa tarama yine `completed` yazılıyor: haritadaki eksik bir satır,
  kullanıcının kaybettiği bir tarama kadar pahalı değil.
