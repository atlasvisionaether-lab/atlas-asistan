# Atlas Asistan Panel Prototipi (DEMO)

Türkiye’deki güzellik, lazer/estetik merkezleri ve seçili klinikler için randevu, müşteri iletişimi, kampanya ve operasyon yönetimi panelinin statik prototipi.

## Uyarı
Bu bir prototiptir. Gerçek müşteri verisi, canlı entegrasyon, mesaj gönderimi ve oturum yönetimi yoktur. Tüm metrikler DEMO/ÖRNEK veridir.

## Yerel test
```powershell
python -m http.server 8080 --directory panel
```
Tarayıcı: `http://localhost:8080`

## Kapsam
13 ekran: Genel Bakış, Gelen Kutusu, Randevular, Müşteriler/Leadler, Kampanyalar, Otomasyonlar, Hizmetler/Fiyatlar, AI Asistan Ayarları, Tasarım/Widget, Eklentiler, Analitik, Ekip/Yetkiler, Ayarlar.

## Sınırlamalar
- Gerçek auth, veritabanı, API veya connector yoktur.
- Aksiyonlar yalnızca mock toast üretir.
- Kampanyalar gönderilmez.
- Widget canlı değildir.
- `migrations/0001_panel_schema.sql`: Yalnızca mimari taslaktır, ASLA ÇALIŞTIRILMAZ.
- `migrations/0001_supabase_schema.sql`: Supabase'de zaten uygulanmış şemanın GitHub'daki referans kopyasıdır. Doğrudan çalıştırılması gerekmez; yalnızca referans ve dokümantasyon amaçlıdır.

## Vercel Preview

Bu demo panel, ayrı atlas-asistan-panel-preview Vercel projesinde yalnızca preview/test amacıyla yayınlanır. Mevcut canlı site, Cyber Lion projesi, özel domainler ve canlı entegrasyonlar bu preview'dan bağımsızdır.

## Self-servis kayıt ve kurulum (2026-10-25)

- Giriş ekranında **Kayıt ol** (klinik adı + e-posta + şifre), **Şifremi unuttum** ve şifre yenileme var (`scripts/auth.js`).
- İlk oturumda `atlas_claim_clinic` RPC'si kurumu ve `owner` kullanıcıyı açar; kurulumu bitmeyen kullanıcı `#onboarding`'e gider.
- **Kurulum** ekranı: hizmet → ödeme → WhatsApp → test. Adımlar veriden türetilir (`atlas_onboarding_status`); elle işaretlenmez.
- **Abonelik / Faturalar**: `atlas_my_orders` (yalnız owner/manager; fatura bilgisi dönmez). Sipariş, doğrulanmış aynı e-postayla verildiyse kuruma bağlanır.
- `services.js` / `inbox.js` artık sabit demo kurum kimliği yerine oturumdaki kurumu (`window.atlasOrgId`) kullanır.
- Gerekli: `supabase/migrations/0017_self_signup.sql` uygulanmalı; Supabase Auth → URL Configuration'a panel adresi (Site URL / Redirect URLs) eklenmeli.

## Panelden iyzico ödemesi (2026-10-25)

- **Paket / Ödeme** ekranı (`#odeme`, `scripts/checkout.js`): paket seçimi + fatura bilgileri (TR'de TC Kimlik No ya da VKN + vergi dairesi zorunlu) → iyzico barındırılan ödeme sayfası.
- Ödeme ucu atlasasistan.com'da: panel `POST https://atlasasistan.com/api/atlas-checkout` çağrısını oturum jetonuyla (CORS) yapar; sunucu jetonu Supabase Auth'a sorar ve siparişi kliniğe bağlar (`api/_atlas/panel.js`). Yalnız owner/manager ödeme başlatır.
- iyzico dönüşü panelin **Kurulum** ekranına `?odeme=success|pending|failed` ile gelir. WhatsApp'a yönlendirme yok.
- atlasasistan.com/checkout artık form değil: "Kayıt Ol ve Devam Et" → panel (`?plan=…#signup`); seçilen paket kayıttan sonra ödeme ekranında seçili gelir.
- Testler: `node tools/atlas-panel-checkout-test.js`, `node tools/atlas-billing-test.js`.
