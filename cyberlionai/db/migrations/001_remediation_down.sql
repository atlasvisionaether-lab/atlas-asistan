-- Cyber Lion AI — 001 geri alma
BEGIN;

DROP TABLE IF EXISTS remediation_audit_log;
DROP TABLE IF EXISTS remediation_runs;
DROP TABLE IF EXISTS managed_tickets;
DROP SEQUENCE IF EXISTS managed_ticket_seq;

ALTER TABLE scans DROP COLUMN IF EXISTS approval_id;
DROP TABLE IF EXISTS approvals;

ALTER TABLE scans DROP COLUMN IF EXISTS integration;
ALTER TABLE scans DROP COLUMN IF EXISTS remediation_mode;
ALTER TABLE users DROP COLUMN IF EXISTS preferred_remediation_mode;

DROP TYPE IF EXISTS ticket_status;
DROP TYPE IF EXISTS approval_decision;
DROP TYPE IF EXISTS approval_status;
DROP TYPE IF EXISTS remediation_mode;

COMMIT;
