# Mobil bildirim (WORKFLOW 4)

Tarama bitip AI raporu üretildiğinde, işin sahibinin cihazlarına bir FCM
bildirimi gidiyor. Web panosu **değişmedi**: mevcut yoklamayı sürdürüyor.

## Akış

```
WORKFLOW 2 (rapor) ─┬─► WORKFLOW 3 ─► POST /api/cron/ai-report-pdf  (PDF → Storage)
                    └─► WORKFLOW 4 ─► POST /api/cron/notify         (FCM push)
```

n8n yalnızca `jobId`'yi ve `CRON_SECRET`'i taşıyor.

## Uçlar

| Uç | Kimlik | Döndürdüğü |
|---|---|---|
| `POST /api/device-token` | Oturum | `{ ok, platform }` |
| `DELETE /api/device-token` | Oturum | `{ ok, removed }` |
| `GET\|POST /api/cron/scan-jobs/pending?limit=` | `CRON_SECRET` | `{ ok, via, count, jobs: [{ jobId }] }` |
| `GET\|POST /api/cron/notify?jobId=` | `CRON_SECRET` | `{ ok, via, sent, failed, dropped }` |

## Neden n8n cihaz jetonlarını ALMIYOR

İlk tasarım `/api/cron/users/tokens?jobId=` ile jetonları n8n'e vermekti.
Bir FCM kayıt jetonu, **o cihaza bildirim gönderme yetkisidir**. Bu
değişikliğin amacı n8n'den bir kimlik bilgisini (Supabase servis rolü
anahtarı) çıkarmaktı; yerine başka bir kimlik bilgisini — müşterilerin cihaz
jetonlarını — koymak aynı yüzeyi geri açardı. Üstelik bu n8n bir dizüstü
bilgisayarda `localhost:5678`'de çalışıyor.

Bu yüzden bildirimi sunucu gönderiyor. Jetonlar veritabanı ile Vercel
arasında kalıyor; n8n'de ne Firebase kimliği ne de bir cihaz jetonu var.
Aynı gerekçeyle `/api/cron/notify`'ın yanıtı da jeton taşımıyor.

Aynı hamlede WORKFLOW 4'ün dört başlık parametresindeki
`SUPABASE_SERVICE_KEY` kalktı. Servis rolü anahtarı RLS'i **tamamen** atlar:
o anahtar n8n'de durduğu sürece n8n'i ele geçiren biri tüm müşteri verisini
okuyabilirdi. Artık n8n'in yetkisi üç cron ucuyla sınırlı.

## Neden `firebase-admin` yok

Bu depo sunucu tarafında npm bağımlılığı taşımıyor (bkz. `_lib/pdf.js`,
`aws/lambda-scanner/lib/sigv4.js`). FCM'in istediği tek şey bir OAuth2
erişim belirteci; onu da servis hesabının özel anahtarıyla imzalanmış bir
JWT karşılığında Google veriyor. RS256 imzası `node:crypto` ile atılıyor.
Sınama bunu **gerçekten koşturuyor**: üretilen bir RSA çifti ile imzalanan
JWT, açık anahtarla doğrulanıyor.

## Neden `cl_device_tokens` diye yeni bir tablo

Depoda `public.users` diye bir tablo **yok**; hesaplar Supabase'in
`auth.users`'ında. Eski WORKFLOW 4 `public.users.fcm_token` okumaya
çalışıyordu — o sütun hiç var olmadı, yani akış bugüne kadar hiçbir bildirim
gönderemezdi.

Göç: `db/2026-10-08-device-tokens.sql`. Yalnızca yeni tablo ekliyor, mevcut
hiçbir tablonun RLS'ine, sütununa ya da kısıtına dokunmuyor. Politikalar:
kullanıcı kendi cihazlarını **görebilir ve silebilir**; INSERT politikası
**yok** (jetonu sunucu yazıyor, yani kimse başkasının hesabına cihaz
bağlayamaz); `anon` için hiçbir politika yok.

