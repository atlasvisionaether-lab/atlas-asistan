# Supabase — Atlas Asistan

Bu klasör Atlas Asistan'ın Supabase tarafını içerir: Edge Function, migration referansları, ortam değişkenleri ve kurulum otomasyonu.

## Hızlı kurulum (tek komut — PR #47 sonrası 4 adım)

```bash
# 1) Supabase CLI login (bir kez)
supabase login

# 2) AI anahtarı (ikisinden biri)
export LOVABLE_API_KEY=...     # veya: export OPENAI_API_KEY=sk-...

# 3) Hepsini çalıştır: migration + secrets + deploy + webhook + test
bash supabase/setup-auto-reply.sh
```

Script ne yapar:
1. **0011** migration — `messages.is_from_customer`, `messages.sender_type`, `customers.last_message_at`, realtime publication
2. **Secrets** — `LOVABLE_API_KEY` (yoksa `OPENAI_API_KEY`) set eder
3. **Deploy** — `supabase functions deploy atlas-auto-reply --no-verify-jwt`
4. **Webhook** — **0012** SQL'i ile `on_message_insert` pg_net trigger'ı (Dashboard webhook'u yerine)
5. **Test** — test mesajı insert eder, 5 sn sonra son 3 mesajı sorgular

Bir adım hata verirse script durur ve neyin kaldığını söyler.

## Yapı

```
supabase/
├── config.toml                          # Edge Function ayarları (verify_jwt)
├── functions/atlas-auto-reply/index.ts  # Otomatik AI cevabı Edge Function
├── migrations/
│   ├── 0011_atlas_auto_reply_trigger.sql  # Kolonlar + realtime (ADIM 1)
│   ├── 0012_atlas_auto_reply_webhook.sql  # pg_net webhook (ADIM 4B)
│   └── 9999_test_insert.sql               # Test INSERT + doğrulama (ADIM 5)
├── setup-auto-reply.sh                 # Tüm adımları çalıştıran script
├── .env.example                        # Ortam değişkenleri şablonu
└── README.md
```

Not: Panel migrations'ı 0001–0010 için `panel/migrations/` altındadır; 0011'den itibaren `supabase/migrations/` kullanılır.

## atlas-auto-reply Edge Function

**Akış:**
1. `messages` tablosuna INSERT → Database Webhook → Edge Function
2. Koşul: `channel IN ('whatsapp','web_widget') AND is_from_customer = true`
3. Son 10 mesaj (context) + org'un aktif hizmetleri + `assistant_settings` (0009) çekilir
4. AI cevabı üretilir (Lovable AI Gateway → OpenAI fallback → fallback mesajı)
5. Cevap `messages`'a INSERT edilir: `is_from_customer = false`, `sender_type = 'ai'`, `unread = false`
6. `customers.last_message_at` güncellenir

**Sağlık/şikâyet koruması:** `risk_flag = 'yüksek'` (veya 'high') mesajlarda AI cevabı üretilmez; insan devralma notu yazılır (`HEALTHY_HANDOVER`). Projenin değişmez kuralıdır.

## Kurulum adımları

### 1) Secrets

```bash
supabase secrets set LOVABLE_API_KEY=...
# veya (fallback):
supabase secrets set OPENAI_API_KEY=...
```

Dashboard: **Project Settings > Edge Functions > Secrets**. `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` runtime'da otomatik sağlanır.

### 2) Migration

`supabase/migrations/0011_atlas_auto_reply_trigger.sql` içeriğini Supabase **SQL Editor**'de çalıştır (idempotent — tekrar çalıştırılabilir). Ekledikleri:

- `messages.is_from_customer` (boolean, default true), `messages.sender_type` (text, default 'customer'), `messages.last_message_at`
- `customers.last_message_at`
- Geri doldurma: `direction = 'out'` → `is_from_customer = false`, `sender_type = 'ai'`
- `supabase_realtime` publication'a `messages` tablosu (panel Realtime'ı için)

### 3) Edge Function deploy

```bash
supabase functions deploy atlas-auto-reply
```

`config.toml` içinde `[functions.atlas-auto-reply] verify_jwt = false` — webhook anon çağırır; yetki service_role ile DB tarafında ele alınır.

