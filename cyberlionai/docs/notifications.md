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
4. Mobil uygulama açılışta `POST /api/device-token { token, platform }` çağırsın;
   istemci parçası `mobile/flutter/` altında hazır (bkz. aşağıdaki bölüm).
5. n8n'de WORKFLOW 4'ü yeniden içe aktarın ve etkinleştirin.

Doğrulama: sırsız `GET /api/cron/notify?jobId=<uuid>` **401** dönmeli.
`503 cron_unconfigured` gelirse `CRON_SECRET` yok; `503 fcm_unconfigured`
gelirse `FIREBASE_SERVICE_ACCOUNT` yok.

## Mobil istemci ve Bearer yolu

İstemci parçası `mobile/flutter/` altında: `lib/services/push_token_service.dart`
(izin isteme, `getToken`, `onTokenRefresh`, açılışta POST, çıkışta DELETE) ve
üç satırlık `pubspec.example.yaml`. **Bu bir uygulama değil**, bir uygulamaya
kopyalanmak üzere duran iki dosya: depoda mobil uygulama yok ve bu kapta
Android/iOS SDK'sı yok, yani kod derlenip çalıştırılamadı.

`/api/device-token` artık çerezin yanında
`Authorization: Bearer <supabase access_token>` da kabul ediyor — mobilde
tarayıcı çerezi kavramı yok. Bu bir yetki atlatması değil:

* Gelen belirteç GoTrue'nun `/auth/v1/user` ucuna sorulup doğrulanıyor; çerez
  yolundaki ile **aynı** kimlik denetimi işliyor. Paylaşılan bir sır, bir
  başlık hilesi ya da ikinci bir yetki kaynağı eklenmedi.
* Bayrak uç uca opt-in (`resolveUser(req, res, { bearerKabul: true })`) ve
  YALNIZCA bu uçta açık; `_lib/auth.js`'i kullanan diğer uçların yüzeyi
  değişmedi. Sınama bunu dosya listesiyle kilitliyor.
* Çerez varsa **çerez kazanır**: bir XSS, çalınmış bir belirteci başlıkta
  deneyip tarayıcı oturumunu ezemez.
* Bearer yolunda yenileme belirteci hiç okunmuyor ve `Set-Cookie` yazılmıyor:
  belirteç dolunca uç 401 döner, oturumu uygulama kendi SDK'sı ile tazeler.

Doğrulama `tools/devicetoken-mobile-test.js` (68 doğrulama): adres, başlıklar,
gövde alanları ve platform kümesi **Dart kaynağından okunup** gerçek handler'a
geçiriliyor, `_lib/auth.js` saplanmıyor (sahte GoTrue). Yani "istemci ile
sunucu aynı şeyi konuşuyor" sınanmış; "uygulama derleniyor" sınanmamış.
On mutasyonun onu yakalandı.

İstemci yapılandırması `--dart-define=CL_API_BASE` (ve web hedefi için
`CL_VAPID_KEY`) ile geliyor. `NEXT_PUBLIC_*` değişkeni eklenmedi: bu depoda
Next.js yok, site düz HTML + Vercel fonksiyonları.

### Uçtan uca akış

Uygulama tarafında üç an var: açılış, jeton yenilenmesi, çıkış.

```dart
// main.dart — oturum açıldıktan sonra bir kez.
final push = PushTokenService(
  // Belirteç saklanmıyor; her istekte oturum katmanından tazesi isteniyor.
  accessToken: () async =>
      Supabase.instance.client.auth.currentSession?.accessToken,
);

// İzin ister, FirebaseMessaging.instance.getToken() ile jetonu alır,
// POST /api/device-token ile hesaba bağlar ve onTokenRefresh'i dinlemeye
// başlar; yenilenen jeton kendiliğinden yeniden gönderilir.
await push.baslat();
```

```dart
// Çıkış — DELETE, signOut'tan ÖNCE.
await push.cikistaSil();
await Supabase.instance.client.auth.signOut();
```

Sıra önemli: istek oturumla yetkileniyor. Belirteç gittikten sonra uç 401
döner, kayıt silinmez ve kullanıcı çıktıktan sonra da bildirim alır.

Doğrudan çağırmak isteyen için aynı sözleşme:

```
# Kaydet (mobil yol: Bearer)
curl -i -X POST https://www.cyberlionai.com/api/device-token \
  -H "Authorization: Bearer <supabase access_token>" \
  -H "Content-Type: application/json" \
  -d '{"token":"<fcm jetonu>","platform":"android"}'
# → 200 {"ok":true,"platform":"android"}

# Sil (çıkışta)
curl -i -X DELETE https://www.cyberlionai.com/api/device-token \
  -H "Authorization: Bearer <supabase access_token>" \
  -H "Content-Type: application/json" \
  -d '{"token":"<fcm jetonu>"}'
# → 200 {"ok":true,"removed":1}
```

Tarayıcı oturumuyla (`cl_at` çerezi) aynı uç `Authorization` başlığı olmadan
çalışır; `-b "cl_at=<...>"` yeterli. Çerez varsa çerez kazanır.

`platform` yalnızca `android`, `ios`, `web` olabilir; yazılmazsa `android`
sayılır. Jeton 20 karakterden kısa ya da 4096'dan uzunsa uç yetkiye bile
bakmadan `400 bad_token` döner. Saatte 20 istek sınırı var (IP başına).

**Üretimde doğrulandı** (2026-10-08, kullanıcı koşusu): çerez yoluyla POST
`{"ok":true,"platform":"android"}`, Bearer yoluyla POST aynı yanıt (#81
öncesinde bu yol `401 unauthorized` veriyordu), DELETE `{"removed":1}`.
169 ve 950 karakterlik sahte jetonlarla da geçti. `cl_at` `HttpOnly` olduğu
için `document.cookie` onu göstermez; çerez tarayıcının Application →
Cookies panelinden alınır.

## Doğrulanmayanlar

`fcm.googleapis.com` ve `oauth2.googleapis.com` bu oturumun ağ ilkesiyle
erişilemez durumda: **canlı bir bildirim gönderilmedi**. İmzalama yolu
gerçek bir anahtar çiftiyle yerel olarak doğrulandı, istek gövdesi ve
adresi sınamada sabit; ama FCM'in yanıtı ilk gerçek gönderimde görülecek.
Depoda Android uygulaması da yok — `data.jobId`/`data.pdfKey` sözleşmesi
uygulama tarafında karşılanmalı. `/api/device-token`'ın kendisi bu listede
**değil**: iki yolu da üretimde koşuldu (yukarıdaki bölüm). Doğrulanmamış olan
FCM'e gerçek gönderim ve derlenmiş bir mobil uygulama.
