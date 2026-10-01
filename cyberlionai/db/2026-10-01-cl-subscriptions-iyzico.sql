-- CyberLion AI — cl_subscriptions tablosuna iyzico referans sütunları.
--
-- NEDEN: ödeme sağlayıcısı Stripe Payment Link'ten iyzico Subscription v2'ye
-- geçti (Stripe TR şahıs şirketinde canlıya açılmıyor). iyzico tarafındaki
-- müşteri, ürün ve abonelik kayıtlarının referans kodları bizim tarafta
-- tutulmak zorunda: webhook bize abonelik referansıyla geliyor ve hangi
-- kullanıcının satırı olduğunu ancak bu eşleme söylüyor.
--
-- Yeniden çalıştırmak güvenlidir (IF NOT EXISTS).
--
-- RLS DEĞİŞMİYOR: okuma yalnızca kendi satırı (cl_subscriptions_select_own),
-- yazma yalnızca servis rolü. Webhook servis rolüyle yazıyor; anon ya da
-- authenticated INSERT/UPDATE policy'si YOK — olsaydı bir kullanıcı kendini
-- Enterprise ilan edebilirdi.

alter table public.cl_subscriptions
  add column if not exists iyzico_customer_ref     text,
  add column if not exists iyzico_subscription_ref text,
  add column if not exists iyzico_product_ref      text,
  add column if not exists iyzico_plan_ref         text,
  -- Sandbox ile canlı aboneliği karıştırmamak için: sandbox'ta açılmış bir
  -- satır canlıda abonelik sayılmamalı.
  add column if not exists iyzico_env              text,
  add column if not exists status                  text;

alter table public.cl_subscriptions
  add constraint cl_subscriptions_iyzico_env_chk
  check (iyzico_env is null or iyzico_env in ('sandbox', 'production'))
  not valid;

-- Abonelik referansı iyzico tarafında tekil; webhook aynı referansla birden
-- çok kez gelebiliyor (yeniden deneme) ve upsert'in dayanacağı bir anahtar
-- gerekiyor. Kısmi tekil indeks: referansı olmayan (elle açılmış) satırlar
-- kısıtın dışında kalıyor.
create unique index if not exists cl_subscriptions_iyzico_subscription_ref_key
  on public.cl_subscriptions (iyzico_subscription_ref)
  where iyzico_subscription_ref is not null;

create index if not exists cl_subscriptions_iyzico_customer_ref_idx
  on public.cl_subscriptions (iyzico_customer_ref)
  where iyzico_customer_ref is not null;

-- Alan adı artık ZORUNLU DEĞİL.
--
-- NEDEN: ödeme ile "hangi alan adı haftalık taranacak" seçimi aynı an değil.
-- Müşteri abone olurken henüz alan adı seçmemiş olabiliyor; satırı uydurma
-- bir alan adıyla açmak, haftalık taramanın yanlış hedefi taraması demekti.
-- `enterpriseScanTargets` zaten biçim denetimi yapıyor ve alan adı boş olan
-- satırı hedef saymıyor.
alter table public.cl_subscriptions alter column domain drop not null;
