-- =============================================================================
-- Cyber Lion AI — 002: Canlı destek asistanı
-- PostgreSQL 14+   (001_remediation.sql sonrası uygulanır)
-- =============================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE support_layer AS ENUM ('local', 'server', 'human');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_role AS ENUM ('user', 'assistant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bir sohbet oturumu. Kullanıcı giriş yapmamış olabilir; o zaman user_id boştur.
CREATE TABLE IF NOT EXISTS support_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key    TEXT NOT NULL,                 -- tarayıcı tarafında üretilen oturum anahtarı
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  locale        TEXT NOT NULL DEFAULT 'tr',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_key)
);

CREATE INDEX IF NOT EXISTS support_sessions_user_idx ON support_sessions (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id              BIGSERIAL PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES support_sessions(id) ON DELETE CASCADE,
  role            message_role NOT NULL,
  body            TEXT NOT NULL,
  matched_topic   TEXT,                        -- bilgi tabanı konusu (ör. 'csp')
  layer           support_layer,               -- yanıtı hangi kademe üretti
  urgency         SMALLINT CHECK (urgency BETWEEN 0 AND 10),
  response_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Yalnızca asistan mesajlarında kademe ve süre bulunur
  CONSTRAINT support_messages_layer_role CHECK (
    (role = 'assistant') OR (layer IS NULL AND response_ms IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS support_messages_session_idx ON support_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS support_messages_topic_idx ON support_messages (matched_topic)
  WHERE matched_topic IS NOT NULL;

-- Yanıtsız kalan veya aciliyet eşiğini aşan sorular uzman ekibe düşer.
CREATE TABLE IF NOT EXISTS support_escalations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES support_sessions(id) ON DELETE CASCADE,
  message_id    BIGINT REFERENCES support_messages(id) ON DELETE SET NULL,
  ticket_id     UUID REFERENCES managed_tickets(id) ON DELETE SET NULL,
  urgency       SMALLINT NOT NULL CHECK (urgency BETWEEN 0 AND 10),
  reason        TEXT NOT NULL,                 -- 'no_match' | 'urgent' | 'user_request'
  notified_at   TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_escalations_open_idx
  ON support_escalations (urgency DESC, created_at) WHERE resolved_at IS NULL;

-- Bilgi tabanının sunucu tarafı kopyası. Ön yüz kendi kopyasını gömülü taşır;
-- bu tablo, yanıtları dağıtım yapmadan güncellemek ve hangi konunun ne sıklıkta
-- sorulduğunu ölçmek için kullanılır.
CREATE TABLE IF NOT EXISTS support_kb_entries (
  topic       TEXT PRIMARY KEY,
  locale      TEXT NOT NULL DEFAULT 'tr',
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  code_sample TEXT,
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  hit_count   INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