### 4) Database Webhook — iki seçenek

**4B (önerilen, SQL ile):** `supabase/migrations/0012_atlas_auto_reply_webhook.sql` — pg_net ile `on_message_insert` trigger'ı kurar. `net.http_post` ile Edge Function'ı çağırır; `is_from_customer = true` olmayan satırları (AI cevapları) döngüye sokmaz. Setup script bunu otomatik uygular.

**4A (Dashboard):** Database > Webhooks > Create a webhook

| Alan | Değer |
|---|---|
| Name | `atlas-auto-reply-webhook` |
| Table | `messages` |
| Events | **Insert** |
| Trigger type | Supabase Function |
| Function | `atlas-auto-reply` |
| Webhook payload | Default |

Koşul filtresi (`channel`, `is_from_customer`) Edge Function içinde uygulanır; function gereksiz INSERT'leri `skipped` ile reddeder.

> DİKKAT: 4A ve 4B aynı anda kurulursa her mesaj için Edge Function iki kez çağrılır. Birini seç: setup script (4B) varsayılan; Dashboard webhook'u kullandıysan 0012'yi çalıştırma.

### 5) Panel Realtime

`panel/scripts/inbox.js` `postgres_changes` INSERT aboneliği ile yeni mesaj geldiğinde listeyi yeniler. Gereksinim: 0011 migration'ındaki publication eki + authenticated oturum (RLS).

## Test (ADIM 5)

```sql
-- Supabase SQL Editor: müşteri mesajı simüle et
-- NOT: direction NOT NULL'dur (0001); mutlaka 'in' verilmelidir.
INSERT INTO public.messages (organization_id, customer_id, channel, direction, content, risk_flag, is_from_customer, sender_type, unread)
VALUES ('fff29ed3-f2e3-4837-bdfc-f4e974f366e7', '6e37b8e0-fdce-4837-ab1a-f11b7578c198', 'whatsapp', 'in', 'Selam fiyat nedir?', 'normal', true, 'customer', true);
```

3–5 saniye sonra doğrulama (`supabase/migrations/9999_test_insert.sql` ile aynı):

```sql
select sender_type, is_from_customer, content, created_at
from public.messages
where customer_id = '6e37b8e0-fdce-4837-ab1a-f11b7578c198'
order by created_at desc limit 3;
```

2–3 saniye içinde:
- `messages` tablosunda `sender_type = 'ai'`, `is_from_customer = false` yeni satır
- Panelde Gelen Kutusu (açıksa Realtime ile anında) hem müşteri hem AI cevabını gösterir

## Gizlilik ve güvenlik notları

- Gerçek anahtarlar repoya yazılmaz; yalnızca `supabase secrets`.
- Webhook payload'ı tüm satırı içerir; Edge Function yalnızca gerekli alanları işler.
- `verify_jwt = false` gereklidir (webhook anon çağırır); DB erişimi service_role ile RLS bypass'ı üzerinden tek noktada tutulur.
- Sağlık/şikâyet içeriklerinde otomatik tıbbi yanıt üretilmez; insan devralma akışı korunur.

## Auto-reply nasıl çalışır (akış)

```
müşteri mesajı (messages INSERT, is_from_customer=true)
  └─ trigger on_message_insert (0012, pg_net)
       └─ net.http_post → https://lfltontezrfcmjntsgix.supabase.co/functions/v1/atlas-auto-reply
            └─ Edge Function (verify_jwt=false, service_role)
                 ├─ koşul: channel ∈ {whatsapp, web_widget}, is_from_customer=true
                 ├─ yüksek risk (risk_flag='yüksek') → insan devralma notu, AI üretimi yok
                 ├─ son 10 mesaj (context) + org services + assistant_settings
                 ├─ Lovable AI Gateway → OpenAI → fallback sırasıyla cevap üretir
                 └─ cevap INSERT (sender_type='ai', is_from_customer=false, unread=false)
                      └─ customers.last_message_at güncellenir
                           └─ panel Realtime (postgres_changes INSERT) anında gösterir
```

Fiyat bilgisi hardcode değildir: Edge Function her çağrıda `services` tablosundan
org'un `is_active=true` satırlarını okur ve system prompt'a service listesi olarak ekler.
Fiyat değişirse tabloyu güncellemek yeterlidir; Edge Function yeniden deploy edilmez.

