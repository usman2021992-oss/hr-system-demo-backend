-- =============================================================================
-- Company Groups (Phase 1 extension)
-- - Adds business groups to enable group-scoped access.
-- - Adds per-group role visibility for cross-company access of HR/Area Manager.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. company_groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_groups (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. companies.group_id (nullable => standalone/isolated)
-- ---------------------------------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES company_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_companies_group_id ON companies(group_id);

-- ---------------------------------------------------------------------------
-- 3. group_role_visibility (controls cross-company access within a group)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_role_visibility (
  group_id          INTEGER NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
  role              user_role NOT NULL,
  can_cross_company BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        INTEGER REFERENCES users(id),
  UNIQUE (group_id, role),
  CHECK (role IN ('hr', 'area_manager'))
);

CREATE INDEX IF NOT EXISTS idx_group_role_visibility_group_role ON group_role_visibility(group_id, role);

