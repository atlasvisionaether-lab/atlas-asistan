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
