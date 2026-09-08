-- =============================================================================
-- Migration 002: Phase 1 Schema
-- HR System Tech Demo
-- =============================================================================
-- Run AFTER schema.sql (001 baseline).
-- NOTE: ALTER TYPE ... ADD VALUE IF NOT EXISTS cannot run inside a transaction
-- in older PostgreSQL versions, so these statements appear before BEGIN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend user_role enum (outside transaction for compatibility)
-- ---------------------------------------------------------------------------
-- If user_role does not yet exist as an enum, create it first via a DO block.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'admin',
      'manager',
      'employee',
      'hr',
      'area_manager',
      'store_manager',
      'store_terminal'
    );
  END IF;
END;
$$;

-- NOTE: ALTER TYPE ADD VALUE cannot be run inside a transaction in PostgreSQL.
-- These statements run outside BEGIN/COMMIT intentionally.
-- IMPORTANT: PostgreSQL does not support ALTER TYPE DROP VALUE.
-- Once these enum values are added they cannot be removed without
-- dropping and recreating the type. Ensure this migration is intentional.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'area_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'store_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'store_terminal';

-- =============================================================================
BEGIN;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Migrate users.role from VARCHAR+CHECK to the enum type (if not already enum)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  col_type TEXT;
  constraint_name TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'role';

  IF col_type = 'character varying' THEN
    -- Drop the old CHECK constraint (name may vary)
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%role%';
    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE users DROP CONSTRAINT IF EXISTS %I', constraint_name);
    END IF;

    -- Rename 'manager' -> 'store_manager' before casting
    UPDATE users SET role = 'store_manager' WHERE role = 'manager';

    -- Cast column to enum
    ALTER TABLE users
      ALTER COLUMN role TYPE user_role USING role::user_role;
  END IF;
END;
$$;

-- Data migration: rename any remaining 'manager' roles to 'store_manager'
UPDATE users SET role = 'store_manager' WHERE role::text = 'manager';

-- ---------------------------------------------------------------------------
-- 2. Create stores table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(50) NOT NULL,
  address    TEXT,
  cap        VARCHAR(10),
  max_staff  INTEGER DEFAULT 0,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_stores_company ON stores(company_id);

-- ---------------------------------------------------------------------------
-- 3. Add new columns to users table
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id          INTEGER REFERENCES stores(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS supervisor_id     INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS surname           VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS unique_id         VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS department        VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date         DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS termination_date  DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_end_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS working_type      VARCHAR(20)
  CHECK (working_type IN ('full_time', 'part_time'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_hours      NUMERIC(4,1);
ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_email    VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth     DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nationality       VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender            VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS iban              VARCHAR(34);
ALTER TABLE users ADD COLUMN IF NOT EXISTS address           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cap               VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_aid_flag    BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marital_status    VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status            VARCHAR(20) DEFAULT 'active'
  CHECK (status IN ('active', 'inactive'));

CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id);
CREATE INDEX IF NOT EXISTS idx_users_supervisor_id ON users(supervisor_id);

-- WARNING: This splits 'name' on the FIRST space only.
-- Names with more than 2 tokens (e.g. "Maria Grazia Russo") will have tokens 3+ discarded.
-- Verify no such rows exist before running on production data:
DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM users WHERE array_length(string_to_array(trim(name), ' '), 1) > 2 AND surname IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Found % user(s) with more than 2 name tokens. Review manually before proceeding.', v_count;
  END IF;
END $$;
-- Data migration: split name into name + surname
UPDATE users
SET
  surname = split_part(name, ' ', 2),
  name    = split_part(name, ' ', 1)
WHERE surname IS NULL
  AND name LIKE '% %';

-- Unique constraint on (company_id, unique_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_unique_id_company' AND table_name = 'users'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_unique_id_company UNIQUE (company_id, unique_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Create role_module_permissions table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_module_permissions (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  role        user_role NOT NULL,
  module_name VARCHAR(100) NOT NULL,
  is_enabled  BOOLEAN DEFAULT true,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, role, module_name)
);

-- ---------------------------------------------------------------------------
-- 5. Create audit_logs table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  user_id     INTEGER REFERENCES users(id),
  action      VARCHAR(50) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id   BIGINT,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity  ON audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 6. Create login_attempts table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(255) NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address   VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, attempted_at DESC);

-- =============================================================================
COMMIT;
-- =============================================================================
