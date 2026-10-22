# iyzico canlı ödeme — açılış listesi

Bu belge CANLI (production) ödemeyi açan adımları ve ölçülmüş son durumu
anlatıyor. Kum havuzu (sandbox) kurulumu ayrı belgede:
[`iyzico-sandbox.md`](iyzico-sandbox.md).

> Anahtar DEĞERLERİ bu depoda, bu belgede ya da sohbette hiçbir yerde
> yazılmaz. Yalnızca Vercel ortam değişkenlerine girilir.

## 1. Panelde girilecek adresler

iyzico panelinde (Ayarlar) iki adres var ve **ikisi farklı**:

| Panel alanı | Girilecek adres | Ne yapar |
| --- | --- | --- |
| **Bildirim URL'i** (webhook) | `https://www.cyberlionai.com/api/webhooks/iyzico` | Abonelik durumu değiştiğinde iyzico buraya POST atar; `api/webhooks/iyzico.js` imzayı `X-Iyz-Signature-V3` ile doğrular ve `cl_subscriptions`'ı günceller. |
| **Geri dönüş (callback) URL'i** | `https://www.cyberlionai.com/api/checkout-return` | Kullanıcı ödeme formunu bitirdiğinde tarayıcı buraya döner; `api/checkout-return.js` sonucu okuyup `/panel`e yönlendirir. |

`/api/odeme/callback` diye bir uç **yok**; panelde o adres yazılırsa bildirim
hiçbir yere düşmez. Uçların adları depodaki dosya yollarıyla birebir:
`api/webhooks/iyzico.js` ve `api/checkout-return.js`.

## 2. Vercel ortam değişkenleri (Production)

| Ad | Zorunlu | Not |
| --- | --- | --- |
| `IYZICO_API_KEY` | ✅ | Panel → Ayarlar → API anahtarları. En az 20 karakter. |
| `IYZICO_SECRET_KEY` | ✅ | Aynı yer. |
| `IYZICO_BASE_URL` | ✅ | Canlı: `https://api.iyzipay.com`. Kum havuzu: `https://sandbox-api.iyzipay.com`. |
| `IYZICO_SUBSCRIPTION_ENABLED` | ✅ | `true` olmadan ödeme ucu kapalı. |
| `IYZICO_PRICING_PLAN_PRO` | ✅ | iyzico fiyat planı **referans kodu**. Bu olmadan `/odeme` "başlatılamıyor" diyor. |
| `IYZICO_PRICING_PLAN_ENTERPRISE` | ➖ | Enterprise planı satılacaksa. |
| `IYZICO_PRICING_PLAN_PRO_YEARLY` | ➖ | **Pro Yıllık** planının referans kodu (2.490 TL, KDV dahil). Yoksa yıllık Pro düğmesi "başlatılamıyor" der, aylık etkilenmez. |
| `IYZICO_PRICING_PLAN_ENTERPRISE_YEARLY` | ➖ | **Enterprise Yıllık** planının referans kodu (19.900 TL, KDV dahil). |
| `SITE_URL` | ✅ | `https://www.cyberlionai.com`. Geri dönüş adresi buradan kuruluyor. |

**Kodda okunmayan adlar.** `IYZICO_ABONELIK_ETKINLESTIRICI` ve
`IYZICO_FIYATLANDIRMA_PLANI` Production'da tanımlı ama **hiçbir yerde
okunmuyor**: değerleri değiştirmek ödemeyi açmaz ya da kapatmaz. Ödemeyi açan
adlar yukarıdaki tabloda. (Bu iki ad depoda da aranarak doğrulanıyor:
`tools/iyzico-checklist-test.js`.)

## 3. Fiyat planı referans kodu

Ödeme ucunun kapı sırası: **yapılandırma → plan referansı → oturum**. Referans
kodu yoksa `/api/checkout` 503 `checkout_unconfigured` döner ve `/odeme`
sayfası mavi "çevrimiçi ödeme şu an başlatılamıyor" kutusunu gösterir — mesaj
doğru, eksik olan koddur.

16.10.2026 canlı ölçümü (Actions koşusu `38983000527`):

