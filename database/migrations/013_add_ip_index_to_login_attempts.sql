-- Migration 010: Add index on login_attempts.ip_address
-- Required for efficient IP-based rate limiting (H5 fix).
-- The ip_address column already exists in the table; this only adds the index.

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, attempted_at DESC);
