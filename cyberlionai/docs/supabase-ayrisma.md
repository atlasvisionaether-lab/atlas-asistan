# Cyber Lion AI için ayrı Supabase projesi — plan ve etki analizi

**Durum: yalnızca plan. Hiçbir şey uygulanmadı.**
Her yazma/oluşturma adımı ayrı onay gerektirir; adımlar § 9'da numaralı.

---

## 0. Neden ayrılıyoruz

`atlas-vision` projesi (`nqvuayhedqpgwftonesl`) en az üç uygulamayla paylaşılıyor:
Atlas Asistan, bir satranç uygulaması ve Cyber Lion AI. `auth.users` üzerinde
başka uygulamalara ait iki tetikleyici var ve biri Cyber Lion AI kaydını
tamamen engelliyor:

```
on_auth_user_created  AFTER INSERT ON auth.users FOR EACH ROW
  → handle_new_user() → INSERT INTO public.profiles (... birth_date ...)
    profiles.birth_date NOT NULL, fonksiyonda hata yakalama yok
```

Cyber Lion AI doğum tarihi sormadığı için tetikleyici hata veriyor, `auth.users`
INSERT'ü geri alınıyor ve kullanıcı hiç oluşturulamıyor.

Ayrıca `profiles_id_fkey` kısıtında `ON DELETE CASCADE` yok; bu yüzden bu
projede **hiçbir kullanıcı silinemiyor**. KVKK'daki silme hakkı için tek başına
yeterli bir gerekçe.

Ayrı proje bu iki sorunu da kökten çözer ve bir uygulamanın diğerinin kimlik
akışını kırmasını kalıcı olarak imkânsız kılar.

---

## 1. Taşınacak yüzey — beklenenden çok küçük

Ölçüm (2026-09-09, salt-okunur):

| | |
|---|---|
| Cyber Lion AI'ya ait canlı tablo | **1 tane:** `public.cl_scans` |
| Satır sayısı | **5** |
| Toplam boyut | **136 kB** |
| `user_id` dolu satır | **0** |
| Farklı anonim oturum | **1** (sizin tarayıcınız) |
| Kayıt aralığı | 2026-09-09 15:19 – 15:21 |
| Cyber Lion AI'ya ait auth kullanıcısı | **0** |

`auth.users`'taki 4 kayıt Atlas Asistan'a ait; Cyber Lion AI henüz tek kullanıcı
oluşturamadı (yukarıdaki blokaj yüzünden). **Taşınacak kimlik verisi yok.**

`db/migrations/001_remediation.sql` ve `002_support.sql` dosyaları
`users`, `scans`, `vulnerabilities`, `support_sessions` gibi tablolar tanımlıyor
ama bunların **hiçbiri veritabanında yok** — o migration'lar hiç uygulanmamış.
Önceki aşamalardan kalan tasarım taslakları. Yeni projeye taşınmayacaklar;
ihtiyaç doğduğunda yeniden ele alınır.

### Yeni projede olacak minimum şema

Yalnızca `public.cl_scans` ve ona ait indeksler, kısıtlar ve RLS politikaları.
Mevcut migration'lar olduğu gibi çalışır:

```
003_scan_history.sql    tablo, indeksler, CHECK kısıtları, RLS + FORCE, politikalar
003b_tighten_grants.sql anon'dan tüm yetkiler geri alınır; authenticated'da
                        yalnızca SELECT + DELETE kalır
004_scans_user_fk.sql   user_id → auth.users(id) ON DELETE CASCADE
```

**Tablo adı `cl_scans` olarak kalacak.** Ayrı projede `cl_` öneki artık gerekli
değil ama yeniden adlandırmak `api/_lib/db.js` içindeki `TABLE` sabitini ve üç
migration dosyasını değiştirmeyi gerektirir. Sıfır kod değişikliğiyle geçmek,
kozmetik bir kazanç için risk almaktan iyi.

### Yeni projede OLMAYACAKLAR

- `profiles`, `chess_profiles` ve benzeri diğer uygulama tabloları
- `auth.users` üzerinde **hiçbir tetikleyici** — Cyber Lion AI'nın kullanıcı
  profiline ihtiyacı yok; sahiplik doğrudan `cl_scans.user_id` üzerinden
- Ek bir `profiles` tablosu. İleride gerekirse eklenir, ama tetikleyici yerine
  uygulama katmanından yazılır ve hata durumunda kaydı engellemez

---

## 2. `cl_scans` verisinin taşınması

