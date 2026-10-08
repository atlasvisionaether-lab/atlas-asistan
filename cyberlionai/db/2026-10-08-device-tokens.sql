-- Mobil bildirim jetonları (FCM) — WORKFLOW 4.
--
-- NEDEN YENİ BİR TABLO: depoda `public.users` diye bir tablo YOK; hesaplar
-- Supabase'in `auth.users`'ında duruyor ve ona sütun eklenmiyor. n8n'in eski
-- WORKFLOW 4'ü `public.users.fcm_token` okumaya çalışıyordu — o sütun hiç var
-- olmadı, yani akış bugüne kadar hiç bildirim gönderemezdi.
--
-- MEVCUT RLS'E DOKUNULMUYOR. Yalnızca yeni tablo ekleniyor; başka hiçbir
-- tablonun politikası, sütunu ya da kısıtı değişmiyor.
--
-- Bir kullanıcının birden çok cihazı olabilir, bu yüzden satır başına bir
-- jeton. Jeton TEKİL: aynı cihaz başka bir hesapla giriş yaparsa jeton el
-- değiştirir, iki hesaba birden bildirim gitmez.

create table if not exists public.cl_device_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null,
  platform    text not null default 'android' check (platform in ('android', 'ios', 'web')),
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Tekil indeks TAM (kısmi değil): PostgREST'in `on_conflict=token` ile
-- yaptığı upsert kısmi indeksi kullanamaz (42P10) — bkz.
-- db/2026-10-08-clscans-job-id-unique.sql, aynı ders.
create unique index if not exists cl_device_tokens_token_key
  on public.cl_device_tokens (token);

create index if not exists cl_device_tokens_user_idx
  on public.cl_device_tokens (user_id, last_seen_at desc);

alter table public.cl_device_tokens enable row level security;

-- Kullanıcı KENDİ cihazlarını görebilir ve silebilir (uygulamadaki "bu
-- cihazda bildirimleri kapat"). YAZMA yok: jetonu sunucu kaydediyor, yani
-- bir kullanıcı başka bir hesabın adına jeton ekleyemiyor.
-- `anon` rolü için HİÇBİR politika yok: yayınlanan anahtarla bu tablo
-- tarayıcıdan okunamaz.
create policy "cl_device_tokens_select_own" on public.cl_device_tokens
  for select to authenticated using (user_id = auth.uid());

create policy "cl_device_tokens_delete_own" on public.cl_device_tokens
  for delete to authenticated using (user_id = auth.uid());

-- Doğrulama:
--   select count(*) from pg_policies where tablename = 'cl_device_tokens';
--   -> 2
--   select indisunique, indpred is null as tam
--     from pg_index where indexrelid = 'cl_device_tokens_token_key'::regclass;
--   -> t | t   (tekil VE tam olmalı)
