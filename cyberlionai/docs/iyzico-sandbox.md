# iyzico sandbox kontrol listesi ve doğrulama

Ödeme kodu **zaten yazılmış** (`api/checkout.js`, `api/checkout-return.js`,
`api/webhooks/iyzico.js`, `api/_lib/iyzico.js`; birim sınaması
`tools/iyzico-test.js`). Eksik olan şey kod değil: **anahtarlar, plan
referansları ve bunların çalıştığının ölçülmesi.** Bu belge o sırayı yazıyor.

Anahtar değerleri bu belgede **yok** ve sohbete yazılmaz: doğrudan Vercel'e
(ve sandbox denemesi için yalnızca kendi kabuğunuza) girilir.

## 1. Ortam değişkenleri (değerleri doğrudan Vercel'e)

| değişken | ne | yoksa ne olur |
| --- | --- | --- |
| `IYZICO_API_KEY` | iyzico API anahtarı | uç `503 checkout_unconfigured` |
| `IYZICO_SECRET_KEY` | iyzico gizli anahtarı (eski ad `IYZICO_SECRET` de okunuyor) | aynı |
| `IYZICO_BASE_URL` | `https://sandbox-api.iyzipay.com` (sandbox) ya da `https://api.iyzipay.com` (canlı) | aynı |
| `IYZICO_PRICING_PLAN_PRO` | Pro fiyat planının referans kodu | Pro ödemesi açılmaz |
| `IYZICO_PRICING_PLAN_ENTERPRISE` | Enterprise fiyat planının referans kodu | Enterprise ödemesi açılmaz |
| `IYZICO_PRICING_PLAN_PRO_YEARLY` | Pro **yıllık** fiyat planının referans kodu | Yıllık Pro ödemesi açılmaz (aylık etkilenmez) |
| `IYZICO_PRICING_PLAN_ENTERPRISE_YEARLY` | Enterprise **yıllık** fiyat planının referans kodu | Yıllık Enterprise ödemesi açılmaz |
| `IYZICO_SUBSCRIPTION_ENABLED` | kill switch; `false/0/off/no` ödemeyi **kapatır**, yoksa açık sayılır | — |
| `SITE_URL` | dönüş adresinin kökü (`<SITE_URL>/api/checkout-return`); yoksa istek host'undan türetilir | — |

Ölçülmüş davranış (`api/_lib/iyzico.js`):

- Anahtar **20 karakterden kısaysa** yapılandırılmamış sayılıyor: yer tutucu
  bir değer "girildi" sanılmıyor.
- `IYZICO_BASE_URL` **https değilse** yapılandırma geçersiz.
- Sandbox/canlı ayrımı **elle ayarlanmıyor**: taban adresteki `sandbox`
  kelimesinden türüyor (`environmentName()`), yani yanlış ortamı "canlı"
  diye işaretlemek mümkün değil.

## 2. Ürün + fiyat planı (referans kodları buradan geliyor)

`pricingPlanReferenceCode` kodda sabit **değil**; iyzico'da bir kez
oluşturulup env'e yazılıyor. İki yol var:

**a) iyzico sandbox paneli:** Abonelik → Ürün oluştur → o ürüne fiyat planı
ekle (aylık, yinelenen). Plan listesindeki **referans kodunu** kopyala.

