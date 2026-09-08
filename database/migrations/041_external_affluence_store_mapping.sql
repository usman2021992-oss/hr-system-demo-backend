-- =============================================================================
-- Migration 041: External affluence store mapping
-- =============================================================================
-- Maps local stores to external DEPOSITI codes so INGRESSI traffic data can be
-- connected to local affluence planning.
-- =============================================================================

CREATE TABLE IF NOT EXISTS external_store_mappings (
  id                  SERIAL PRIMARY KEY,
  company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  local_store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  external_store_code VARCHAR(20) NOT NULL,
  external_store_name VARCHAR(255),
  source_table        VARCHAR(30) NOT NULL DEFAULT 'depositi',
  notes               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, local_store_id),
  UNIQUE (company_id, external_store_code)
);

CREATE INDEX IF NOT EXISTS idx_external_store_mappings_company_store
  ON external_store_mappings(company_id, local_store_id);

CREATE INDEX IF NOT EXISTS idx_external_store_mappings_company_external
  ON external_store_mappings(company_id, external_store_code);
