# Telegram bildirimleri

Uçlarda olan biteni işletmeciye haber veren katman. Kod:
`cyberlionai/api/_lib/telegram.js`, sınaması `cyberlionai/tools/telegram-test.js`
(75 doğrulama, CI'da).

Bildirimler **müşteriye giden yanıtın bir parçası değil**. Telegram düşse,
belirteç yanlış olsa ya da hiç tanımlanmasa uçlar aynı şekilde çalışır;
tek fark haber alamamamız.

## 1. Botu kur (BotFather)

1. Telegram'da **@BotFather**'a yaz: `/newbot`
2. Bota bir ad ve `...bot` ile biten bir kullanıcı adı ver.
3. BotFather bir **belirteç** veriyor, biçimi `7851234567:AAH9x...` (sayı,
   iki nokta, ~35 karakter). Bu belirteç bota tam yetki verir — sohbete
   yapıştırmayın, ekran görüntüsü almayın, repoya yazmayın.

## 2. Sohbet kimliğini al

Bildirimler kişisel sohbete de, gruba da gidebilir. Grup öneriliyor: ileride
başkası da görsün diye.

1. Grup kuracaksan botu gruba **üye olarak ekle** (bot kendiliğinden
   katılamaz) ve gruba bir mesaj yaz.
2. Kimliği oku:

   ```
   curl -s "https://api.telegram.org/bot<BELIRTEC>/getUpdates" | jq '.result[].chat_id // .result[].message.chat.id'
   ```

   `jq` yoksa aynı adresi tarayıcıda aç ve `"chat":{"id":...}` alanına bak.
3. Grup kimlikleri **eksi** ile başlar (`-1001234567890`); kişisel sohbette
   pozitif bir sayıdır. Eksi işaretini atlamak en sık yapılan hata.

`getUpdates` boş dönüyorsa: bota (ya da gruba) henüz hiç mesaj yazılmamıştır,
ya da gizlilik modu grup mesajlarını gizliyordur — gruba bir mesaj yaz, sonra
tekrar dene. Webhook kurulmuşsa `getUpdates` hep boş döner.

## 3. Vercel'e ekle

Project Settings > Environment Variables (Production **ve** Preview):

| Değişken | Zorunlu | Ne işe yarar |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | evet | BotFather'ın belirteci |
| `TELEGRAM_CHAT_ID` | evet | olağan bildirimler (tarama, DNS doğrulama) |
| `TELEGRAM_ALERT_CHAT_ID` | hayır | kritik uyarılar; yoksa yukarıdakine düşer |

Üçü de `cyberlionai/.env.example` içinde isimleriyle duruyor. İkisi eksikse
katman **kapalı** sayılır ve hiçbir ağ isteği atılmaz.

## 4. Denemesi

```
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
  node cyberlionai/tools/telegram-ping.js "CyberLion canlı test OK"
```

Çıkış kodu 0 ise mesaj gitti. Başarısızlıkta stderr yalnızca durum kodunu
yazar; belirteç gizlenir.

En sık iki hata: `400 chat not found` → sohbet kimliği yanlış (eksi işareti?);
`403 bot was blocked by the user` / `bot is not a member` → bot gruba eklenmemiş.

## 5. Hangi olay nereye gider

| Olay | Mesaj | Sohbet |
| --- | --- | --- |
| `/api/scan` tarama başlıyor | `🔍 Tarama başladı: ornek.com` | olağan, sessiz |
| kuyruk açıkken işe alındı | `🕒 Tarama kuyruğa alındı: ornek.com` | olağan, sessiz |
| tarama bitti | `✅ Tarama bitti: ornek.com — 3 risk (puan 88)` | olağan, sessiz |
| tarama düştü (4xx) | `⚠️ Tarama başarısız: ornek.com — invalid_url` | olağan |
| tarama düştü (5xx) | `⚠️ Tarama başarısız: ornek.com — unreachable` | **uyarı**, sesli |
| `/api/verify-dns` sonucu | `🛡️ DNS doğrulama: ornek.com SPF pass / DMARC p=reject` | olağan |
| DNS zaman aşımı / 502 | `❌ Hata: /api/verify-dns 502 (timeout spf ornek.com)` | **uyarı** |
| `/api/scan-status` okuma düştü | `❌ Hata: /api/scan-status 503 (job_status_read_failed)` | **uyarı** |
| herhangi bir uç 500/502/504 | `❌ Hata: /api/scan 500` | **uyarı** |

Mesajların önüne `[CyberLion]` ekleniyor. Biçim tek yerde:
`telegram.js` içindeki `mesaj` nesnesi — uçlar kendi metnini yazmıyor, yoksa
aynı olay iki ucda iki farklı cümle olurdu.

## Kararlar (tekrar tartışılmasın diye)

**Belirteç hiçbir loga girmez.** Telegram'da belirteç adresin İÇİNDE:
`https://api.telegram.org/bot<BELIRTEC>/sendMessage`. Yani sıradan bir
"istek başarısız: <adres>" logu onu doğrudan sızdırır. Bu yüzden adres hiç
loglanmıyor, loglanan her metin `gizle()`'den geçiyor ve sınama logda
belirtecin tamamını, yalnız sır kısmını ve `api.telegram.org` dizgesini
ayrı ayrı arıyor.

**`parse_mode` gönderilmiyor.** Mesajın içinde müşterinin yazdığı alan adı ve
motorun hata kodu var. Markdown'da `_`, `*`, `[` karakterleri ya mesajı bozar
ya Telegram'ın 400'üne takılır; kötü niyetli bir alan adı bildirime bağlantı
sokabilir. Kaybı yalnızca kalın yazı.

**Telegram'a ne GİTMEZ:** e-posta, IP, oturum/kullanıcı kimliği, belirteç,
raporun kendisi. Yalnız alan adı, sayı ve durum kodu. Alan adı da
sadeleştiriliyor: şema, kullanıcı adı, port, yol ve **sorgu dizesi** atılıyor,
çünkü sorgu dizesi müşterinin yazdığı rastgele metni dış bir servise taşır.

**503 kritik uyarı üretmez.** Bu depoda 503 çöken bir uç değil, bilinçli
kapalı devre cevabı: sayaç deposu yok, göç uygulanmamış, yapılandırma eksik.
Bu durumlar dakikalarca sürüyor ve her istekte tekrar ediyor —
`/api/scan-status` göç uygulanana kadar her yoklamada 503 dönüyor. Uyarıya
bağlamak, kanalı ilk gerçek 500'ü göremeyeceğimiz kadar doldurmak olurdu.
İSTİSNA: okumanın DENENİP düştüğü 503 (`job_status_read_failed`) uyarıyor,
çünkü o bir yapılandırma eksiği değil.

**Bildirim yanıttan SONRA, ama beklenerek gönderiliyor.** Sunucusuz fonksiyon
handler'ın sözü çözülünce donuyor: beklenmeyen bir `fetch` yola çıkmadan
kesilir ve mesaj hiç gitmez. `res.json()`'dan önce beklenirse müşteri bildirim
kadar bekler. Bu yüzden yanıt yazılıyor, sonra handler dönmeden bildirim
bekleniyor (`ucuSar`).

**Aynı olay için iki mesaj yok.** Uç kendi mesajını gönderdiyse (alan adını
taşıyan, daha iyi olan) `bildirimIsaretle(res)` ile işaretliyor ve sarmalayıcı
genel "500" uyarısını göndermiyor.

**429'da bir kez tekrar.** Telegram `retry_after` saniye veriyor; 2 saniyeden
kısaysa beklenip bir kez daha denenir, uzunsa mesaj düşer. Bir bildirim için
müşterinin taramasını uzatmak doğru değil. Diğer hata kodlarında tekrar yok:
ikinci deneme çoğunlukla aynı cevabı alır.

**Hız sayacı güvenlik sınırı değil.** Dakikada 18 mesajda duruyor, yalnızca
Telegram'ın 429'una girmemek için. Sayaç deposu düşerse bildirim **gönderilir**
(kapalı devre yapmak, depo düştüğünde bütün bildirimleri kör etmek olurdu).

## Henüz yapılmadı

- `/api/cron/telegram-daily` — günlük özet (kaç tarama, kaç risk, kaç hata).
  Kullanıcı "ileride" dedi; `vercel.json`'daki cron listesine eklenecek.
