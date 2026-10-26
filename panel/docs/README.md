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

## Rehber — klinik sahibine ELI10 kurulum rehberi (2026-10-26)

- **Rehber** ekranı (`#rehber`, `scripts/guide.js`): 5 konu (ilk kurulum, WhatsApp bağlantısı, hizmet/fiyat, ilk test mesajı, randevu takvimi); her adımda "Anladım, sonraki adım", adımla ilgili soru kutusu ve "Şimdi aç" bağlantısı. Kurulum ekranındaki her adımda "Nasıl yapılır? Rehbere sor".
- Sunucu: `api/atlas-guide.js` (DeepSeek, `cyberlionai/api/_lib/llm.js`; yedek Claude Haiku yalnız `ANTHROPIC_API_KEY` varsa). Oturum zorunlu, CORS panel origin'i.
- **Doğruluk:** model yalnızca adımın `facts` listesini anlatır (`api/_atlas/guide-content.js`); ürün değişince önce orası güncellenir. Model cevap veremezse panel aynı bilgileri düz liste gösterir.
- **Maliyet:** kullanıcı başına 24 saatte `GUIDE_DAILY_LIMIT` (varsayılan 60) istek; sayaç `supabase/migrations/0018_guide_usage.sql`.
- Gerekli env (atlasasistan-static): `DEEPSEEK_API_KEY`. Test: `node tools/atlas-guide-test.js`.

## Uzay teması — 3B yıldız haritası ve cam arayüz (2026-10-26)

- **Tek kaynak `space/`** (kök) → `panel/space/` birebir kopya (panel ayrı Vercel projesi). Değiştirince kopyala; `node tools/space-sync-test.js` ayrışmayı yakalar.
- `space.js`: Three.js 0.160.0 (importmap, jsDelivr; derleme yok). 50.000 yıldız (mobil 10.000), twinkle, galaksi bandı, iki katmanlı fbm nebula, kayan yıldızlar, fare paralaksı, Bloom + renk sapması + vinyet + film greni. Uyarlanır kalite: `#space3d[data-quality]` (0 = tam). `prefers-reduced-motion`: tek sabit kare.
- `space-ui.js`: yıldız imleç (yalnız fare), düğmelerde parçacık patlaması, ekran geçişi (View Transitions; yalnız `.sx-page`).
- `space.css`: jetonlar (Fraunces + Manrope, altın/cyan), `.sx-glass` cam + altın/gümüş kenar parlaması.
- WebGL/CDN yoksa: sitede eski 2B yıldızlar, panelde CSS nebula degradesi kalır.

## Kanallar — Telegram, WhatsApp Cloud API, Instagram (2026-10-26)

- **Kanallar** ekranı (`#kanallar`, `scripts/channels.js`): klinik kanalı kendi bağlar; her kart adım adım "nereden alırım" anlatımı, bağlama formu, Meta için webhook adresi + doğrulama jetonu (kopyala), iki adımlı kesme.
- Sunucu: `api/atlas-channels.js` (panel), `api/atlas-channel-webhook.js` (gelen; Telegram `secret_token`, Meta `X-Hub-Signature-256` ham gövdeyle), `api/atlas-channel-send.js` (giden; tetikleyiciden, her mesaj en fazla bir kez). Adaptörler: `api/_atlas/channels/`.
- Kurum izolasyonu: kliniğe özel webhook adresi (`?c=<bağlantı>`), kurum bağlantı satırından; Meta'da numara/hesap kimliği ayrıca karşılaştırılır; bir bot/numara/hesap tek kuruma bağlanır.
- Gerekli: `supabase/migrations/0020_channels.sql`, Vercel env `CHANNEL_ENC_KEY` (64 hex), `atlas-auto-reply` yeniden deploy.
- Testler: `node tools/atlas-channels-test.js`, `bash tools/atlas-channels-sql-test.sh`.

## Performans notu — 3B harita (2026-10-26)

- Paralaks kare hızından bağımsız (üstel yumuşatma, `PARALLAX_RESPONSE`): hedefin %90'ı ~0,27 sn. Eski kare başı 0,04 ile 7 FPS'te 7,8 sn sürüyordu.
- Nebula ekranın 1/3 çözünürlüğünde ayrı hedefe çizilir, kayan yıldızlar tam çözünürlükte; uyarlanır kalite süreye göre karar verir (0,8 sn ısınma + 1 sn pencereler).
- Ölçüm: `NODE_PATH=$(npm root -g) node tools/space-perf-test.js` (`?sxdebug` kancası; `&sxfull` tam kalite).

## Web Sitem — klinik web sitesi (Görev 7, 2026-10-26)

- **Web Sitem** (`#site`, `scripts/site.js`): bilgiler + şablon (Nebula/Aurora/Eclipse/Rose) + vurgu rengi → logo/fotoğraf (tarayıcıda küçültülür) → yapay zekâ metni (düzenlenebilir) → önizle → **onay kutusu** ile yayınla.
- Sunucu: `api/atlas-site.js` (panel), `api/atlas-site-render.js` (herkese açık; `/s/<alt-alan>`), `api/_atlas/site/` (render, content, compliance, slug, store).
- Kurallar: fiyat/adres/telefon veritabanından, yapay zekâ yalnız metin; sağlık iddiası denetimi (`compliance.js`) bulgu varken yayın yok; onaylanan HTML anlık görüntü olarak saklanır ve birebir sunulur; sıkı CSP.
- Alt alan adı: Cloudflare Worker (`tools/cloudflare/README.md`). Gerekli: `0022_clinic_sites.sql`.
- Testler: `node tools/atlas-site-test.js`, `bash tools/atlas-site-sql-test.sh`.
