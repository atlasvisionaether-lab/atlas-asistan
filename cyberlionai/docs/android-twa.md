# Android uygulaması (TWA) — PWA manifest'ten Play Store'a

Site bir TWA (Trusted Web Activity) kabuğuyla Play Store'a çıkıyor: Android
uygulaması, adres çubuğu olmadan `https://www.cyberlionai.com` açan ince bir
sarmalayıcı. Ayrı bir mobil kod tabanı yok; uygulamanın adı, ikonu, açılış
ekranı ve başlangıç adresi `cyberlionai/manifest.json`'dan geliyor.

## Ölçüm: bu bulut kabında nereye kadar gidilebildi

| Adım | Durum |
| --- | --- |
| PWA manifest + ikonlar + sayfalara bağlantı | ✅ ÖLÇÜLDÜ — bu depoda |
| `npx @bubblewrap/cli init` başlatma | ✅ ÖLÇÜLDÜ — çalışıyor, JDK 17 indi (`~/.bubblewrap/jdk`) |
| Android SDK indirme | ❌ ÖLÇÜLEMEDİ — `dl.google.com` kapalı: `CONNECT tunnel failed, response 403` |
| `bubblewrap build` (AAB) | ❌ ÖLÇÜLEMEDİ — SDK olmadan derleme yok |
| İmza anahtarı | ❌ Kasten yapılmadı — kalıcı anahtar geçici kapta üretilmez |

Yani derleme **atlas109'da** yapılacak; bu depodaki parçalar o derlemenin
girdisi. `bubblewrap init` canlı manifest adresini okuduğu için **önce bu PR
üretime çıkmalı**: `https://www.cyberlionai.com/manifest.json` 200 dönmeden
init çalışmaz.

## 1. atlas109'da kurulum

```bash
mkdir -p /home/aliatlaskotan/cyberlion-app
cd /home/aliatlaskotan/cyberlion-app

# Yapılandırmayı depodan al: init'in sorduğu her şey içinde hazır.
cp /yol/atlas-asistan/android-twa/twa-manifest.json .

npx @bubblewrap/cli@1.27.0 init --manifest=https://www.cyberlionai.com/manifest.json
```

init şunları soruyor; `twa-manifest.json` kopyalandıysa varsayılanlar zaten
doğru gelir:

- **JDK 17'yi Bubblewrap kursun mu?** → Evet (kendi JDK'nızı kullanacaksanız
  **17** olmalı; sistemdeki 21 ile derleme kırılır).
- **Android SDK'yı Bubblewrap kursun mu?** → Evet, ardından SDK lisansını
  kabul edin (`y`). Bu, Google'ın lisansını sizin adınıza kabul etmek demek;
  o yüzden burada bırakıldı.
- **Paket adı** → `com.cyberlionai.app` (Play'de **bir kez** belirlenir,
  sonra değişmez).
- **İmza anahtarı** → yoksa init üretir: `./android.keystore`, takma ad
  `cyberlion`. Parola sorulduğunda güçlü bir parola verin.

> **İmza anahtarı ve parolası kaybedilirse uygulama bir daha güncellenemez.**
> Play App Signing açıksa yükleme anahtarı sıfırlanabilir, ama yine de
> anahtarı ve parolasını parola yöneticisinde saklayın. Depoya **asla**
> girmez: `android-twa/.gitignore` `*.keystore`, `*.jks`, `*.aab`, `*.apk`
> dosyalarını dışlıyor ve `tools/pwa-manifest-test.js` bunu her koşuda
> doğruluyor.

## 2. AAB üretimi

```bash
cd /home/aliatlaskotan/cyberlion-app
npx @bubblewrap/cli@1.27.0 build
```

