---
name: security-scanner
description: Cyber Lion AI tarama motorunda kontrol ekler veya değiştirir ve ön yüzün güvenlik kısıtlarını (CSP, secret sızıntısı, SSRF koruması) korur. Tarama kuralı, puanlama, index.html içinde script veya güvenlik başlığı değişikliğinde kullan.
---

# Tarama motoru ve ön yüz güvenlik kısıtları

Motor: `cyberlionai/api/_lib/scanner.js` — hedef doğrulama:
`cyberlionai/api/_lib/guard.js`.

## Temel ilke: yalnızca gerçekten ölçülen şey puanlanır

Bir kontrol çalıştırılamadıysa (zaman aşımı, TLS elenmesi, HTML alınamaması)
sonuçta `skipped` görünür ve **skora hiç girmez**. Ölçülemeyen bir maddeyi
"başarısız" sayıp puan düşürmek, bir güvenlik ürünü için yalan rapor üretmektir.

Yeni bir kontrol eklerken üç durumu da yaz: `passed`, `failed`, `skipped`.
"Ölçemedim" ile "başarısız" asla aynı kova değildir.

## Sürüm yaz

`SCANNER_VERSION` ve `REPORT_VERSION` kaydedilen her taramaya ve PDF'e yazılır;
eski bir sonuç hangi kural setiyle üretildiği bilinerek okunabilir. Puanlamayı
etkileyen her değişiklikte `SCANNER_VERSION`'ı yükselt.

## Sınırlar motorun içindedir, kaldırılmaz

`FETCH_TIMEOUT_MS` 9 s, `TLS_TIMEOUT_MS` 6 s, `MAX_HTML_BYTES` 512 KB,
`MAX_REDIRECTS` 4. Bunlar hem başarım hem savunma sınırlarıdır.

`guard.js` içindeki `assertPublicHost` SSRF korumasıdır: özel ağ, loopback ve
link-local adreslere tarama yapılmasını engeller. **Bu kontrol zayıflatılmaz.**

Üçüncü taraf alan adlarının otomatik veya periyodik taranması açık kullanıcı
onayı gerektirir. Doğrulama betikleri bu yüzden yalnızca kendi alan adımızı tarar.

## index.html içinde script değiştirdiysen CSP hash'ini yenile

CSP hash tabanlıdır (`script-src 'self' 'sha256-...'`). Satır içi bir `<script>`
bloğunun **tek karakteri** değişse tarayıcı script'i engeller.

```
python3 cyberlionai/tools/csp-hashes.py          # hash'leri üretir, dosyaları günceller
python3 cyberlionai/tools/csp-hashes.py --check  # bayatsa çıkış kodu 1
```

Bu `vercel.json` ve `_headers` dosyalarını günceller. **Yerel dev sunucusu
yeniden başlatılmadan yeni hash'ler devreye girmez** — sayfayı yenilemek yetmez.

`connect-src 'self' https://ipapi.co` dar tutulur. Tarayıcının yeni bir üçüncü
tarafa çıkmasına gerek duyan bir özellik tasarlıyorsan, tasarımı değiştir: isteği
sunucu tarafında (Vercel fonksiyonu) yap, tarayıcı yalnızca kendi origin'imizle
konuşsun.

## Secret ön yüze sızmaz

`prod-verify.sh` 10. bölümü istemciye inen kaynakta secret atanmasını arar.
Aranan şey değişken **adı** değil, ona **atanmış bir değerdir**:

```
SUPABASE_[A-Z_]*KEY["']?[[:space:]]*[:=]
```

Bu ayrım önemli: adı geçen bir açıklama satırı yanlış alarm vermez, ama
`const SUPABASE_ANON_KEY = "eyJ..."`, `{"SUPABASE_SERVICE_ROLE_KEY":"eyJ..."}` ve
`{SUPABASE_ANON_KEY: 'eyJ...'}` üçü de yakalanır. Deseni gevşetmeden önce dört
fikstürün de hâlâ doğru sonuç verdiğini doğrula.

Anahtarlar yalnızca sunucu tarafında (`api/_lib/`) okunur. `SERVICE_ROLE_KEY`
hiçbir koşulda tarayıcıya inmez.

## Uydurma içerik yasağı

Bu projede bir kez marka adından kalıp üretilerek dört sosyal medya bağlantısı
yazıldı; hiçbiri doğrulanmamıştı ve hesaplar başkalarına ait olabilirdi.
Bağlantı, hesap adı, sağlayıcı adı veya veri kaynağı **uydurulmaz** —
doğrulanmadıysa yazılmaz.

Ticari tehdit haritalarının (Kaspersky, Check Point, Fortinet, Radware) verisi
veya adlandırması kullanılmaz: açık API'leri yok ve şartları yeniden yayını
yasaklıyor. Kullanılan açık beslemeler `cyberlionai/tools/feeds-probe.sh`
içinde listelidir ve şemaları tahmin edilmez, ölçülür.
