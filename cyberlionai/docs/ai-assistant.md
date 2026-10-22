# Hibrit AI asistanı (DeepSeek + Claude Haiku yedek)

"Canlı Asistan"ın yapay zekâ katmanı. Bilgi tabanının (`/api/assistant`)
cevaplayamadığı soruları dil modeline gönderir ve yanıtı kelime kelime akıtır.

## Akış

```
tarayıcı ──POST /api/assistant──▶ bilgi tabanı (deterministik)
   │            cevap var → kanonik cevap (fiyat, plan, iade…)
   │            fallback  ↓
   ├─ rıza yoksa: rıza balonu (DeepSeek-Çin / Anthropic-ABD aktarımı)
   └─POST /api/assistant-ai──▶ redact → route → llm.streamChat ──SSE──▶ tarayıcı
                                   │         flash: deepseek-flash
                                   │         pro:   deepseek-v4-pro
                                   └─ ilk kelimeden önce hata → claude-haiku-4-5
```

Fiyat/plan gibi soruların tek doğru cevabı var ve modele bırakılmıyor;
bilgi tabanı önce soruluyor.

AI katmanı açıkken (`AI_ASSISTANT_ENABLED` + sağlayıcı anahtarı) serbest metinde
bilgi tabanı iki durumda `fallback` + `reason` döner, soru modele gider
(`api/assistant.js`, 2026-10-22): `ai_topic` — teknik tavsiye konuları
(tls, csp, hsts, xframe, cookies); `recall` — önceki konuşmaya atıf ("geçen
sefer", "önermiştin", "last time"…), net bir ürün konusuna eşleşmiyorsa.
Canlı denemede tek güçlü kelime ("sertifika") 0.70 ile eşiği geçiyor, hem
"süresi doldu" sorusu hem hafıza atfı TLS sürümü cevabını alıyordu. Geçmişle
birleştirip eşleştirme de AI açıkken yapılmaz. Düğme niyeti, ürün konuları,
acil durum ve selam değişmedi; `reason`'lı fallback Telegram'a bildirilmez.

## Dosyalar

| Dosya | Görev |
| --- | --- |
| `api/assistant-ai.js` | Uç: Origin, rıza, hız sınırı, günlük kota, SSE |
| `api/_lib/llm.js` | DeepSeek + Anthropic akışı, SSE ayrıştırıcı, yedeğe geçiş |
| `api/_lib/ai-router.js` | flash / pro kararı (kural tabanlı, deterministik) |
| `api/_lib/ai-redact.js` | E-posta, IP, anahtar, JWT, şifre, telefon maskeleme |
| `api/_lib/ai-prompt.js` | Sistem talimatı (kapsam + etik sınırlar) |
| `index.html` (asistan modülü) | Rıza balonu, akış okuyucu, güvenli çizim |
| `tools/assistant-ai-test.js` | Ağsız sınama (106 doğrulama) |

## Yönlendirme (router)

Pro: kod bloğu, yığın izi, ≥4 satır, ≥400 karakter ya da kod/düzeltme/zafiyet/
red team/inceleme kelimeleri (`DEEP_KEYWORDS`). Devam sorusu ("peki nasıl?")
önceki kullanıcı mesajı pro ise pro'da kalır. Geri kalan her şey flash.

## Yedeğe geçiş kuralı

Yalnızca kullanıcıya ilk kelime gitmeden ÖNCE: ağ hatası, HTTP hatası ya da
15 sn içinde içerik/düşünme gelmemesi. İlk kelimeden sonra kopma → yanıt
`interrupted` ile biter; ikinci model baştan yazmaz (ekranda iki yanıt
birbirine karışırdı). Geçiş ve tam düşüş Telegram'a saatte bir bildirilir.

## Kapalı devre (hepsi şart)

`AI_ASSISTANT_ENABLED=true` + en az bir anahtar + Upstash. Biri yoksa uç 503
döner, sağlayıcıya istek gitmez, arayüz eski davranışa (uzman formu) döner.

Sınırlar (IP özeti başına): dakikada 8, günde 40 mesaj; mesaj ≤ 4000 karakter,
geçmiş ≤ 8 mesaj. Hiç içerik gitmediyse günlük hak iade edilir. Kullanıcı
paneli kapatırsa sağlayıcı isteği kesilir.

## Sağlayıcıya ne gider / ne gitmez

Gider: maskelenmiş soru + son mesajlar, sabit sistem talimatı.
Gitmez: IP, oturum, hesap, e-posta (maskeli), tarama verisi, anahtar biçimli
değerler. Loga mesaj metni yazılmaz; katman, sağlayıcı, token, gerekçe yazılır.

## Yayına almadan önce (açık işler)

1. **KVKK yurt dışı aktarım.** DeepSeek (Çin) ve Anthropic (ABD) için KVKK m.9
   kapsamında aktarım dayanağı (açık rıza ve/veya standart sözleşme + Kurum'a
   bildirim) hukukçuyla netleştirilmeli. Arayüz açık rıza alıyor; dayanak bu
   olacaksa metin hukukçuya onaylatılmalı.
2. **Gizlilik politikası ve veri kataloğu.** Aşama 2'de güncellendi
   (`asistan_sorulari`, `asistan_hafizasi`, `silme_sertifikasi`; politika ve
   KVKK aydınlatma metni). Metin hukukçuya onaylatılmalı; değişirse
   `CONSENT_VERSION` yükseltilmeli.
3. **CI.** `tools/assistant-ai-test.js` ve `tools/memory-test.js`,
   `.github/workflows/tools-test.yml`'e eklenmeli.
4. **Sağlayıcı koşulları.** DeepSeek ve Anthropic'in veri saklama ve eğitimde
   kullanma koşulları kontrol edilmeli.

## Hafıza ve unutulma hakkı (Aşama 2)

| Dosya | Görev |
| --- | --- |
| `db/migrations/011_assistant_memory.sql` | `cl_user_prefs`, `cl_assistant_messages`, `cl_deletion_certificates` |
| `api/_lib/memory.js` | Tercih, mesaj yükle/ekle/buda, sil, sertifika |
| `api/user/memory.js` | `GET` durum + karşılama türü, `PUT {remember}` |
| `api/user/delete.js` | Kısmi silme: `conversations`, `scans` |
| `api/panel/account.js` | Tam silme (mevcut uç) — artık sertifika da üretiyor |
| `api/deletion-certificate.js` + `silme-sertifikasi.html` | Herkese açık kod doğrulama |
| `tools/memory-test.js` | Sahte PostgREST ile uçtan uca sınama (51 doğrulama) |

- Kalıcı hafıza **yalnızca giriş yapmış ve "Evet, hatırla" diyen** kullanıcıda.
  İçerik maskeli saklanır, kullanıcı başına en çok 1000 mesaj (Aşama 2b'de 100'den çıkarıldı); modele son mesajlar + anlamsal eşleşmeler gider.
- "Hayır, unut beni" ve hafızayı kapatmak kayıtlı konuşmaları anında siler.
- **Silenler takip edilmez.** "Sizi ilk kez görüyorum", silme gerçekten eksiksiz
  olduğu için doğal sonuçtur: hakkında kayıt olmayan kullanıcı yeni kullanıcıdan
  ayırt edilemez (`greeting: 'first_time'` + modele `MEMORY_LINE.none`).
- Sertifika tablosunda user_id / e-posta / IP **yoktur**; kod, kapsam, sayılar, tarih.
- `scan_logs` (hukuki ispat) hiçbir kapsamda silinmez, kişiye bağı kesilir.
- Hafıza modele giden veriyi değiştirdiği için `CONSENT_VERSION` → `2026-10-21.2`.

Açık: sertifikanın e-postayla gönderimi (mail sağlayıcısı yok), pgvector tabanlı
anlamsal hafıza (embedding sağlayıcısı = yeni veri işleyen, KVKK metni gerekir).

## Aşama 2b: anlamsal hafıza + e-posta sertifikası

- **Embedding:** DeepSeek'in embedding ucu yok. Varsayılan sağlayıcı Supabase Edge
  Function `supabase/functions/embed` (gte-small, 384 boyut) — metin Supabase dışına
  çıkmaz. `EMBEDDING_PROVIDER=openai` ile OpenAI uyumlu uç seçilebilir (yeni veri
  işleyen: politika ve katalog güncellenmeli).
- **Çevir ve vektörleştir (2026-10-21):** gte-small yalnızca İngilizce; canlı ölçümde
  Türkçe sorguda ilgisiz metin öne geçti (fark −0.007; İngilizcede +0.159).
  multilingual-e5-small Edge Function'da `WORKER_RESOURCE_LIMIT` ile düştü. Bu yüzden
  supabase sağlayıcısında her metin önce DeepSeek flash ile İngilizceye çevrilir
  (akışsız, sıcaklık 0, 6 sn zaman aşımı); çeviri düşerse özgün metin kullanılır.
  `EMBED_TRANSLATE=off` kapatır. openai sağlayıcısı çok dilli, çeviri yapılmaz.
- **Vektörsüz satırlar:** embed düşerse (ör. 2026-10-21'deki sır uyuşmazlığı,
  401) mesaj vektörsüz yazılır ve anlamsal aramada görünmez.
  `node tools/embed-backfill.js` sayar, `--apply` yalnızca hafızası hâlâ açık
  kullanıcıların satırlarını `embedding=is.null` koşuluyla doldurur; çeviri
  zorunlu (`requireTranslation`), çevirisiz kalıcı vektör yazılmaz. Sır
  değerleri (`EMBED_SHARED_SECRET`, `TELEGRAM_*`) okunurken kırpılır; bozuk
  Telegram belirteci `telegram skipped: bad_token_format` olarak loglanır.
- **Arama:** `db/migrations/012` — `embedding vector(384)` + `cl_match_assistant_messages`
  (yalnız servis rolü). Yaklaşık indeks yok: kullanıcı başına ≤1000 satırda tam arama.
- **Bağlam:** son 6 mesaj + son mesajlardan eski, benzerliği ≥0.3 en yakın 5 mesaj
  (`[Önceki konuşma · YYYY-MM-DD]` etiketiyle). Embedding düşerse son 12 mesaj.
- **Geriye dönük:** 012 öncesi mesajların vektörü yok; aramada görünmezler.
- **E-posta:** `api/_lib/mailer.js` (Resend REST). Kısmi silme ve hesap silme
  sertifikayı hesabın adresine yollar; yanıtta `mail: sent|unconfigured|failed`.
  Anahtar yoksa hiç istek atılmaz, sertifika ekranda kalır.

## Aşama 3: proaktif izleme + satış kapanışı

- **Yeni bulgu uyarısı:** `monitor.dailyCheck` dünkü taramada olmayan
  kritik/yüksek/orta bulguyu `new_findings` uyarısı olarak yazar (`db/migrations/013`).
  İlk taramada taban çizgisi yoktur, uyarı çıkmaz.
- **Sabah özeti:** `api/cron/morning-digest.js`, Vercel Cron `0 3 * * *`
  (06:00 İstanbul). Son 24 saatin uyarılarını kullanıcı başına tek e-postada
  toplar; günde bir (Redis kilidi). Tarama gün boyu 5 dk'lık tick ile sürer.
- **Ölçülmeyen yazılmaz:** "engellenen saldırı", "eklenti güncellemesi" gibi
  bilgiler ölçülmüyor (müşteri sunucusuna/loglarına erişim yok) ve hiçbir
  bildirimde yer almaz.
- **Satış kapanışı:** `api/_lib/offer.js`. Düzeltme niyeti + yanıt tamam +
  ücretli değil (plan okunamazsa teklif YOK) + 24 saatte bir → SSE `offer`.
  Metin plans.js'ten (₺299/ay + KDV), fiyat sayfasındaki Pro maddeleriyle aynı;
  "otomatik kapatma" / "7/24 koruma" yazılmaz. Buton: `/odeme?plan=pro`.
  `AI_SALES_MODE=off` kapatır.
- **Kod analizi:** log/kod → pro modeli (router) + talimatta sabit yapı:
  kök neden → tam düzeltilmiş blok → doğrulama adımı.

Testler: `tools/proactive-test.js` (47), `tools/memory-test.js` (52),
`tools/assistant-ai-test.js` (106).
