# n8n akışları

İçe aktarılabilir JSON'lar. n8n → **Workflows → Import from File**.

| Dosya | Ne yapıyor |
|---|---|
| `CYBERLION_2_AIAnalyst.json` | `cl-scan-done` webhook'u → `/api/cron/ai-reports` → WORKFLOW 3 |
| `CYBERLION_3_PDFReport.json` | `cl-report-pdf` webhook'u → `/api/report` → Supabase Storage |
| `CYBERLION_4_Notify.json` | `cl-notify` webhook'u → FCM push → geri çağrı |
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
| `SUPABASE_SERVICE_KEY` | Storage ve `scan_jobs`/`users` okuması |
| `FCM_PROJECT_ID`, `FCM_ACCESS_TOKEN` | WORKFLOW 4'ün push'u |

n8n'de `$env` varsayılan olarak **kapalıdır**. `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
olmadan bu akışlar adresi boş okur ve "invalid URL" verir;
`docker-compose.yml` bunu ayarlıyor.

## Bilinen eksikler — tahmin edilmedi, yazıldı

1. **WORKFLOW 3 bugün 401 döner.** `/api/report` giriş istiyor, cron sırrını
   kabul etmiyor. Sessizce bir kimlik doğrulama atlatma başlığı
   **eklenmedi**; iki dürüst seçenek var: PDF'i panodan (oturumla) indirmek,
   ya da `/api/report`'a cronauth yolu eklemek. Düğüm notunda da yazıyor.
2. **WORKFLOW 4'ün geri çağrı ucu yok.** Depoda `/api/n8n/*` diye bir şey
   yok. O düğüm 404 alır; push **zaten gitmiş** olur, yani akış bildirimi
   kaçırmıyor.
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
