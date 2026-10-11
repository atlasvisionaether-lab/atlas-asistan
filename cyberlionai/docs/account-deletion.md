# Hesap ve veri silme: ölçüm, karar, kapsam

Google Play, hesap açtıran bir uygulamanın hesap ve veri silmeyi **hem
uygulama içinden hem herkese açık bir web adresinden** sunmasını şart koşuyor;
KVKK'nın silme talebi de aynı şeyi istiyor. Bu yol depoda **hiç yoktu**:
`/api/history` yalnızca tarama kayıtlarını siliyordu, hesabın kendisi ve
abonelik / cihaz jetonu / bekleme listesi satırları kalıyordu.

Yazılanlar:

| Ne | Nerede |
| --- | --- |
| Uç | `api/panel/account.js` — `DELETE /api/panel/account` |
| Silme işi | `api/_lib/db.js` → `deleteAccountData` |
| Hesap satırı | `api/_lib/auth.js` → `adminDeleteUser` (GoTrue yönetici ucu) |
| Panel düğmesi | `dashboard.html` + `dashboard.js` (`bindDelete`) |
| Web sayfası | `pages/hesap-silme.html` + `hesap-silme.js` → `/hesap-silme` |
| Ağsız sınama | `tools/account-delete-test.js` (41 doğrulama) |
| Üretim doğrulaması | `tools/account-delete-verify.js` (kendi test hesabıyla) |
| Data Safety kaynağı | `legal/data-catalog.json` → `hesapSilme` |

## Ölçüm: yabancı anahtarlar tek tip değil (11.10.2026)

`db/*.sql` ve `db/migrations/*.sql` okundu. `auth.users`'a `user_id` ile bağlı
her tablo ve kısıtı:

| tablo | kısıt | hesap silinince ne olur |
| --- | --- | --- |
| `cl_scans` | `ON DELETE CASCADE` (004) | satır gider |
| `cl_subscriptions` | `ON DELETE CASCADE` | satır gider |
| `cl_device_tokens` | `ON DELETE CASCADE` | satır gider |
| `verified_domains` | `ON DELETE CASCADE` | satır gider |
| `monitor_alerts` | `ON DELETE CASCADE` | satır gider |
| `scan_jobs` | **`ON DELETE SET NULL`** | satır **KALIR**, sahibi NULL olur |
| `scan_logs` | **`ON DELETE SET NULL`** | satır **KALIR**, sahibi NULL olur |
| `fix_orders` | **`ON DELETE SET NULL`** | satır **KALIR**, sahibi NULL olur |
| `cl_waitlist` | **`user_id` sütunu YOK** | satır **KALIR**, e-posta ile duruyor |

Buradaki sonuç kararı belirledi:

> "`auth.users` satırını sil, kısıtlar gerisini halleder" **yanlıştır.** Bu
> yolda `scan_jobs` satırları silinmez; taranan alan adları, bulgular
> (`scan_findings`) ve AI raporları (`ai_reports`) sahipsiz satırlar olarak
> kalır — ve sahipsiz kaldıktan sonra artık hangi hesaba ait olduklarını
> bilmediğimiz için **silinemezler**. `cl_waitlist` ise hiç etkilenmez.

Bu yüzden silme kısıtlara bırakılmadı: `deleteAccountData` her tabloyu
**açıkça** siliyor ve silinen satır sayısını döndürüyor. Sayılar hem yanıtta
hem Telegram denetim izinde (e-posta maskeli, yalnızca sayılar) görünüyor.

## Sıra: veri önce, hesap sonra

Uç ilk olarak `db.deleteAccountData`, sonra `auth.adminDeleteUser` çağırıyor.
Tersi geri alınamaz (yukarıdaki sahipsizleşme). Veri silinip hesap
kapatılamazsa yanıt `account_delete_partial` dönüyor ve kullanıcıya "tekrar
deneyin" deniyor: ikinci deneme veri tarafında 0 satır bulur, yalnızca hesap
satırını kapatır. Sınama bu sırayı kilitliyor.