**b) Betikle (fiyatı `plans.js`'ten okur, elle yazmaz):**

```
IYZICO_API_KEY=… IYZICO_SECRET_KEY=… IYZICO_BASE_URL=https://sandbox-api.iyzipay.com \
CONFIRM=evet node cyberlionai/tools/iyzico-plan-setup.js
```

- `CONFIRM` olmadan **hiçbir çağrı yapmaz**, yalnızca ne oluşturacağını yazar.
- Taban adres canlıysa durur; canlı plan ayrı bir karar (`CONFIRM=evet-canli`).
- Fiyatı `api/_lib/plans.js`'ten okur: panelde yanlış tutar girmek,
  sözleşme metnindeki fiyatla sitedeki fiyatın ayrışması demekti
  (Pro 249 TRY, Enterprise 1990 TRY, **KDV dahil**: plana yazılan tutar
  karttan çekilen tutardır; KDV dökümü sözleşme ve ön bilgilendirme
  belgelerinde yazılı).
- Çıktıdaki referans kodlarını `IYZICO_PRICING_PLAN_PRO` ve
  `IYZICO_PRICING_PLAN_ENTERPRISE` olarak Vercel'e gir.

Tekrar koşmak **yeni** plan üretir ve eskiler panelde kalır; betik var olanı
aramıyor.

## 3. Kart gerekmeden ölçülebilen her şey

```
BASE=https://www.cyberlionai.com node cyberlionai/tools/iyzico-verify.js
```

(Önizleme hedefi için `BYPASS=<Vercel Protection Bypass>` ekleyin. Bu kaptan
ağ çıkışı kapalı olduğu için `ÖLÇÜLEMEDİ` der; `iyzico-verify.yml` iş akışı
üzerinden koşulur.)

Ölçtükleri:

| adım | beklenen |
| --- | --- |
| `GET /api/checkout?mode` | 200; `enabled`, `testMode`, açılmış `plans` listesi — **anahtar, referans ve adres dönmüyor** |
| `POST /api/checkout` | 405 + `Allow: GET` |
| plan yok / `plan=free` / bilinmeyen plan | 400 `missing_plan` · `invalid_plan` |
| `?plan=pro` (beyan yok) | 400 `declaration_required` — tarama yetkisi beyanı olmadan ödeme başlamaz |
| `?plan=pro&declaration=1` | 400 `agreements_required` — ön bilgilendirme + sözleşme onayı şart (Mesafeli Sözleşmeler Yönetmeliği) |
| her kapı geçildi, oturum yok | makine isteği 401 `auth_required`; tarayıcı 303 → `/panel?checkout=pro` |
| ödeme kapalıyken aynı istek | 503 `checkout_unconfigured`; tarayıcı 303 → `/pricing?checkout=unavailable` |
| `/api/checkout-return` jeton yok / biçimsiz jeton | ödeme açıkken 303 → `/panel?checkout=invalid`; **ödeme kapalıyken** `…=unavailable` (uç jetona bakmadan dönüyor) — her iki hâlde abonelik **yazılmaz** |
| `POST /api/webhooks/iyzico` imzasız / yanlış imzalı | ödeme açıkken 401; **ödeme kapalıyken** 503 `webhook_unconfigured` (anahtar yoksa imza doğrulanamaz) — her iki hâlde hiçbir şey yazılmaz |
| `GET /api/webhooks/iyzico` | 405 + `Allow: POST` |

### Üç durum (16.10.2026 canlı ölçümü, koşu `38983000527`)

`?mode` cevabı iki değil **üç** durumu ayırt ediyor; betik hangisini beklediğine
buna bakarak karar veriyor:

| durum | `?mode` | `/api/checkout?plan=pro…` | `/odeme` düğmesi |
| --- | --- | --- | --- |
| kapalı | `enabled:false` | 503 `checkout_unconfigured` | kapalı |
| **anahtar var, plan referansı yok** | `enabled:true`, `plans:[]` | **503 `checkout_unconfigured`** | **kapalı** |
| hazır | `enabled:true`, `plans:["pro"]` | 401 `auth_required` (oturumsuz) | açık |

Ortadaki durum canlıda yaşandı: anahtarlar Production'a girildi, `enabled`
`true` oldu ama `IYZICO_PRICING_PLAN_PRO` tanımlı olmadığı için `/odeme`
"çevrimiçi ödeme şu an başlatılamıyor" demeye devam etti. `api/checkout.js`
sırası **yapılandırma → plan referansı → oturum** olduğu için uç 401'e hiç
gelmiyor. KODDA OKUNMAYAN ADLAR — yazılsa da etkisi yok, hiçbir yerde OKUNMUYOR:
`IYZICO_ABONELIK_ETKINLESTIRICI`, `IYZICO_FIYATLANDIRMA_PLANI`. Canlıda bu
ikisi Production'a girilmişti ve ödeme yine açılmadı; kodun okuduğu adlar
yalnızca §1'deki tabloda yazanlar.

`/api/checkout-return` de aynı mantıkla üç durumlu: anahtar yokken
`/panel?checkout=unavailable`, anahtar varken jetonsuz istek
`/panel?checkout=login` (oturum olmadan abonelik satırı açılamaz).

Beklenen değerlerin bir kısmı **ödemenin açık olup olmamasına göre değişiyor**;
betik `?mode` cevabındaki `enabled` değerine bakıp hangisini bekleyeceğine
karar veriyor. İlk sürüm bunu atlamıştı ve ilk canlı koşu (`38186662506`)
kendi beklentisini düzeltti: uçlar doğru davranıyordu, yanlış olan ölçüttü.

Bu liste, "ödeme hazır" cümlesini tahmin değil ölçüm yapan kısım. Hiçbir
abonelik başlatmıyor, hiçbir satır yazmıyor, hesap açmıyor.

## 4. Buradan sonrası elle (kart girilen adım)

Betiğin **ölçemediği** kısım: barındırılan formda kart girilmesi ve ardından
`checkout-return` → webhook → `cl_subscriptions`. Kartı bir insan giriyor.
Sandbox'ta sırası:

1. Sandbox anahtarları ve plan referansları Vercel'de; `?mode` cevabında
   `enabled: true`, `testMode: true` ve plan listesi dolu olmalı.
2. `/pricing` sayfasında iki onay kutusunu işaretle, Pro'yu seç. Tarayıcı
   `/api/checkout?plan=pro&declaration=1&agreements=1` üzerinden **iyzico'nun
   barındırılan formuna** gider (adresin host'u `formUrlOf` içinde
   doğrulanıyor; iyzico dışı bir host kullanılmıyor).
3. Formu **iyzico sandbox panelinde yazan test kartıyla** doldur. Kart
   numaraları buraya yazılmadı: sandbox panelindeki güncel liste kullanılır —
   ezberden bir numara yazmak, yanlış numarayı belgeye sabitlemek olurdu.
4. Dönüşte tarayıcı `/api/checkout-return?token=…` → `/panel?checkout=success`
   (ya da `pending`) adresine düşmeli. Ucun kararı **gövdeye değil**, jetonla
   iyzico'ya sorulan cevaba dayanıyor.
5. Panelde (`/dashboard` → Abonelik) planın göründüğünü ve **"Test modu"**
   rozetinin açık olduğunu doğrula: sandbox aboneliği canlı sanılmasın.
6. Veritabanında `cl_subscriptions` satırı: `plan`, `active`, `status`,
   `iyzico_env='sandbox'` ve `iyzico_subscription_ref` dolu olmalı.
7. Webhook: iyzico panelinde webhook adresini `https://<alan>/api/webhooks/iyzico`
   olarak tanımla. Abonelik durumu değiştiğinde (ör. iptal) satırın `status`
   alanı güncellenmeli. Webhook **yeni satır açmıyor**: hesap eşlemesi ödeme
   dönüşünde kuruluyor, eşleşmeyen webhook 200 ile onaylanıp yok sayılıyor.

Her adımda Telegram'a bildirim düşer (maskeli e-posta, plan, tutar); ödeme
açılamayan her durum uyarı olarak gider.

## 5. Sandbox → canlı

1. Sandbox'ta 1–4 arası tamam.
2. Canlı anahtarlar ve **canlı** plan referansları Vercel Production'a girilir
   (`IYZICO_BASE_URL=https://api.iyzipay.com`). Sandbox referansı canlıda
   çalışmaz; ikisi aynı env adını paylaşıyor, bu yüzden ortam başına ayrı
   değer girilmeli.
3. `iyzico-verify.js` canlı hedefte koşulur: `testMode: false` olmalı ve
   kapılar aynı davranmalı.
4. İlk canlı ödeme küçük bir tutarla, kendi kartıyla ve iade edilebilir
   şekilde denenir; `cl_subscriptions` satırında `iyzico_env='production'`
   görünmeli.
5. İptal/iade talepleri bugün destek üzerinden işliyor (`/dashboard` →
   Abonelik bölümünde yazılı); self-servis iptal henüz yok.

## Neyin ölçülmediğini bilerek yazıyoruz

- iyzico'nun müşteri kaydı ad, soyad, TC kimlik veya adres isterse ödeme
  `errorCode` ile reddedilir; elimizde yalnızca e-posta ve `/odeme`
  formundaki ad soyad var. Uydurma TC kimlik gönderilmiyor — gerekirse ödeme
  öncesi küçük bir form eklenecek (`api/checkout.js` içinde "BİLİNEN
  EKSİKLER").
- Abonelik olaylarının webhook imza alan listesi hiçbir resmî istemcide
  belgelenmemiş. Bu yüzden imza **tek dayanak değil**: durum her hâlükârda
  iyzico'ya sorulup oradan okunuyor.
- Pro'nun "ayda 50 tarama" sınırı kodda henüz zorlanmıyor.
