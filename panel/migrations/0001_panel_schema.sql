-- ============================================================
-- Atlas Asistan Panel �?eması — MİMARİ TASLAK
-- DİKKAT: BU DOSYA ASLA ÇALI�?TIRILMAZ.
-- Hiçbir migration veya veritabanı işlemi bu prototipte yapılmaz.
-- ============================================================

-- CREATE TABLE tenants (
--   id TEXT PRIMARY KEY,
--   name TEXT NOT NULL,
--   plan TEXT NOT NULL DEFAULT ''trial'',
--   created_at TEXT NOT NULL
-- );

-- CREATE TABLE customers (
--   id TEXT PRIMARY KEY,
--   tenant_id TEXT NOT NULL REFERENCES tenants(id),
--   full_name TEXT NOT NULL,
--   phone_masked TEXT,
--   consent_at TEXT,
--   created_at TEXT NOT NULL
-- );

-- CREATE TABLE appointments (
--   id TEXT PRIMARY KEY,
--   tenant_id TEXT NOT NULL REFERENCES tenants(id),
--   customer_id TEXT NOT NULL REFERENCES customers(id),
--   service_id TEXT NOT NULL,
--   starts_at TEXT NOT NULL,
--   status TEXT NOT NULL DEFAULT ''pending''
-- );

-- CREATE TABLE campaigns (
--   id TEXT PRIMARY KEY,
--   tenant_id TEXT NOT NULL REFERENCES tenants(id),
--   name TEXT NOT NULL,
--   audience_rule TEXT NOT NULL,
--   state TEXT NOT NULL DEFAULT ''draft''
-- );

-- Notlar:
-- 1. Tenant izolasyonu tüm sorgularda server tarafında zorunlu olmalıdır.
-- 2. Kişisel veri yalnızca gerekli kapsamda ve yetkili erişimle işlenmelidir.
-- 3. Sağlık/şikâyet işaretli mesajlar otomatik yanıta kapalı olmalıdır.