## Silinmeyen iki tablo — gerekçeli

| tablo | neden kalıyor | ne yapılıyor |
| --- | --- | --- |
| `scan_logs` | Üçüncü bir siteyi kimin taradığını gösteren hukuki ispat günlüğü; tablo yorumunda yazdığı gibi 12 ay saklanıyor (TCK m.243/244 bağlamı) | satır kalıyor, `user_id` NULL'a çekiliyor |
| `fix_orders` | Ücretli düzeltme siparişi: tutar ve ödeme zamanı taşıyor, yani fatura/vergi kaydı | satır kalıyor, `user_id` NULL'a çekiliyor |

KVKK'da yasal yükümlülük bir istisna; kaydı tutmak ile kişiyle
ilişkilendirmemek bir arada mümkün. Aynı mantık ödeme tarafında da geçerli:
fatura ve ödeme kayıtları iyzico'da kalıyor, bizde kart verisi hiç yok —
tuttuğumuz iyzico referansları bu uçta siliniyor.

Her iki tablo `legal/data-catalog.json` içinde `silinebilir: false` +
`silinemezSebep` ile yazılı; Play'in Data Safety formu bu soruyu kalem başına
soruyor ve politika ile form ayrışırsa uygulama reddediliyor.

## Yetki

- Oturum **zorunlu**: çerez ya da `Authorization: Bearer` (mobil uygulama yolu).
- Silinecek kimlik **gövdeden okunmuyor**; çözülen oturumdan geliyor. Sınama
  gövdede `user_id`/`email` okunmasını ayrıca yasaklıyor: okunursa başka bir
  hesabı silmeye çalışan istek yazılabilir hâle gelir.
- Gövdede açık onay dizgesi şart (`confirm`), yoksa `400
  confirmation_required`. Panel düğmesi, panel onay penceresi ve `/hesap-silme`
  sayfası **aynı uca ve aynı dizgeye** gidiyor; sınama üçünü karşılaştırıyor.
- Servis rolü anahtarı yoksa uç hiç başlamıyor (`503
  account_delete_unavailable`): yarısı yapılabilen bir silme sunmaktan iyisi,
  hiç başlamamak.

## Eksik göç

Bir tablo yoksa PostgREST 404 veriyor. Silme durmuyor (o göç uygulanmamış
demektir, silinecek veri de yoktur) ama **sessiz de kalmıyor**: atlanan tablo
yanıtta `skipped` içinde dönüyor.

## Üretimde nasıl doğrulanıyor

`tools/account-delete-verify.js`, gerçek kullanıcıya dokunmadan **kendi test
hesabını** açıp siliyor:

1. `hesap-silme-testi-<rastgele>@cyberlionai.com` hesabını yönetici ucuyla
   açar (`email_confirm: true` — gerçek e-posta gitmez),
2. o hesaba ait `cl_scans` / `cl_device_tokens` / `cl_waitlist` / `scan_logs`
   satırı yazar,
3. test hesabının belirteciyle `DELETE /api/panel/account` çağırır (önce
   onaysız deneyip 400 aldığını da doğrular),
4. satırların gittiğini, `scan_logs` satırının **kaldığını ama sahibinin NULL
   olduğunu**, hesabın `auth.users`'tan kalktığını ve belirtecin artık
   çalışmadığını okur,
5. ne olursa olsun artığı temizler; bir şey kaldıysa "ARTIK KALDI" yazar.

Çalıştırma: `account-delete-verify.yml` iş akışı, `confirm=evet` ile. Üretim
veritabanına yazdığı için zamanlamaya bağlı değil, yalnızca elle. Gerekli
gizli değişkenler `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY`; yoksa betik
tahmin etmiyor, `ÖLÇÜLEMEDİ` diyor.

## Play Console

- Data deletion URL: `https://www.cyberlionai.com/hesap-silme`
  (`/delete-account` da aynı sayfaya çıkıyor).
- Ödeme politikası tarafında seçilen yol değişmedi: uygulama içinde satış yok,
  abonelik web üzerinden.
