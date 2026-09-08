-- =============================================================================
-- Migration 011: Indexes on login_attempts for efficient cleanup queries
-- login_attempts.ip_address is the correct column name per the schema.
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at
  ON login_attempts(attempted_at);

-- Partial single-column index for per-IP lookups with NULL filtering
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_partial
  ON login_attempts(ip_address)
  WHERE ip_address IS NOT NULL;
