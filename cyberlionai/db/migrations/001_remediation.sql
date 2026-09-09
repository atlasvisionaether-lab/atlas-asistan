-- =============================================================================
-- Cyber Lion AI — 001: Üç modlu düzeltme (remediation) şeması
-- PostgreSQL 14+
--
-- Uygulama:  psql "$DATABASE_URL" -f db/migrations/001_remediation.sql
-- Geri alma: db/migrations/001_remediation_down.sql
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- büyük/küçük harf duyarsız e-posta

-- --- Ortak enum'lar ---------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE remediation_mode AS ENUM ('autonomous', 'semi_autonomous', 'managed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_decision AS ENUM ('approve_selected', 'auto_apply_all', 'reject_all');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE severity_level AS ENUM ('critical', 'high', 'medium', 'low', 'info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- Temel tablolar ---------------------------------------------------------
-- Not: users ve scans tabloları henüz yoksa burada oluşturulur; varsa
-- yalnızca eksik sütunlar eklenir (aşağıdaki ALTER blokları).

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT UNIQUE,
  password_hash  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  target_url  TEXT NOT NULL,
  score       SMALLINT CHECK (score BETWEEN 0 AND 100),
  status      TEXT NOT NULL DEFAULT 'queued',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vulnerabilities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id     UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  severity    severity_level NOT NULL,
  passed      BOOLEAN NOT NULL DEFAULT FALSE,
  evidence    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Mevcut tablolara mod alanları -----------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS
  preferred_remediation_mode remediation_mode NOT NULL DEFAULT 'semi_autonomous';

ALTER TABLE scans ADD COLUMN IF NOT EXISTS remediation_mode remediation_mode;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS integration JSONB;

-- --- Onay süreçleri (yarı otomatik mod) -------------------------------------
CREATE TABLE IF NOT EXISTS approvals (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id                   UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id                   UUID REFERENCES users(id) ON DELETE SET NULL,
  mode                      remediation_mode NOT NULL DEFAULT 'semi_autonomous',
  status                    approval_status NOT NULL DEFAULT 'pending',
  decision                  approval_decision,
  selected_vulnerabilities  UUID[] NOT NULL DEFAULT '{}',
  proposals                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at              TIMESTAMPTZ,
  expires_at                TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',

  -- Karar verilmişse yanıt zamanı ve karar birlikte dolu olmalı
  CONSTRAINT approvals_decision_consistency CHECK (
    (status = 'pending'  AND decision IS NULL     AND responded_at IS NULL) OR
    (status = 'expired'  AND decision IS NULL) OR
    (status IN ('approved', 'rejected') AND decision IS NOT NULL AND responded_at IS NOT NULL)
  )
);

-- Bir tarama için aynı anda yalnızca bir bekleyen onay bulunabilir
CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_per_scan
  ON approvals (scan_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS approvals_user_status_idx ON approvals (user_id, status);
CREATE INDEX IF NOT EXISTS approvals_expiry_idx ON approvals (expires_at) WHERE status = 'pending';

ALTER TABLE scans ADD COLUMN IF NOT EXISTS approval_id UUID REFERENCES approvals(id) ON DELETE SET NULL;

-- --- Yönetilen hizmet ticket'ları -------------------------------------------
CREATE SEQUENCE IF NOT EXISTS managed_ticket_seq START 1000;

CREATE TABLE IF NOT EXISTS managed_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id         UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  ticket_number   TEXT UNIQUE NOT NULL DEFAULT 'CLA-' || nextval('managed_ticket_seq'),
  status          ticket_status NOT NULL DEFAULT 'open',
  assigned_team   TEXT NOT NULL DEFAULT 'security_experts',
  priority        severity_level NOT NULL DEFAULT 'high',
  notes           TEXT,
  expert_comments TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,

  CONSTRAINT managed_tickets_resolution CHECK (
    (status IN ('resolved', 'closed') AND resolved_at IS NOT NULL) OR
    (status IN ('open', 'in_progress') AND resolved_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS managed_tickets_status_idx ON managed_tickets (status, priority);
CREATE INDEX IF NOT EXISTS managed_tickets_scan_idx ON managed_tickets (scan_id);

-- --- Uygulanan düzeltmeler ve denetim izi -----------------------------------
CREATE TABLE IF NOT EXISTS remediation_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id          UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  mode             remediation_mode NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running',
  integration_type TEXT,
  fixes_applied    INTEGER NOT NULL DEFAULT 0,
  fixes_failed     INTEGER NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS remediation_runs_scan_idx ON remediation_runs (scan_id, started_at DESC);

-- Her düzeltme adımı kalıcı olarak kaydedilir: kim, ne zaman, neyi değiştirdi,
-- geri alındı mı. Otonom modda bu iz zorunludur.
CREATE TABLE IF NOT EXISTS remediation_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  run_id           UUID NOT NULL REFERENCES remediation_runs(id) ON DELETE CASCADE,
  vulnerability_id UUID REFERENCES vulnerabilities(id) ON DELETE SET NULL,
  action           TEXT NOT NULL,          -- generate_fix, apply, verify, rollback, escalate
  actor            TEXT NOT NULL,          -- ai, expert, system, user:<uuid>
  result           TEXT,                   -- success, failed, rolled_back, human_intervention
  detail           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS remediation_audit_run_idx ON remediation_audit_log (run_id, created_at);

COMMIT;