## Troubleshooting

| Belirti | Neden | Çözüm |
|---|---|---|
| Insert sonrası AI cevabı gelmiyor | Trigger yok / düştü | `select tgname from pg_trigger where tgrelid='public.messages'::regclass;` → `on_message_insert` yoksa 0012'yi tekrar çalıştır (idempotent) |
| `function net.http_post(...) does not exist` — SQLSTATE 42883 | `body` parametresi `::text` cast edilmiş veya imza uyuşmuyor | `net.http_post(url text, body jsonb, headers jsonb)` — body'yi **jsonb** ver (`::text` cast YOK). Repo'daki 0012'nin güncel halini kullan |
| Edge Function 401 döner | JWT kısıtı kapalı değil | `supabase functions deploy atlas-auto-reply --no-verify-jwt` VEYA `supabase/config.toml` içinde `[functions.atlas-auto-reply] verify_jwt = false` |
| Cevap hep fallback mesajı | AI anahtarı yok/geçersiz | `supabase secrets list` → `LOVABLE_API_KEY` veya `OPENAI_API_KEY` olmalı; `supabase secrets set OPENAI_API_KEY=...` sonrası yeni çağrıda okunur (deploy gerekmez) |
| Aynı mesaja iki AI cevabı | 4A (Dashboard webhook) + 4B (0012 trigger) birlikte kurulu | İkisinden birini kaldır: Dashboard > Webhooks'tan sil VEYA `drop trigger on_message_insert on public.messages;` |
| Panelde cevap görünmüyor | Realtime publication'da `messages` yok | 0011'in publication bloğunu uygula; tarayıcı console'unda realtime hatası var mı bak |
| `services` fiyatları güncel değil | Edge Function her çağrıda tabloyu okur; cache yok | Sadece tabloyu güncelle. Hâlâ eskiyse cevabın `created_at`'ine bak — eski bir cevap olabilir |
| Webhook çağrıldı ama cevap üretilmedi | Koşullar tutmadı → `skipped` | Kayıtta `channel` ('whatsapp'/'web_widget') ve `is_from_customer=true` olmalı; Edge Function logları: `supabase functions logs atlas-auto-reply` |

### JWT OFF uyarısı

`atlas-auto-reply` `verify_jwt = false` ile çalışır — anon çağrılabilir. Bu bilerek
böyledir (Database Webhook JWT göndermez). Sınırlar:

- Function yalnızca geçerli bir `messages` satır kaydı işler; koşullar tutmazsa `skipped` döner.
- DB erişimi function içindeki service_role ile; dışarıya anahtar sızmaz.
- URL biliniyorsa sahte record ile cevap üretimi denenebilir. Üretimde ek koruma
  istenirse: 0012 trigger'ında özel bir `params`/header doğrulaması ekleyip function'da
  kontrol et, veya Dashboard webhook (supabase_functions, imzalı) kullan.

### Test verisi temizliği

`supabase/cleanup-test-messages.sql` — `6e37b8e0-…` müşterisinin test mesajlarını ve
AI cevaplarını siler: önce önizleme, sonra DELETE'ler, sonunda count doğrulaması.
SQL Editor'de çalıştır; DELETE kalıcıdır.

## Otomasyonlar ekranı (FAZ 4)

`panel/scripts/automations.js` — `assistant_settings` tablosundan canlı okur/yazar:

- **AI otomatik cevabı** (`auto_reply_enabled`): AÇIK/KAPALI toggle. Kapatılınca
  Edge Function cevap üretmez (kontrol için Edge Function'da bayrak okunmalıdır;
  0013 kolonu mevcut, davranış bağlama sonraki adımdır).
- **Çalışma saatleri** (`working_hours` jsonb, `{start,end}`): 09:00–18:00 varsayılan.
- **Fallback mesajı** (`fallback_message`): AI yanıt veremediğinde kullanılır.
- **AI modeli** (`model`): small/medium.

Kaydet → `supabase .update` (satır yoksa insert). 0013 migration'ı
(`supabase/migrations/0013_handover_and_automation_settings.sql`) önce
uygulanmalı: `auto_reply_enabled`, `working_hours` kolonları.