5 satır, 136 kB, hepsi tek bir anonim oturuma ait. İki seçenek:

### 2a. Taşıma (önerilen)

Kayıtlar sizin tarayıcınızın `cl_sid` çerezine bağlı. Çerez bizim ürettiğimiz
bir değer ve **Supabase'den bağımsız** — proje değişse de tarayıcınızda aynı
kalır. Dolayısıyla 5 satır yeni projeye kopyalanırsa geçmişiniz kesintisiz
görünmeye devam eder.

Yöntem: eski projeden `SELECT`, yeni projeye `INSERT`. 5 satır için tek bir
`INSERT ... VALUES` ifadesi yeterli; `pg_dump` gerekmez.

```sql
-- Eski projede (salt-okunur):
SELECT id, anonymous_session_id, host, score, checks_total, checks_passed,
       checks_failed, checks_skipped, http_status, redirects, duration_ms,
       findings, warnings, scanner_version, report_version, error_code, scanned_at
  FROM public.cl_scans ORDER BY scanned_at;

-- Yeni projede: yukarıdaki satırlar birebir INSERT edilir.
-- id ve scanned_at korunur; PDF bağlantıları ve geçmiş sıralaması bozulmaz.
```

**Kota notu:** ücretsiz tarama sayacı Upstash'te tutuluyor ve Upstash
değişmiyor. Anahtar `cl:quota:<oturum kimliği>` olduğu için taşıma sonrası
kota da olduğu gibi devam eder — yeniden 5 hak doğmaz.

**Rollback:** taşıma tek yönlü kopyalama; eski projedeki satırlara
dokunulmaz. Yeni projede sorun çıkarsa ortam değişkenleri eski değerlere
döndürülür ve eski veri hâlâ yerindedir. Kopyalanan satırların geri alınması
gerekirse yeni projede `DELETE FROM cl_scans WHERE id IN (...)` yeterli.

### 2b. Taşımama

5 kayıt sizin kendi test taramalarınız. Sıfırdan başlamak da kabul edilebilir;
o hâlde geçiş anında geçmiş paneliniz boş görünür.

**Önerim 2a.** Maliyeti bir SQL ifadesi, kazancı geçmişin kesintisiz kalması ve
taşıma yönteminin gerçek veriyle bir kez sınanmış olması.

---

## 3. Auth kullanıcıları

**Taşınacak kullanıcı yok.** Cyber Lion AI'nın kendi kullanıcısı hiç olmadı.
`auth.users`'taki 4 kayıt Atlas Asistan'a ait ve orada kalmalı.

Bu, geçişin en riskli kısmını tamamen ortadan kaldırıyor: şifre hash'lerinin
taşınması, oturumların geçersizleşmesi, kullanıcıya "yeniden giriş yapın"
demek gibi hiçbir sorun yok.

İleride gerekirse (bu senaryo bugün geçerli değil): Supabase projeler arası
kullanıcı taşımayı `auth.users` satırlarının `encrypted_password` dahil
kopyalanmasıyla destekler; her iki veritabanına doğrudan bağlantı gerekir.

### Kullanıcı deneyimi

Geçiş anında hiç kullanıcı olmadığı için **kimse etkilenmez.** Anonim
ziyaretçiler de etkilenmez: `cl_sid` çerezi bizim, kota Upstash'te, tarama
motoru veritabanına bağlı değil.

---

## 4. RLS, FK ve cascade tasarımı

Mevcut tasarım doğru çalışıyor ve olduğu gibi taşınıyor. Yeni projede tek fark:
`profiles` engeli olmadığı için cascade **gerçekten çalışabilecek**.

```
cl_scans
  user_id              UUID  →  auth.users(id) ON DELETE CASCADE
  anonymous_session_id TEXT  →  CHECK: ^[0-9a-f]{64}$
  CHECK cl_scans_single_owner: tam olarak biri dolu

RLS: ENABLE + FORCE
  anon           → hiçbir politika yok + tüm yetkiler REVOKE edilmiş
  authenticated  → SELECT, DELETE, yalnızca user_id = auth.uid()
  service_role   → tam erişim; sahiplik kontrolü uygulama katmanında,
                   her sorgunun içinde
```

**Katmanlı savunma:** `service_role` RLS'i baypas ettiği için asıl kontrol
uygulama katmanında (`api/_lib/db.js` içindeki `ownerFilter`). RLS ikinci
katman: uygulama katmanında bir hata olursa devreye girer.

