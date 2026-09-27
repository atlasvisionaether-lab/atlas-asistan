# Supabase — Atlas Asistan

Bu klasör Atlas Asistan'ın Supabase tarafını içerir: Edge Function, migration referansları ve ortam değişkenleri.

## Yapı

```
supabase/
├── config.toml                          # Edge Function ayarları (verify_jwt)
├── functions/atlas-auto-reply/index.ts  # Otomatik AI cevabı Edge Function
├── migrations/                          # SQL migration referansları
│   └── 0011_atlas_auto_reply_trigger.sql
├── .env.example                          # Ortam değişkenleri şablonu
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

### 4) Database Webhook

Dashboard: **Database > Webhooks > Create a webhook**

| Alan | Değer |
|---|---|
| Name | `atlas-auto-reply-webhook` |
| Table | `messages` |
| Events | **Insert** |
| Trigger type | Supabase Function |
| Function | `atlas-auto-reply` |
| Webhook payload | Default |

Koşul filtresi (`channel`, `is_from_customer`) Edge Function içinde uygulanır; webhook tüm INSERT'leri gönderir, function gereksiz olanları `skipped` ile reddeder.

### 5) Panel Realtime

`panel/scripts/inbox.js` `postgres_changes` INSERT aboneliği ile yeni mesaj geldiğinde listeyi yeniler. Gereksinim: 0011 migration'ındaki publication eki + authenticated oturum (RLS).

## Test

```sql
-- Supabase SQL Editor: müşteri mesajı simüle et
INSERT INTO public.messages (organization_id, customer_id, channel, direction, content, risk_flag, is_from_customer, sender_type, unread)
VALUES ('fff29ed3-f2e3-4837-bdfc-f4e974f366e7', '<customer-uuid>', 'whatsapp', 'in', 'Merhaba, lazer epilasyon fiyatı nedir?', 'normal', true, 'customer', true);
```

2–3 saniye içinde:
- `messages` tablosunda `sender_type = 'ai'`, `is_from_customer = false` yeni satır
- Panelde Gelen Kutusu (açıksa Realtime ile anında) hem müşteri hem AI cevabını gösterir

## Gizlilik ve güvenlik notları

- Gerçek anahtarlar repoya yazılmaz; yalnızca `supabase secrets`.
- Webhook payload'ı tüm satırı içerir; Edge Function yalnızca gerekli alanları işler.
- `verify_jwt = false` gereklidir (webhook anon çağırır); DB erişimi service_role ile RLS bypass'ı üzerinden tek noktada tutulur.
- Sağlık/şikâyet içeriklerinde otomatik tıbbi yanıt üretilmez; insan devralma akışı korunur.