Tekil indeks **tam**, kısmi değil: PostgREST'in `on_conflict=token` upsert'i
kısmi indeksi kullanamaz (42P10) — `cl_scans` ile aynı ders, bkz.
`db/2026-10-08-clscans-job-id-unique.sql`.

## Bildirim metninde ne var, ne yok

Başlık sabit: **"Tarama bitti"**. Gövde risk seviyesi ve **motorun** puanı:
_"Yüksek risk · Güvenlik puanı 58/100"_. `data` alanında `jobId` ve
`pdfKey` (`ai/<jobId>.pdf`, WORKFLOW 3'ün yazdığı yol).

**Alan adı bildirimde YOK.** Bildirim kilit ekranında, cihazın sahibi
olmayan biri de görebilir; hangi siteyi taradığı onun işi. Ayrıntı
uygulamada, `jobId` ile açılıyor. Modelin kendi puanı da girmiyor — PDF'te
olduğu gibi gösterilen sayı motorun ölçümü.

## Anonim tarama = bildirim yok

Ana sayfadaki taramaların çoğu anonim (`scan_jobs.user_id` null).
`db.deviceTokensForJob` böyle bir işte **boş** dönüyor ve
`cl_device_tokens` sorgusu hiç yapılmıyor: bir iş kimliğini tahmin eden
biri kimsenin cihazına bildirim yollatamaz. Sınamada bu, gerçek `db.js`
sahte bir PostgREST'e karşı koşturularak doğrulanıyor — uç sınamaları
`db.js`'i sapladığı için tek başına yeterli değildi.

## Ölü jetonlar

FCM `UNREGISTERED` / `NOT_FOUND` derse jeton tablodan düşüyor; yoksa her
bildirimde aynı hatayı almaya devam ederiz. Geçici hatalar (`UNAVAILABLE`,
ağ) jetonu **düşürmüyor**.

## Realtime EKLENMEDİ

Web panosu için Supabase Realtime bilerek kullanılmıyor, iki sebeple:
tarayıcıdan `wss://*.supabase.co` açmak CSP'de `connect-src`'ı dış kökene
açmak demek ve bu depoda CSP gevşetilmiyor; ayrıca anonim taramalarda
`user_id` null olduğu için RLS o satırlar için hiçbir olay yayınlayamaz.
Pano aynı köken yoklamasını sürdürüyor. Bkz. `docs/scan-queue.md`.

## Kurulum

1. Göçü uygulayın: `db/2026-10-08-device-tokens.sql`.
2. Firebase konsolundan bir **servis hesabı** anahtarı indirin ve JSON'un
   tamamını Vercel'de `FIREBASE_SERVICE_ACCOUNT` olarak tanımlayın.
3. `CRON_SECRET` zaten tanımlı olmalı (yoksa cron uçları 503 verir).
4. Mobil uygulama açılışta `POST /api/device-token { token }` çağırsın.
5. n8n'de WORKFLOW 4'ü yeniden içe aktarın ve etkinleştirin.

Doğrulama: sırsız `GET /api/cron/notify?jobId=<uuid>` **401** dönmeli.
`503 cron_unconfigured` gelirse `CRON_SECRET` yok; `503 fcm_unconfigured`
gelirse `FIREBASE_SERVICE_ACCOUNT` yok.

## Doğrulanmayanlar

`fcm.googleapis.com` ve `oauth2.googleapis.com` bu oturumun ağ ilkesiyle
erişilemez durumda: **canlı bir bildirim gönderilmedi**. İmzalama yolu
gerçek bir anahtar çiftiyle yerel olarak doğrulandı, istek gövdesi ve
adresi sınamada sabit; ama FCM'in yanıtı ilk gerçek gönderimde görülecek.
Depoda Android uygulaması da yok — `data.jobId`/`data.pdfKey` sözleşmesi
uygulama tarafında karşılanmalı.
