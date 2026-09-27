-- 0007: Gelen Kutusu için messages.unread kolonu ve sorgu index'i.
-- Repo kopyası referans amaçlıdır; Supabase SQL editöründe tek kez uygulanır.
-- (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS ile idempotent.)
--
-- RLS gereksinimi zaten 0002'deki messages_select politikasıyla karşılanır:
-- authenticated kullanıcılar yalnızca kendi organization_id'lerine ait satırları okur.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS unread BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS messages_inbox_idx
  ON public.messages (organization_id, unread DESC, created_at DESC);