**Yeni projede ek olarak doğrulanacak:** gerçek bir kullanıcı silindiğinde
`cl_scans` kayıtlarının da silindiği. Mevcut projede bu test edilemiyor çünkü
`profiles_id_fkey` kullanıcı silmeyi tamamen engelliyor. Yeni projede rollback'li
bir transaction içinde uçtan uca doğrulanabilir.

---

## 5. E-posta şablonları (TokenHash)

Yeni projede sıfırdan ayarlanacak. `{{ .ConfirmationURL }}` **kullanılmayacak**:
o akışta gerçek access token adres çubuğunda `#access_token=...` olarak taşınır
ve tarayıcı geçmişinde, kaydedilen bağlantılarda, yönlendirme zincirinde kalır.
`{{ .TokenHash }}` tek kullanımlıktır ve oturuma sunucuda çevrilir.

**Confirm signup**
```html
<h2>Cyber Lion AI hesabınızı doğrulayın</h2>
<p>Merhaba,</p>
<p>Cyber Lion AI hesabınızı etkinleştirmek için aşağıdaki bağlantıya tıklayın:</p>
<p><a href="https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=signup">Hesabımı doğrula</a></p>
<p>Bu bağlantı tek kullanımlıktır ve kısa süre sonra geçerliliğini yitirir.</p>
<p>Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; hesap oluşturulmaz.</p>
<p>— Cyber Lion AI</p>
```

**Reset password**
```html
<h2>Şifrenizi sıfırlayın</h2>
<p>Merhaba,</p>
<p>Yeni bir şifre belirlemek için aşağıdaki bağlantıya tıklayın:</p>
<p><a href="https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=recovery">Şifremi sıfırla</a></p>
<p>Bu bağlantı tek kullanımlıktır ve kısa süre sonra geçerliliğini yitirir.</p>
<p>Bu isteği siz yapmadıysanız şifreniz değişmez; bu e-postayı yok sayabilirsiniz.</p>
<p>— Cyber Lion AI</p>
```

**Magic Link**
```html
<h2>Cyber Lion AI'ya giriş</h2>
<p>Merhaba,</p>
<p>Giriş yapmak için aşağıdaki bağlantıya tıklayın:</p>
<p><a href="https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=magiclink">Giriş yap</a></p>
<p>Bu bağlantı tek kullanımlıktır ve kısa süre sonra geçerliliğini yitirir.</p>
<p>Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
<p>— Cyber Lion AI</p>
```

`type` değeri şablona göre değişir ve doğru olmalı: `signup`, `recovery`,
`magiclink`. Uç gelen tipi doğrular; yanlış tip `link_invalid` döner.

**Gönderen:** yeni projede de varsayılan Supabase SMTP'si saatte 3-4 e-posta ile
sınırlı. Bu, gerçek kullanıcı trafiği başlamadan önce çözülmeli (§ 8).

---

## 6. Ortam değişkenleri ve geçiş sırası

### Değişecek üç değişken

| Değişken | Şimdi | Sonra |
|---|---|---|
| `SUPABASE_URL` | `atlas-vision` projesi | **yeni proje** |
| `SUPABASE_ANON_KEY` | `atlas-vision` anon | **yeni proje anon** |
| `SUPABASE_SERVICE_ROLE_KEY` | `atlas-vision` service role | **yeni proje service role** |

### Değişmeyenler

