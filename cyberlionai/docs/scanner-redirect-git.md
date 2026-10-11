# Open redirect ve `.git` ifşası: ölçüm ve karar

Yol haritasının son maddesi. Sonuç: **`.git` tarafında eklenecek tespit yok,
open redirect kontrolü de yazılmadı.** İkisinin de gerekçesi ölçümle burada.

## `.git` ifşası ZATEN ÖLÇÜLÜYOR

`api/_lib/owasp.js` → `SENSITIVE_PATHS`: `/.env`, `/.env.bak`, `/.git/HEAD`,
`/.DS_Store`, `/config.json`, `/backup.zip`. Kimlikler `a01___env`,
`a01___git_HEAD` vb.

Üretim taramasında bunların `SKIP` görünmesi bir eksik **değil**, bilinçli bir
kapı: aktif yollar yalnızca `consent === true && verified === true` iken
deneniyor (`api/_lib/scan-levels.js` → `activeAllowed`). Sahipliği
doğrulanmamış anonim bir taramada not `requires_verified_ownership` oluyor.
Üçüncü taraf bir siteye izinsiz dosya yoklaması göndermemenin karşılığı bu.

Ölçüt de doğru kurulmuş: **200 + içerik tipi HTML değil** → ifşa. SPA'lar her
yola 200 + HTML döndürdüğü için bu ayrım yanlış pozitifi engelliyor.

## Ölçüm (koşu `38180672890`, 11.10.2026)

Kendi dört adresimiz, sekiz yönlendirme parametresi (`next`, `url`,
`redirect`, `return`, `returnUrl`, `r`, `dest`, `continue`), üç yol:

| adres | taban | 8 parametre | `.git/HEAD` · `.git/config` · `.env` |
| --- | --- | --- | --- |
| www.cyberlionai.com | 200 | hepsi 200, **Location yok** | 404 `text/html` ×3 |
| cyberlionai.com | 308 → www | hepsi 308 → **kendi www'müz** | 308 `text/plain` ×3 |
| cyberlionai.vercel.app | 200 | hepsi 200, **Location yok** | 404 `text/html` ×3 |
| www.atlasasistan.com | 307 → apex | hepsi 307 → **kendi apex'imiz** | 307 `text/plain` ×3 |

İki sonuç:

1. **Hiçbir adreste ifşa yok.** 404'ler ve 30x'ler `owasp.js`'in ölçütüne göre
   ifşa saymaz; kapı açıkken ölçümün işlediği böylece doğrulandı.
2. **Hiçbir parametre açık yönlendirme üretmiyor.** 32 denemenin tamamı ya
   Location üretmiyor ya da kendi sitemize dönüyor; `example.com` hiçbirinde
   yönlendirme HEDEFİ değil, yalnızca sorgu dizesinde taşınıyor.

## Open redirect kontrolü YAZILMADI — gerekçe

Ölçüm, kontrolün ne kadar şey söyleyeceğini de ölçtü: bu dört adres statik
(ya da yalnızca kanonik yönlendirme yapan) sunucular ve bir open redirect
kontrolü burada **her zaman "geçti"** derdi.

> Her statik sitede sessizce "geçti" diyen bir kontrol bir şey ÖLÇMÜYOR;
> rapora bir satır ekliyor ve müşteriye yapabileceği bir şey vermiyor.

OCSP stapling kararıyla aynı çizgi (bkz. `docs/scanner-tls.md`): ölçüm,
kontrolün yazılmaması kararını da verebilir.

**Bu karar neyi dışlamıyor:** sunucu tarafı bir giriş akışı (`?next=` ile
dönüş adresi taşıyan bir oturum açma sayfası) eklenirse, open redirect
gerçek bir risk olur ve o zaman kontrol ölçülebilir bir şey söyler. Karar
bugünün ölçümüne dayanıyor, kalıcı bir yasak değil.

## Ölçüm betiğinde bulunan kusur

İlk sürümün ölçütü **yanlıştı** ve bunu ölçümün kendisi yakaladı
(koşu `38180366491`): 16 satırda "DIŞARIYA" yazdı, hepsi yanlış pozitifti.

```
== https://cyberlionai.com/
   ?next  308  Location: https://www.cyberlionai.com/?next=https%3A%2F%2Fexample.com%2F...
```

Yönlendirme kendi `www` adresimize gidiyor; `example.com` yalnızca sorgu
dizesinde taşınıyor. İlk ölçüt "Location host'u taban host'undan **farklı**"
olduğu için apex → www (308) açık sayıldı — yani betiğin kendi belgesinde
"30x yetmez, apex→www tuzağı" diye yazılı olan tuzağa ölçüt düştü.

**Doğru ölçüt:** Location'ın host'u payload hedefine (`example.com`) **eşit**
mi. Parametrenin sorgu dizesinde görünmesi kanıt değil; sunucunun onu yalnızca
taşıdığını gösterir. `hedefeMiGidiyor()` bunu yapıyor, `ayniSite()` apex ↔ www
durumunu bilgi olarak işaretliyor. Üç durum yerelde ağsız doğrulandı:
apex→www taşıma `false`, gerçek açık yönlendirme `true`, Location yok `false`.

## Ölçümü tekrarlama

```
feeds-probe.yml → redirect_git: true, dns_domains: "<adresler>"
```

Sınırlar betikte sabit: yalnızca kendi alan adlarımız (üçüncü tarafa
yönlendirme denemesi açık onay gerektirir), hedef `example.com` (RFC 2606),
`redirect: 'manual'` ile yönlendirme **takip edilmiyor**, payload yok, veri
yazmıyor. Geliştirme kabından koşmaz; o durumda tahmin etmez,
`ÖLÇÜLEMEDİ (fetch failed)` der.
