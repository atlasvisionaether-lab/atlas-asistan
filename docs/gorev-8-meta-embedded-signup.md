# Görev 8 — Meta Tech Provider + WhatsApp "tek tıkla bağla" (2026-10-26)

## Kararlar
- Başvuru **şahıs işletmesi** (Ali Kotan) adına; şirketleşince Meta İşletme bilgileri güncellenir.
- **Doğrudan Tech Provider** (BSP yok). Mesaj ücretlerini Meta doğrudan klinikten alır (klinik WABA'sına kart ekler).
- Embedded Signup **v4** (v2/v3 15 Ekim 2026'da kalktı). Coexistence (WhatsApp Business uygulaması + Cloud API aynı numara) varsayılan önerilen seçenek.
- Eski "kendi Meta uygulamanla bağla" (manual, 0020) panelde "Gelişmiş" altında kalır.

## Faz 0 — Meta tarafı (kullanıcı)
1. Meta İşletme portföyü + işletme doğrulaması (vergi levhası; unvan/adres/telefon sitedekiyle aynı).
2. atlasasistan.com alan adı doğrulaması (Cloudflare TXT).
3. **Business** tipinde uygulama; WhatsApp kullanım senaryosu.
4. Uygulama ayarları → Temel: Gizlilik `https://atlasasistan.com/pages/gizlilik-politikasi.html`,
   Koşullar `https://atlasasistan.com/pages/kullanim-sartlari.html`,
   Veri silme talimatı `https://atlasasistan.com/pages/veri-silme.html`, kategori, simge.

## Faz 1 — Kod (bu PR) ve bir kerelik ayarlar
### Meta uygulamasında
- **Facebook Login for Business → Yapılandırmalar → Oluştur**: "WhatsApp Embedded Signup" şablonu;
  izinler `whatsapp_business_management`, `whatsapp_business_messaging`. Çıkan **Configuration ID** → `META_ES_CONFIG_ID`.
- **Facebook Login for Business → Ayarlar**: "JavaScript SDK ile oturum aç" AÇIK; izinli alan adları:
  `https://atlas-asistan-panel-preview.vercel.app` (panel başka adrese taşınırsa o da).
- **WhatsApp → Yapılandırma → Webhook**: Callback URL `https://atlasasistan.com/api/atlas-channel-webhook?app=meta`,
  Verify token = `META_WEBHOOK_VERIFY_TOKEN`; alanlar: `messages`, `smb_message_echoes`, `account_update`
  (coexistence geçmişi için ileride `history`, `smb_app_state_sync`).

### Vercel (atlasasistan-static) ortam değişkenleri — değerleri kullanıcı girer
| Ad | Ne |
|---|---|
| `META_APP_ID` | Uygulama kimliği (herkese açık) |
| `META_APP_SECRET` | Uygulama gizli anahtarı — yalnız sunucu; imza + kod değişimi |
| `META_ES_CONFIG_ID` | Facebook Login for Business yapılandırma kimliği |
| `META_WEBHOOK_VERIFY_TOKEN` | En az 16 karakterlik rastgele değer (webhook doğrulaması) |

Dördü tanımlı değilse panel tek tık düğmesini göstermez; eski yöntem çalışmaya devam eder.

### Akış
1. Panel → Kanallar → WhatsApp → "Mevcut WhatsApp Business numaramı bağla" (coexistence) ya da "Yeni bir numara bağla".
2. Facebook SDK düğmeye basılınca yüklenir; pencere WABA + numara kimliğini `postMessage`, 30 sn ömürlü kodu `FB.login` cevabıyla verir.
3. Sunucu (`/api/atlas-channels` `embeddedSignup`): kod → işletme jetonu; numaranın o WABA'da olduğu **jetonla** doğrulanır
   (tarayıcının bildirdiğine güvenilmez) → `subscribed_apps` → (coexistence değilse) `register` + rastgele 6 haneli PIN → bağlantı `connected`, `mode='embedded'`.
4. Webhook (`?app=meta`): imza `META_APP_SECRET`; `metadata.phone_number_id` → kliniğin bağlantısı.
   - `messages` → gelen mesaj (asistan yanıtlar).
   - `smb_message_echoes` → klinik telefondan yazdı: konuşmaya `human` olarak eklenir, **müşteri insana devredilir** (asistan susar; Gelen Kutusu'ndan geri alınır). 0024 tetikleyicisi bu mesajı yeniden göndermez.
   - `account_update` / `PARTNER_REMOVED` → bağlantı kesilir, jeton silinir.
5. "Bağlantıyı kes" → Atlas'ın WABA aboneliği kaldırılır, jeton silinir.

### Bilinen sınırlar (sonraki adımlar)
- Coexistence geçmiş/rehber senkronu (`smb_app_data`) yapılmıyor: yalnız bağlantıdan sonraki mesajlar.
- Instagram tek tık (Instagram Login) Faz 4.
- App Review videoları bu akıştan çekilir (Faz 2): biri mesaj gönderimi, biri şablon oluşturma.

### Testler
`node tools/atlas-embedded-signup-test.js`, `bash tools/atlas-embedded-sql-test.sh`.