`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — kota ve hız sınırı
Upstash'te; Supabase değişikliğinden etkilenmiyor. `PUBLIC_SITE_URL` de aynı
kalır.

### Sıra

Kritik nokta: **önce Preview, sonra Production.** Preview ortamı ayrı env
değişkenleri kullanabildiği için yeni proje canlıya dokunmadan uçtan uca
denenebilir.

1. Yeni proje oluşturulur, migration'lar uygulanır, Auth ayarları ve şablonlar
   girilir
2. Vercel'de **yalnızca Preview** kapsamındaki üç değişken yeni projeye çevrilir
3. PR #14'ün preview deploy'unda gerçek kayıt akışı denenir: kayıt → onay
   e-postası → doğrulama → giriş → anonim geçmişin devri → çıkış → şifre
   sıfırlama. Bu adımda **gerçek bir e-postaya** mesaj gider; onayınız gerekir
4. Preview yeşilse PR #14 merge edilir (production hâlâ eski projede, davranış
   değişmez — kayıt `signup_unavailable` vermeye devam eder)
5. `cl_scans`'in 5 satırı yeni projeye kopyalanır
6. Production kapsamındaki üç değişken yeni projeye çevrilir
7. Production'da yeniden deploy alınır (env değişikliği yeni deploy gerektirir)
8. Üretim doğrulama iş akışı (`prod-verify.sh`) main üzerinde çalıştırılır
9. Eski projedeki `cl_scans` tablosu bir süre **dokunulmadan bırakılır** —
   geri dönüş için. En az bir hafta sonra silinmesi ayrıca konuşulur

---

## 7. Kesinti, risk ve geri dönüş

### Kesinti

**Beklenen kesinti: yok.** Vercel ortam değişkeni değişikliği yeni bir deploy
tetikler; yeni deploy hazır olana kadar eski deploy trafiği almaya devam eder.
Geçiş anı, iki deploy arasındaki atomik yönlendirme değişimidir.

6. ve 7. adım arasında (env değişti, deploy henüz yayında değil) yeni
istekler hâlâ eski deploy'a gider ve eski projeyi kullanır. Tutarsızlık
oluşmaz.

### Riskler

| Risk | Olasılık | Etki | Azaltma |
|---|---|---|---|
| Yeni projede migration eksik/hatalı uygulanır | Düşük | Geçmiş ve PDF çalışmaz | Preview'da tam doğrulama; migration'lar zaten üretimde bir kez çalıştı |
| Redirect URL / şablon yanlış girilir | Orta | Onay ve sıfırlama bağlantıları çalışmaz | Preview'da gerçek e-posta ile sınanır (adım 3) |
| Service role anahtarı yanlış kopyalanır | Düşük | Geçmiş `503`, tarama çalışır | `/api/history` yanıtı anında gösterir |
| 5 satır kopyalanmaz/eksik kopyalanır | Düşük | Geçmiş paneli boş | Eski projede veri duruyor; yeniden kopyalanabilir |
| Yeni proje bölgesi gecikme artırır | — | Aşağıda ayrı başlık | Bölge seçimi bilinçli yapılır |

### Geri dönüş

Her adım geri alınabilir:

- **Adım 2–4 arası:** Preview değişkenlerini eski değerlere döndür. Production
  hiç etkilenmemiştir
- **Adım 6–7 sonrası:** Production değişkenlerini eski değerlere döndür ve
  yeniden deploy al. Eski projedeki `cl_scans` dokunulmadığı için veri
  kaybı olmaz
- **Geri dönüş süresi:** bir env değişikliği + bir deploy, yaklaşık 2 dakika

Geri dönüşte kaybolacak tek şey, yeni projede geçiş sonrası oluşturulmuş
kullanıcılar ve taramalardır. Bu yüzden geri dönüş kararı hızlı verilmeli;
adım 8'deki doğrulama bunun içindir.

### Bölge seçimi — geçerken ele alınabilecek bir iyileştirme

Mevcut proje `eu-central-1` (Frankfurt). Vercel fonksiyonlarımız ise `iad1`
(ABD doğu) bölgesinde çalışıyor — üretim yanıt başlıklarındaki
`x-vercel-id: iad1` bunu gösteriyor.

Yani her Supabase çağrısı Atlantik'i geçiyor. Kimlik çözümü isteğe bir GoTrue
çağrısı ekliyor; geçmiş ve rapor uçları birer PostgREST çağrısı daha. Kabaca
çağrı başına 90–100 ms ek gecikme.

İki seçenek:

- **`eu-central-1`'de kalmak** (önerilen): veri Avrupa'da kalır, KVKK/GDPR
  açısından savunması kolay, diğer projelerle tutarlı. İstenirse Vercel
  fonksiyon bölgesi `fra1` yapılarak gecikme büyük ölçüde kapatılabilir —
  `vercel.json` içinde tek satır, ayrı ve düşük riskli bir değişiklik
- **ABD bölgesi seçmek:** gecikme azalır ama veri Avrupa dışına çıkar

Bu karar geçişten bağımsız verilebilir; planı bloke etmiyor.

---

## 8. Geçişe kadar `signup_unavailable` yeterli mi

**Kısmen. Teknik olarak doğru, ürün olarak eksik.**

Şu an bir ziyaretçi kayıt olmayı denediğinde:

- Sunucu `503` + `signup_unavailable` döner
- Kullanıcı şunu görür: *"Kayıt şu anda tamamlanamıyor. Kısa süre içinde
  düzeltilecek; lütfen sonra tekrar deneyin."*
- Sunucu logunda `signup blocked by database trigger` satırı oluşur
- E-posta ve şifre loglanmaz

Bu, sessizce başarısız olmaktan veya anlamsız bir hata göstermekten kesinlikle
iyi. Ama şunlar hâlâ doğru değil:

1. **Giriş ve kayıt sekmeleri hâlâ eşit görünüyor.** Kullanıcı kayıt sekmesini
   seçip formu dolduruyor, sonra çalışmadığını öğreniyor. Boşa emek
2. **Kotası biten anonim kullanıcıya kayıt modalı açılıyor** — çalışmayan bir
   yola yönlendiriyoruz
3. Süre belirsiz; "kısa süre içinde" ölçülebilir bir şey söylemiyor

Geçiş birkaç gün içinde yapılacaksa mevcut davranış kabul edilebilir. Daha
uzun sürecekse şunu öneririm (ayrı, küçük bir PR):

- Kayıt sekmesini ve kota dolduğunda açılan kayıt modalını geçici olarak
  devre dışı bırakmak
- Yerine tek cümlelik bir bilgi: *"Hesap oluşturma yakında açılıyor. Şimdilik
  kayıt olmadan 5 ücretsiz tarama yapabilirsiniz."*
- Giriş, şifre sıfırlama ve magic link açık kalır (bunlar çalışıyor)

Bunu bir bayrakla (`CONFIG.signupEnabled`) yapmak, geçiş bitince tek satırla
geri açmayı sağlar.

**Karar sizin:** geçiş bu hafta içindeyse dokunmayalım; belirsizse bayrağı
ekleyeyim.

---

## 9. Onay noktaları ve değişecek kaynakların tam listesi

Hiçbiri uygulanmadı. Her biri ayrı onay bekliyor.

| # | Adım | Kapsam | Maliyet |
|---|---|---|---|
| 1 | Yeni Supabase projesi oluşturma | `hcjcqznktyyimmoaqyos` organizasyonu, `eu-central-1` | **Aylık 0 ₺** (doğrulandı) |
| 2 | Migration 003 + 003b + 004'ü yeni projede uygulama | Yeni proje şeması | — |
| 3 | Auth ayarları: Site URL, Redirect URLs, şifre min. 10, e-posta onayı | Yeni proje | — |
| 4 | E-posta şablonları (§ 5) | Yeni proje | — |
| 5 | Vercel **Preview** env: üç değişken | Preview ortamı | — |
| 6 | Preview'da gerçek kayıt akışı testi | **Gerçek e-posta gönderir** | — |
| 7 | PR #14 merge | Production kod | — |
| 8 | `cl_scans` 5 satırın kopyalanması | Yeni projeye INSERT | — |
| 9 | Vercel **Production** env: üç değişken + deploy | Production | — |
| 10 | `prod-verify.sh` çalıştırma | Salt-okunur + kendi kayıtlarını siler | — |
| 11 | Eski `cl_scans`'in silinmesi | En az bir hafta sonra, ayrıca konuşulur | — |

### Değişecek kaynaklar

**Supabase (yeni proje):** `public.cl_scans` tablosu, indeksleri, kısıtları,
RLS politikaları, grant'ları; Auth URL yapılandırması; üç e-posta şablonu;
şifre politikası.

**Supabase (`atlas-vision`, mevcut):** **hiçbir değişiklik yok.** Ne şema, ne
tetikleyici, ne veri, ne ayar. Adım 11'e kadar `cl_scans` de olduğu gibi kalır.

**Vercel:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(önce Preview, sonra Production). Opsiyonel: `vercel.json` içinde fonksiyon
bölgesi.

**Depo:** kod değişikliği **gerekmiyor**. Yalnızca dokümantasyon güncellemesi
(`docs/auth.md` § 8'in "çözüldü" olarak revize edilmesi, proje referansının
yenilenmesi). § 8'deki bayrak seçilirse `index.html` içinde küçük bir
değişiklik.

**Etkilenmeyenler:** Upstash (kota, hız sınırı), tarama motoru, SSRF koruması,
PDF üretimi, `cl_sid` anonim oturum çerezi, alan adı ve DNS.

---

## 10. Özet

Bu geçiş, adı büyük ama yüzeyi küçük bir iş: taşınacak tek tablo, 5 satır,
136 kB ve **sıfır kullanıcı**. En riskli kısım olan kimlik taşıması hiç yok.
Kod değişikliği gerekmiyor; üç ortam değişkeni değişiyor.

Kazanç kalıcı: Cyber Lion AI'nın kimlik akışı bir daha başka bir uygulamanın
tetikleyicisine bağlı olmayacak ve kullanıcı silme (dolayısıyla KVKK'daki
silme hakkı) gerçekten çalışacak.