Çıktı: `app-release-bundle.aab` (Play'e yüklenen) ve `app-release-signed.apk`
(cihazda denemek için).

Cihazda deneme:

```bash
adb install -r app-release-signed.apk
```

## 3. Android 13+ bildirim izni

`twa-manifest.json` içinde `"enableNotifications": true`. Bubblewrap bunu
görünce üretilen `AndroidManifest.xml`'e `POST_NOTIFICATIONS` iznini ve
izni isteyen köprüyü koyuyor; site `Notification.requestPermission()`
çağırdığında Android 13+ kendi iznini soruyor.

Bu bayrak kapalıysa uygulama bildirim gönderemez ve bu derleme sırasında
hata vermez — sessizce çalışmaz. `tools/pwa-manifest-test.js` bayrağı
kilitliyor.

> Site şu an tarayıcı bildirimi göndermiyor; izin altyapısı uygulamada hazır
> duruyor, kullanan kod eklendiğinde yeniden derleme gerekmiyor.

## 4. Digital Asset Links (adres çubuğu görünmesin)

TWA açılışta `https://www.cyberlionai.com/.well-known/assetlinks.json`
dosyasını okur. Parmak izi tutmazsa uygulama **üstte adres çubuğuyla** açılır
ve Play incelemesinde "sadece web sitesi sarmalayıcısı" diye reddedilir.

Parmak izi **uydurulamaz**: Play Console → Uygulama bütünlüğü → Uygulama
imzalama → **SHA-256 sertifika parmak izi** (yükleme anahtarınınki değil,
uygulama imzalama anahtarınınki). Alındıktan sonra:

```bash
node cyberlionai/tools/twa-assetlinks.js "AB:CD:…:EF"
# cyberlionai/.well-known/assetlinks.json yazılır → commit → dağıt
curl -s https://www.cyberlionai.com/.well-known/assetlinks.json
```

Dosya bu yüzden hazır commit'lenmedi: sahte parmak izli bir assetlinks,
olmayan dosyadan daha kötüdür (doğrulama sessizce başarısız olur).

## 5. Play Console

| Alan | Değer |
| --- | --- |
| Paket adı | `com.cyberlionai.app` |
| Uygulama adı | Cyber Lion AI |
| Kategori | Araçlar / İş |
| Gizlilik politikası | `https://www.cyberlionai.com/gizlilik-politikasi` |
| **Veri silme URL'i** | `https://www.cyberlionai.com/hesap-silme` |
| Hesap silme (uygulama içi) | `DELETE /api/panel/account` — panel içinden |
| Destek e-postası | `destek@cyberlionai.com` |
| Grafik öğeler | ikon 512×512 (`favicon.png`), öne çıkan görsel 1024×500, en az 2 telefon ekran görüntüsü |

Play'in "veri güvenliği" formunda `cl_scans` için söylenecekler (ölçülmüş
davranış): taranan ana makine adı ve ülke (ISO-2) saklanıyor, **IP
saklanmıyor**; hesap silindiğinde tarama geçmişi, abonelik ve cihaz
belirteçleri de siliniyor.

Öne çıkan görsel ve mağaza ekran görüntüleri henüz üretilmedi — `og-image.png`
(1200×630) doğru ölçüde değil, 1024×500'e yeniden kırpılması gerekiyor.

## 6. Site tarafı ne değişti

- `cyberlionai/manifest.json` — ad, ikonlar (192/512 + maskable), üç ekran
  görüntüsü, üç kısayol (Yeni tarama / Panelim / Hesap silme).
- `icon-maskable-192.png`, `icon-maskable-512.png` — logo %80 ölçekle
  `#0a0a0f` zemine yerleştirildi (`convert favicon.png -resize 410x410
  -background '#0a0a0f' -gravity center -extent 512x512`). Android'in
  daire/kare maskesi logoyu kesmesin diye kenar boşluğu şart.
- 17 HTML sayfasının hepsine `<link rel="manifest">` (yasal sayfa şablonuna
  da, yeniden üretim bağlantıyı silmesin diye).
- `vercel.json` — manifest `application/manifest+json` ile ve **kısa**
  önbellekle (1 saat) servis ediliyor; kalıcı önbellek olsaydı yüklü
  uygulamalar eski adı/ikonu taşırdı. `/.well-known/assetlinks.json` için de
  başlık hazır.

Renkler `#0a0a0f` (sitenin `theme-color` meta değeri). İstenen `#7c3aed`
mor kullanılmadı: TWA'da `theme_color` durum çubuğunu, `background_color`
açılış ekranını boyuyor; site altın/koyu olduğu için mor açılış ekranı sayfa
yüklendiğinde göze çarpan bir renk sıçraması yaratırdı. Değişmesi isteniyorsa
tek yer `manifest.json` + `android-twa/twa-manifest.json` (ikisi sınamayla
eşitlenmiş durumda).
