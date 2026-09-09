# Kimlik doğrulama — kurulum ve mimari

Aşama 3A. Supabase Auth (GoTrue) tabanlı e-posta + şifre girişi.

---

## 1. Mimari kararı: tarayıcıda Supabase JS yok

Alışılmış kurulum `@supabase/supabase-js` kütüphanesini tarayıcıya yükler.
Burada öyle yapılmadı. Üç nedeni var:

1. **Token'ın durduğu yer.** supabase-js oturumu varsayılan olarak
   `localStorage`'a yazar. Orada duran access ve refresh token'ı sayfadaki
   herhangi bir script okuyabilir; tek bir XSS doğrudan hesap devri demektir.
   Bizim kurulumumuzda token'lar `HttpOnly` çerezlerde; JavaScript onları
   göremez.
2. **CSP.** Site hash tabanlı bir Content-Security-Policy kullanıyor ve dış
   kaynaktan script yüklemiyor. Kütüphaneyi eklemek bu politikayı gevşetmeyi
   gerektirirdi.
3. **Bağımlılık yok.** Projede `package.json`, `node_modules` ve derleme adımı
   yok; bu, dağıtımı basit ve tedarik zinciri yüzeyini sıfır tutuyor.

Bunun yerine kimlik işlemleri kendi sunucu uçlarımızdan GoTrue'nun REST
arayüzüne gidiyor:

```
tarayıcı ──POST /api/auth/login──> bizim fonksiyonumuz ──> Supabase GoTrue
         <──Set-Cookie: cl_at; HttpOnly; Secure; SameSite=Lax──
```

### Çerezler

| Çerez | İçerik | Ömür | Bayraklar |
|---|---|---|---|
| `cl_sid` | Anonim oturum kimliği (256 bit rastgele) | 1 yıl | HttpOnly, Secure, SameSite=Lax |
| `cl_at` | Access token | Oturumluk (tarayıcı kapanınca düşer) | HttpOnly, Secure, SameSite=Lax |
| `cl_rt` | Refresh token | 30 gün | HttpOnly, Secure, SameSite=Lax |

`cl_rt` yolu `/` — başta yalnızca `/api/auth` düşünülmüştü, ama o zaman
`/api/scan` ve `/api/history` istekleri çerezi taşımaz ve access token
dolduğunda yenileme hiç çalışmazdı: kullanıcı bir saat sonra sessizce anonime
düşerdi. Koruma HttpOnly + Secure + SameSite üçlüsünden geliyor.

### Kimlik nasıl çözülüyor

`GET /auth/v1/user` çağrısıyla, yani her istekte Supabase'e sorularak. JWT
imzası yerelde doğrulanmıyor. Bu bilinçli bir tercih: yerel imza doğrulaması
iptal edilmiş bir oturumu, silinmiş veya askıya alınmış bir kullanıcıyı fark
edemez. Ağ turu maliyeti (~80 ms) tarama süresinin yanında önemsiz.

Access token süresi dolmuşsa `cl_rt` ile sessizce yenilenir ve yeni çerezler
yanıta eklenir. Yenilenemezse oturum çerezleri temizlenir; kullanıcı geçersiz
bir çerezle dolaşmaz.

---

## 2. Ortam değişkenleri

Vercel → Project → Settings → Environment Variables. Üçü de **Production,
Preview ve Development** için tanımlanmalı.

| Değişken | Not |
|---|---|
| `SUPABASE_URL` | Zaten tanımlı |
| `SUPABASE_SERVICE_ROLE_KEY` | Zaten tanımlı. **Asla istemciye gitmez.** |
| `SUPABASE_ANON_KEY` | **YENİ.** Supabase → Settings → API → `anon` / `public` anahtarı |
| `PUBLIC_SITE_URL` | İsteğe bağlı. Tanımsızsa `https://www.cyberlionai.com` kullanılır |

`SUPABASE_ANON_KEY` yayınlanabilir bir anahtardır, ama bu kurulumda yine de
yalnızca sunucuda kullanılıyor — istemci bundle'ına konmuyor.

Bu değişken tanımlı değilken kimlik uçları `503 auth_unavailable` döner.
Tarama, geçmiş ve PDF etkilenmez; site anonim modda çalışmaya devam eder.

---

## 3. Supabase Dashboard adımları

Aşağıdakileri sizin yapmanız gerekiyor. Hiçbir adımda bana secret göndermeniz
gerekmiyor.

### 3.1 URL yapılandırması

**Authentication → URL Configuration**

- **Site URL:** `https://www.cyberlionai.com`
- **Redirect URLs** (her birini ayrı satır olarak ekleyin):
  ```
  https://www.cyberlionai.com/
  https://cyberlionai.com/
  ```

Apex adres Vercel tarafından `www`'ya 308 ile yönlendiriliyor ve sorgu dizesi
korunuyor; yine de kullanıcı bağlantıyı apex olarak açarsa engellenmemesi için
ikisi de listede olmalı.

