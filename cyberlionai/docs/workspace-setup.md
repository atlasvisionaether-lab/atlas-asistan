# Google Workspace kurulumu — cyberlionai.com

Bu depodaki hiçbir araç admin.google.com'a ya da Namecheap'e erişemiyor —
ikisi de tarayıcı/hesap girişi gerektiren adımlar. Bu belge, o adımları
elle yürütmek için tam metin ve sıra verir. **MX kaydı sen onay vermeden
değiştirilmez** (aşağıda 5. adımda tekrar işaretli).

Kullanıcı yapısı (karar verildi): **info@ ana hesap (ücretli koltuk),
destek@ bu hesaba alias (ücretsiz)**. İkisi de aynı gelen kutusuna düşer;
Gmail arayüzünde "Gönder: Şu olarak" ayarıyla destek@ adresinden de
cevap yazılabilir.

## 1. Alan adını Workspace'e ekle

1. admin.google.com > **Alanlar** > **Alan adları yönet** > **Alan adı ekle**.
2. `cyberlionai.com` yaz, ikincil alan adı olarak ekle.
3. Google bir **TXT doğrulama kaydı** gösterecek (biçimi
   `google-site-verification=...`). Bu değer her kurulumda farklı üretilir,
   burada ÖNCEDEN YAZILAMAZ — ekrana geldiğinde bana ilet, ben Namecheap
   tarafı için doğru sözdizimini birlikte teyit edelim, sonra sen Namecheap'e
   gir (bkz. adım 2).
4. TXT kaydı yayıldıktan sonra (birkaç dakika–saat) admin konsolunda
   **Doğrula**'ya bas.

## 2. Namecheap Advanced DNS — eklenecek kayıtlar

Domain List > cyberlionai.com > **Manage** > **Advanced DNS**.

| Tür | Host | Değer | TTL |
| --- | --- | --- | --- |
| TXT | `@` | *(adım 1'de Google'ın verdiği `google-site-verification=...` değeri)* | Otomatik |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | Otomatik |
| MX | `@` | `smtp.google.com` — öncelik **1** | Otomatik |

SPF notu: Namecheap'te zaten başka bir `v=spf1 ...` TXT kaydı varsa (ör.
Vercel/transactional mail sağlayıcısı) **iki ayrı SPF TXT kaydı OLMAZ** —
RFC 7208 birden fazla SPF kaydını "permerror" sayar ve e-posta kimliği
tamamen kırılır. Böyle bir kayıt zaten varsa bana söyle, tek kayıtta
`include:_spf.google.com` birleştirerek öneririm (ör.
`v=spf1 include:_spf.google.com include:diger-saglayici.com ~all`).

DKIM: Google admin konsolu (adım 4) bu TXT kaydını SENİN domainine özel
üretiyor — önceden yazılamaz. Üretildiğinde buraya ya da Namecheap'e
host `google._domainkey` ile TXT olarak eklenir.

## 3. Kullanıcıları kur

1. admin.google.com > **Dizin** > **Kullanıcılar** > **Yeni kullanıcı ekle**:
   `info@cyberlionai.com` (ana, ücretli koltuk).
2. O kullanıcının sayfasında **Alternatif e-posta** veya **Diğer alan adı
   adresleri (alias)** bölümüne `destek@cyberlionai.com` ekle.
3. Gmail ayarları (info@ hesabı, web arayüzü) > **Hesaplar ve İçe Aktarma**
   > **Şu olarak gönder** > `destek@cyberlionai.com` ekle, böylece destek@'e
   gelen bir maile destek@ adresinden cevap yazılabilir.

## 4. DKIM'i etkinleştir

1. admin.google.com > **Uygulamalar** > **Google Workspace** > **Gmail**
   > **Kimlik doğrulama için e-posta hazırlama (DKIM)**.
2. `cyberlionai.com` için **DKIM anahtarları oluştur** (2048 bit önerilir).
3. Google bir `google._domainkey` TXT kaydı gösterir — Namecheap'e ekle
   (adım 2'deki tabloya bu satırı sen eklersin, değeri domain'e özel).
4. Kayıt yayıldıktan sonra **Kimlik doğrulamayı başlat**'a bas.

## 5. MX — ONAY GEREKİR

MX kaydı (adım 2'deki tablo) **yalnızca sen "evet" dedikten sonra**
Namecheap'e girilir. Girilmeden önce:

- Mevcut e-posta akışı varsa (başka bir sağlayıcıdan posta alıyorsanız)
  kesinti olur — geçiş anını sen seçmelisin.
- MX girildikten sonra yayılma birkaç dakika–saat sürebilir; bu sırada
  eski sağlayıcıya giden postalar kaybolabilir, yenisine giden da henüz
  ulaşmayabilir.

## 6. Kurulum sonrası mail testi

MX + SPF + DKIM yayıldıktan ve admin konsolunda doğrulandıktan sonra:

```
curl -X POST https://www.cyberlionai.com/api/verify-dns \
  -H "Content-Type: application/json" \
  -d '{"domain":"cyberlionai.com"}'
```

`spf.status` ve `dmarc.status` (DMARC bu depoda zaten ayrı kuruluysa) kontrol
edilsin. Gerçek mail testi için: info@ ve destek@ adreslerine dışarıdan
(ör. kişisel Gmail'den) birer test postası at, ikisinin de aynı gelen
kutusuna düştüğünü ve Gmail'in "Kimden" alanında doğru adresi gösterdiğini
doğrula. Bu adım bir tarayıcı/Gmail oturumu gerektirdiği için buradan
otomatik yapılamıyor — sonucu bana bildir, ben de o sırada
`tools/gmail-telegram-notify.gs` bildiriminin gelip gelmediğini seninle
birlikte teyit edeyim.

## 7. Gmail → Telegram bildirimi

Kurulum ve gerekçe: `tools/gmail-telegram-notify.gs` dosyasının başındaki
yorum. Özet: info@ hesabına Apps Script olarak eklenir, 5 dakikada bir yeni
postaya bakar, konu + gönderen + hangi adrese geldiğini Telegram'a yazar.
Script Properties'e `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` girilir —
`/api/scan` ve `/api/verify-dns`'in kullandığı Vercel'deki aynı bot/sohbet
tekrar kullanılabilir (yeni bir bot gerekmiyor), ya da ayrı bir bot/sohbet
istenirse BotFather'dan yeni bir belirteç alınıp oraya girilir.
