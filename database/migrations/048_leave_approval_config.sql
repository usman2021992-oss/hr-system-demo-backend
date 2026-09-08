-- =============================================================================
-- Migration 048: Configurable Leave Approval Levels
-- Allows admin to enable/disable each approval step per company.
-- =============================================================================

CREATE TABLE IF NOT EXISTS leave_approval_config (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  role        VARCHAR(30) NOT NULL CHECK (role IN ('store_manager', 'area_manager', 'hr', 'admin')),
  enabled     BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, role)
);

-- Seed default config for all existing companies (all 4 levels enabled)
INSERT INTO leave_approval_config (company_id, role, enabled, sort_order)
SELECT c.id, r.role, true, r.sort_order
FROM companies c
CROSS JOIN (VALUES
  ('store_manager', 1),
  ('area_manager',  2),
  ('hr',            3),
  ('admin',         4)
) AS r(role, sort_order)
ON CONFLICT (company_id, role) DO NOTHING;