```
GET https://www.cyberlionai.com/api/checkout?mode=1
200 { "enabled": true, "testMode": false, "plans": [] }
```

`enabled: true` → anahtarlar yerinde. `plans: []` → plan referansı yok. Tek
kalan eksik bu.

Kodu almanın üç yolu var; **hepsi aynı sonucu** verir:

1. **Panelden:** Abonelik → Ürünler → ürün oluştur → fiyat planı oluştur
   (aylık, TRY, **KDV dahil** tutar: Pro 249, Enterprise 1990; plana yazılan
   tutar karttan çekilen tutardır). Plan satırındaki referans kodunu kopyalayın.
2. **Yönetici ucundan** (anahtarları kimseye vermeden, sunucudaki anahtarlarla):

   ```
   GET  /api/admin/iyzico-plan      → durum, hangi onay sözcüğü gerekiyor
   POST /api/admin/iyzico-plan      { "confirm": "PLAN OLUSTUR CANLI" }
   ```

   `ADMIN_EMAILS` içindeki hesapla giriş yapılmış olmalı. Yanıt ürün ve plan
   referans kodlarını döner; uç bunları hiçbir yere yazmaz, para çekmez.
   Kum havuzunda onay sözcüğü `PLAN OLUSTUR`, canlıda `PLAN OLUSTUR CANLI`.
   Fiyat `api/_lib/plans.js`'ten okunur (Pro 249 ₺, KDV dahil), istekten
   fiyat kabul edilmez.
3. **Komut satırından:** anahtarlar ortamda varsa
   `CONFIRM=evet node tools/iyzico-plan-setup.js`. Anahtar yoksa betik
   `ÖLÇÜLEMEDİ` der ve 2 ile çıkar.

Kodu aldıktan sonra Vercel → Production → `IYZICO_PRICING_PLAN_PRO` →
yeniden dağıtım. Ardından doğrulama:

```
gh workflow run iyzico-verify.yml
```

Beklenen: `enabled: true`, `plans: ["pro"]`, `/api/checkout?plan=pro` → 401
(oturum yok) — 503 değil. 503 kalıyorsa referans kodu yanlış ortamdan
(sandbox kodu canlı anahtarla ya da tersi).

## 4. Ödeme akışı (ölçülmüş)

1. `/odeme?plan=pro` — ad soyad, e-posta, üç onay kutusu. Kart bilgisi bu
   sayfada **alınmaz**.
2. `odeme.js` → `/api/checkout?plan=pro&declaration=1&agreements=1&ad=…`.
   Üç onay olmadan uç ödemeyi başlatmaz (mesafeli satış mevzuatı).
3. `api/checkout.js` oturumu doğrular, iyzico'da müşteri + barındırılan
   abonelik formu açar, tarayıcıyı iyzico'ya yönlendirir. Kart verisi bizim
   sunucumuza hiç uğramaz.
4. Kullanıcı `/api/checkout-return`'e döner; sonuç `cl_subscriptions`'a
   yazılır ve `/panel`e gidilir.
5. Sonraki durum değişiklikleri (yenileme, iptal, başarısız ödeme)
   `/api/webhooks/iyzico`'ya düşer; imza doğrulanmadan hiçbir şey yazılmaz.

Abonelik durumunun tek kaynağı `cl_subscriptions`. Ayrı bir `odemeler`
tablosu ya da ikinci bir ödeme ucu **yok**; olması durumu iki yere bölerdi.

## 5. Sınamalar

| Betik | Ne kilitliyor |
| --- | --- |
| `tools/iyzico-test.js` | IYZWSv2 imzası, webhook imza doğrulaması (test vektörleri) |
| `tools/iyzico-checklist-test.js` | Belge ↔ kod ↔ doğrulama betiği aynı ortam adlarını söylüyor mu |
| `tools/iyzico-admin-test.js` | Yönetici ucunun kapıları, onay sözcüğü, fiyatın plans.js'ten gelmesi |
| `tools/iyzico-logo-test.js` | Visa/Mastercard logoları üç ödeme yüzeyinde görünür |
| `tools/iyzico-verify.js` | Üretimdeki ucun gerçek yanıtı (ağ gerektirir, Actions'ta) |