Kod her zaman `PUBLIC_SITE_URL` değerini `redirect_to` olarak gönderir —
istemciden gelen bir adrese göre ayarlanmaz. Aksi hâlde saldırgan, onay
bağlantısını kendi sitesine yönlendirecek bir kayıt isteği tetikleyebilirdi.

### 3.2 E-posta onayı

**Authentication → Providers → Email**

- **Confirm email: AÇIK** (önerilen)

Açıkken kayıt oturum açmaz; kullanıcıya onay e-postası gider ve arayüz
"onay bekleniyor" mesajı gösterir. Kapalıyken kayıt anında giriş yapar.
Kod her iki durumu da destekliyor, ayar değiştirince kod değişikliği gerekmez.

### 3.3 E-posta şablonları — **bu adım zorunlu**

**Authentication → Email Templates**

Supabase'in varsayılan şablonları `{{ .ConfirmationURL }}` kullanır. O akışta
gerçek access token adres çubuğunda `#access_token=...` olarak taşınır; orada
durduğu sürece tarayıcı geçmişinde, kaydedilen bağlantılarda ve yönlendirme
zincirinde görünür.

Bunun yerine **token_hash** akışı kullanılıyor: adres çubuğunda tek kullanımlık
bir kod taşınır ve oturuma sunucuda çevrilir. Bunun için üç şablonda da
bağlantıyı aşağıdaki gibi değiştirin.

**Confirm signup:**
```html
<h2>Cyber Lion AI hesabınızı doğrulayın</h2>
<p>Hesabınızı etkinleştirmek için aşağıdaki bağlantıya tıklayın:</p>
<p><a href="https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=signup">Hesabımı doğrula</a></p>
<p>Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
```

**Reset password:**
```html
<h2>Şifrenizi sıfırlayın</h2>
<p>Yeni bir şifre belirlemek için aşağıdaki bağlantıya tıklayın:</p>
<p><a href="https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=recovery">Şifremi sıfırla</a></p>
<p>Bu isteği siz yapmadıysanız şifreniz değişmez; bu e-postayı yok sayabilirsiniz.</p>
```

**Magic Link:**
```html
<h2>Cyber Lion AI'ya giriş</h2>
<p>Giriş yapmak için aşağıdaki bağlantıya tıklayın:</p>
<p><a href="https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=magiclink">Giriş yap</a></p>
```

`type` parametresi şablona göre değişir ve doğru olmalı: `signup`, `recovery`,
`magiclink`. Uç, gelen tipi doğrular; yanlış tip `link_invalid` döner.

### 3.4 Gönderen adresi

**Project Settings → Authentication → SMTP Settings**

Varsayılan Supabase SMTP'si **saatte 3-4 e-posta** ile sınırlıdır ve gönderen
`noreply@mail.app.supabase.io` görünür. Üretim için kendi alan adınızdan
gönderim kurun:

1. Bir e-posta sağlayıcısı seçin (Resend, Postmark, SendGrid, Amazon SES).
2. `cyberlionai.com` alan adını doğrulayın — sağlayıcının verdiği SPF, DKIM ve
   DMARC kayıtlarını DNS'e ekleyin. Bunlar olmadan e-postalar spam'e düşer.
3. Supabase'de **Enable Custom SMTP**'yi açın; host, port, kullanıcı ve şifreyi
   girin. Sender email: `hesap@cyberlionai.com`, sender name: `Cyber Lion AI`.
4. **Rate Limits** bölümünde saatlik e-posta sınırını yükseltin.

SMTP bilgilerini bana göndermenize gerek yok; bunlar yalnızca Supabase'de durur.

### 3.5 Şifre politikası

**Authentication → Providers → Email → Password Requirements**

Minimum uzunluğu **10** yapın. Uygulama katmanı zaten 10 karakter dayatıyor;
Supabase tarafını da hizalamak, doğrudan API'ye giden bir isteğin daha zayıf
bir şifre bırakmasını engeller.

### 3.6 Opsiyonel: Google ile giriş

Şu an kapalı. Açmak isterseniz:

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID**
   (tip: Web application).
2. **Authorized redirect URI** olarak Supabase'in verdiği adresi ekleyin:
   `https://nqvuayhedqpgwftonesl.supabase.co/auth/v1/callback`
3. Supabase → Authentication → Providers → **Google**'ı açın; Client ID ve
   Client Secret'ı oraya girin (bana göndermeyin).
4. Bana haber verin: OAuth akışı tarayıcı yönlendirmesiyle çalıştığı için
   `/api/auth/oauth/start` ve `/api/auth/oauth/callback` uçlarını eklemem
   gerekiyor. Mevcut kod bunları içermiyor — sağlayıcı ayarını açmak tek
   başına giriş düğmesi oluşturmaz.

---

## 4. Anonim geçmişin hesaba devri

