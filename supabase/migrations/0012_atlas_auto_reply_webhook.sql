-- ============================================================
-- 0012: atlas-auto-reply webhook'unu SQL ile kur (pg_net).
-- ADIM 4B: Dashboard yerine tamamen SQL ile webhook tetikleyicisi.
-- Repo kopyası referans amaçlıdır; Supabase SQL editöründe uygulanır.
-- İdempotenttir (DROP TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION).
--
-- Önkoşullar:
--   * 0011 uygulanmış olmalı (is_from_customer, sender_type kolonları).
--   * Edge Function deploy edilmiş olmalı:
--       supabase functions deploy atlas-auto-reply --no-verify-jwt
--   * pg_net uzantısı etkin (Supabase projelerinde varsayılan).
-- ============================================================

create extension if not exists pg_net;

-- Webhook gövdesi Edge Function'ın beklediği Database Webhooks formatındadır:
-- { "type": "INSERT", "table": "messages", "record": <yeni satır> }
create or replace function public.atlas_auto_reply_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := 'https://lfltontezrfcmjntsgix.supabase.co/functions/v1/atlas-auto-reply';
begin
  -- Yalnızca müşteri mesajları tetikler; AI cevapları (is_from_customer=false)
  -- döngüye girmez. Edge Function'da channel filtresi de tekrar uygulanır.
  if new.is_from_customer is distinct from true then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'record', to_jsonb(new)
    )::text,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return new;
end;
$$;

drop trigger if exists on_message_insert on public.messages;

create trigger on_message_insert
  after insert on public.messages
  for each row
  execute function public.atlas_auto_reply_webhook();
