# n8n akışları

İçe aktarılabilir JSON'lar. n8n → **Workflows → Import from File**.

| Dosya | Ne yapıyor |
|---|---|
| `CYBERLION_2_AIAnalyst.json` | `cl-scan-done` webhook'u → `/api/cron/ai-reports` → WORKFLOW 3 |
| `CYBERLION_3_PDFReport.json` | `cl-report-pdf` webhook'u → `/api/cron/ai-report-pdf` (PDF üret + Storage'a koy) |
| `CYBERLION_4_Notify.json` | `cl-notify` webhook'u → `/api/cron/notify` (FCM push) |
| `CYBERLION_5_DailyCron.json` | Her gün 09:00 → haftalık tarama + eksik AI raporları |

WORKFLOW 1 (ScanGateway) burada **yok**: elimizde orijinal dosya olmadığı için
yeniden yazmak, çalışan bir akışı tahminle değiştirmek olurdu. Mevcut
WORKFLOW 1'in yapması gereken tek değişiklik, tarama bitince
`POST {N8N_WEBHOOK_BASE}/webhook/cl-scan-done` gövdesiyle `{ "jobId": "<uuid>" }`
göndermek.

## Ortam değişkenleri

Akışlarda **hiçbir sır gömülü değil**; hepsi `$env` ile okunuyor, yani
JSON'ları paylaşmak bir sır sızdırmıyor. n8n'i bu değişkenlerle başlatın
(`docker-compose.yml` hepsini `.env`'den geçiriyor):

| Değişken | Ne için |
|---|---|
| `N8N_API_BASE` | CyberLion API'nin kökü, örn. `https://www.cyberlionai.com` |
| `CL_CRON_SECRET` | Vercel'deki `CRON_SECRET` ile **aynı** değer |
| `N8N_WEBHOOK_BASE` | n8n'in kendi dışa açık adresi (akışların birbirini çağırması için) |
| `SUPABASE_URL` | Supabase projesi |
| ~~`SUPABASE_SERVICE_KEY`~~ | **ARTIK HİÇBİR AKIŞTA GEREKMİYOR.** Varsa silin. |
| ~~`FCM_PROJECT_ID`, `FCM_ACCESS_TOKEN`~~ | **Gerekmiyor:** bildirimi sunucu gönderiyor. |

n8n'de `$env` varsayılan olarak **kapalıdır**. `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
olmadan bu akışlar adresi boş okur ve "invalid URL" verir;
`docker-compose.yml` bunu ayarlıyor.

## Bilinen eksikler — tahmin edilmedi, yazıldı

1. ~~**WORKFLOW 3 bugün 401 döner.**~~ **Düzeltildi.** `/api/report` giriş
   istiyor ve cron sırrını kabul etmiyor; doğru düzeltme o uca bir makine
   yolu açmak **değildi** (bu bir kimlik doğrulama atlatması olurdu, aynı
   gerekçeyle `/api/ai-report` için de reddedilmişti). Onun yerine
   `_lib/cronauth.js` ile yetkilenen ayrı bir uç eklendi:
   `POST /api/cron/ai-report-pdf?jobId=<uuid>`. Uç PDF'i kendisi üretiyor
   (`api/_lib/report-ai.js`) ve gizli `reports` kovasına `ai/<jobId>.pdf`
   olarak koyuyor, yani **servis rolü anahtarı artık n8n'de durmuyor**.
   Yanıtı müşteri verisi taşımıyor: `{ ok, via, bucket, key, bytes }`.
   `404 no_ai_report`, WORKFLOW 2'nin raporu henüz üretmediği anlamına gelir
   ve akış bunu "beklemede" olarak bitirir.
2. ~~**WORKFLOW 4'ün geri çağrı ucu yok.**~~ **Düzeltildi** — ve akış
   baştan yazıldı. Eski hâli `SUPABASE_SERVICE_KEY` ile doğrudan
   PostgREST'ten okuyup `public.users.fcm_token` arıyordu; o sütun bu
   depoda **hiç var olmadı**, yani akış bugüne kadar hiçbir bildirim
   gönderemezdi. Artık tek bir uca gidiyor:
   `POST /api/cron/notify?jobId=<uuid>`, yalnızca `CL_CRON_SECRET` ile.
   Jetonları sunucu okuyor ve bildirimi sunucu gönderiyor, yani **n8n'de
   ne servis rolü anahtarı ne de bir cihaz jetonu kalıyor**. Geri çağrıya
   da gerek kalmadı: web panosu mevcut yoklamasını sürdürüyor (Realtime
   bilerek eklenmedi). Ayrıntı: [`docs/notifications.md`](../docs/notifications.md).
3. **Akışlar `active: false`** geliyor. Webhook'ları ve cron'u siz
   etkinleştirin: kapalı bir akışın webhook'u yalnızca "Execute workflow"
   bastığınızda, bir kez dinler — test modunun bir kez tetiklenmesi tam
   olarak bu.

## Neden n8n NVIDIA'yı doğrudan çağırmıyor

İki sebep. Biri: bu n8n sizin Windows makinenizde `localhost:5678`'de
çalışıyor, üretimi karşılayamaz — makine kapanınca akış durur. İkisi:
`NVIDIA_API_KEY`'in iki yerde durması iki sızıntı yüzeyi demek. Anahtar
yalnızca Vercel'de; n8n yalnızca "üret" diyor. Ayrıntı:
[`docs/ai-analyst.md`](../docs/ai-analyst.md).
