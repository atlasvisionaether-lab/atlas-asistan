# Supabase URL ayarları — Atlas Asistan ve Cyber Lion AI

İki uygulama, iki AYRI Supabase projesi. Ayarlar birbirine karışmamalı.

| Uygulama | Supabase projesi | Oturumu işleyen site |
|---|---|---|
| Atlas Asistan paneli | `atlas-asistan` — `lfltontezrfcmjntsgix` | Vercel projesi `atlas-asistan-panel-preview` → `https://atlas-asistan-panel-preview.vercel.app` (özel alan adı yok) |
| Cyber Lion AI | `cyberlionai` — `aohsgagiyaseinhmyfub` | `https://www.cyberlionai.com` |

`atlasasistan.com` Atlas Asistan'ın **statik tanıtım sitesidir** (Vercel `atlasasistan-static`);
Supabase oturum kodu yok. Site URL olarak verilirse e-posta bağlantıları tanıtım sayfasına
düşer ve hiçbir şey olmaz.

## 1. Atlas Asistan (`lfltontezrfcmjntsgix`)

Dashboard › Authentication › URL Configuration:

- **Site URL:** `https://atlas-asistan-panel-preview.vercel.app`
  - Şu an tek bir dağıtımın adresi (`…-4j663bed2-…vercel.app`) yazılı. O dağıtım silinince ya da
    korumalı olduğunda kayıt onayı / şifre sıfırlama bağlantıları ölü kalır — "süresi dolmuş"
    şikâyetinin Atlas Asistan tarafındaki sebebi bu.
  - Panele özel alan adı (ör. `panel.atlasasistan.com`) eklenirse Site URL o olmalı.
- **Redirect URLs:**
  ```
  https://atlas-asistan-panel-preview.vercel.app/**
  https://atlas-asistan-panel-preview-*-atlas-asistan.vercel.app/**
  http://localhost:3000/**
  ```
  Önizleme deseninde **takım soneki (`-atlas-asistan`) şart**: `…preview-*.vercel.app` gibi
  soneksiz bir desen, başka bir Vercel hesabının açabileceği bir adresi de kabul eder ve
  oturum belirteci o adrese yönlendirilebilir.

Panel kodu (`panel/scripts/auth.js`) yalnızca e-posta + şifreyle giriş yapıyor; kayıt ve
şifre sıfırlama e-postaları tamamen Supabase'in kendi şablonlarından ve Site URL'den çıkıyor.
Bu yüzden düzeltme kodda değil, bu ekranda.

**Kullanıcı ekleme:** Dashboard › Authentication › Users › Add user › Create new user ›
"Auto Confirm User" işaretli. `auth.users` tablosuna elle SQL `INSERT` YAPILMAZ: GoTrue'nun
beklediği alanlar (instance_id, aud, kimlik satırı…) eksik kalır, kullanıcı giriş yapamaz.
Uygulama tarafı yetkisi `public.users` satırıyla verilir (`role = 'owner'`).

**Kayıtta otomatik onay KAPALI kalmalı** (Providers › Email › Confirm email açık): açılırsa
herkes başkasının e-postasıyla hesap açabilir.

## 2. Cyber Lion AI (`aohsgagiyaseinhmyfub`)

- **Site URL:** `https://www.cyberlionai.com`
- **Redirect URLs:**
  ```
  https://www.cyberlionai.com/**
  https://cyberlionai.com/**
  https://cyberlionai-*-atlas-asistan.vercel.app/**
  http://localhost:3000/**
  ```
- **E-posta şablonları** bağlantıyı doğrudan siteye `token_hash` ile verir (ayrıntı:
  `cyberlionai/docs/auth.md`):
  - Confirm signup: `https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=signup`
  - Reset password: `https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=recovery`
  - Magic link: `https://www.cyberlionai.com/?token_hash={{ .TokenHash }}&type=magiclink`

  Kod sayfa açılınca DEĞİL, sayfanın JavaScript'i `POST /api/auth/verify` çağırınca
  tüketilir; e-posta tarayıcılarının GET ön izlemesi bağlantıyı yakmaz. `type` şablonla
  uyuşmazsa GoTrue `otp_expired` döner — sıfırlama şablonunda `type=recovery` olduğundan
  emin olun.
- **Providers › Email › Email OTP Expiration:** `86400` (24 saat). Supabase tek bir süre
  tutar; kayıt ve sıfırlama için ayrı süre verilemez.
- Her bağlantı tek kullanımlıktır. Aynı bağlantıyı ikinci kez açmak ya da yeni bağlantı
  istendikten sonra eski e-postayı kullanmak `otp_expired` verir; site bunu kullanıcıya
  açıkça söyler ve Telegram'a `auth fail type=… gotrue=…` uyarısı düşer.

## 3. Yetkili hesap

`atlasvisionaether@gmail.com`:
- Cyber Lion: onaylı, Enterprise (`cl_subscriptions.status = 'MANUAL_ADMIN'`), yönetici
  (`ADMIN_EMAILS`), doğrulanmış alan adları: cyberlionai.com, www.cyberlionai.com,
  atlasasistan.com, www.atlasasistan.com (Vercel hesabında bu e-postayla kayıtlı oldukları
  için elle verildi; `method` boş = elle verilmiş).
- Atlas Asistan: onaylı (Dashboard'dan eklendi), `public.users.role = 'owner'`.

`milletiyuceturk@gmail.com`: test hesabı (Cyber Lion Enterprise, `MANUAL_TEST`); yönetici değil,
alan adı doğrulaması yok.