Kullanıcı kaydolduğunda veya giriş yaptığında, aynı tarayıcıdaki anonim
oturumun tarama kayıtları hesabına taşınır.

```sql
UPDATE cl_scans
   SET user_id = <kullanıcı>, anonymous_session_id = NULL
 WHERE anonymous_session_id = <isteğin kendi çerezindeki oturum>
```

- **Tek ifade**, dolayısıyla atomik. Ayrı okuma + yazma turu yok.
- **Filtre yalnızca çerezden gelir.** İstemci hangi oturumun devralınacağını
  söyleyemez; gövdede böyle bir alan yok. Başka bir oturumun kimliğini bilmek
  işe yaramaz.
- **Tekrar çalıştırılabilir.** İkinci çağrıda eşleşen satır kalmaz, 0 döner.
- **Sıra önemli:** önce veritabanı, sonra kota. UPDATE gerçekte kaç satır
  taşıdığını döndürür, kota tam o kadar artırılır. Ters sırada olsaydı, kota
  artıp devir başarısız olduğunda kullanıcı hakkını boş yere kaybederdi.
- **Başarısızlık veri kaybettirmez.** Devir olmazsa kayıtlar anonim oturumda
  kalır; kullanıcı çıkış yapınca geçmişini yine görür. Bu yüzden hata giriş
  işlemini başarısız saymaz.

`cl_sid` çerezi girişten sonra da silinmez: çıkış yapıldığında kullanıcı aynı
anonim geçmişe ve kota sayacına döner.

---

## 5. Kota politikası

| Durum | Anahtar | Sınır |
|---|---|---|
| Anonim | `cl:quota:<oturum kimliği>` | 5 tarama |
| Giriş yapmış | `cl:quota:u:<kullanıcı kimliği>` | 5 tarama |

Devralınan taramalar hesabın kotasına eklenir (üst sınırı aşmadan). Aksi hâlde
çıkış yapıp yeniden kaydolarak sınırsız hak üretmek mümkün olurdu.

Anonim oturumun sayacı devirden sonra da sıfırlanmaz. Yani taramalar toplamda
iki kez sayılır: bir kez hesapta, bir kez eski anonim oturumda. Bu bilinçli ve
kötüye kullanıma karşı muhafazakâr bir seçim.

IP hız sınırı (10 dakikada 12 tarama) hem anonim hem giriş yapmış kullanıcıda
aynı şekilde uygulanır; giriş yapmak bu sınırı kaldırmaz.

Her iki sınır da **fail-closed**: Upstash erişilemiyorsa uç `503` döner.

---

## 6. Uçlar

Hepsi `POST` (aksi belirtilmedikçe), gövde JSON, yanıt JSON.

| Uç | Gövde | Deneme sınırı (IP başına) |
|---|---|---|
| `POST /api/auth/register` | `{email, password}` | 5 / saat |
| `POST /api/auth/login` | `{email, password}` | 10 / 15 dk |
| `POST /api/auth/logout` | — | — |
| `GET  /api/auth/me` | — | — |
| `POST /api/auth/recover` | `{email}` | 5 / saat |
| `POST /api/auth/magiclink` | `{email}` | 5 / saat |
| `POST /api/auth/verify` | `{token_hash, type}` | 20 / 15 dk |
| `POST /api/auth/password` | `{password}` | 10 / saat |

### Hata kodları

`invalid_email`, `invalid_credentials`, `email_taken`, `email_not_confirmed`,
`password_too_short`, `password_too_long`, `weak_password`, `link_invalid`,
`too_many_requests`, `not_authenticated`, `auth_unavailable`,
`service_unavailable`.

### Kullanıcı sayımına karşı

- **Giriş:** "kullanıcı yok" ile "şifre yanlış" aynı kodu döndürür
  (`invalid_credentials`).
- **Şifre sıfırlama ve magic link:** adres kayıtlı olsa da olmasa da `200 ok`
  döner. Gerçek sonuç yalnızca posta kutusunda görünür.

---

## 7. Sahiplik

`service_role` RLS'i baypas eder, bu yüzden sahiplik kontrolü **uygulama
katmanında zorunlu** ve her sorgunun içinde:

```js
owner.userId ? 'user_id=eq.' + userId
             : 'anonymous_session_id=eq.' + sessionId
```

Giriş yapmış kullanıcı yalnızca `user_id` kayıtlarını, anonim kullanıcı
yalnızca kendi doğrulanmış `cl_sid` kayıtlarını görür, siler ve raporlar.
Kayıt yoksa da başkasına aitse de aynı `404` döner; varlığı sızdırılmaz.

Veritabanı tarafında ayrıca RLS açık ve FORCE; `anon` rolü için hiçbir politika
yok, `authenticated` için yalnızca `user_id = auth.uid()` şartlı SELECT ve
DELETE var. Bu ikinci savunma katmanı, uygulama katmanında bir hata olursa
devreye girer.
