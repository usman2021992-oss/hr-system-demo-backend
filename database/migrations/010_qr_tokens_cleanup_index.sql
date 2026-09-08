-- =============================================================================
-- Migration 010: Index on qr_tokens(issued_at) for efficient TTL cleanup
-- The checkin handler runs a best-effort DELETE WHERE issued_at < NOW() - 5min
-- after each successful scan. This index makes that DELETE fast at scale.
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_qr_tokens_issued_at ON qr_tokens(issued_at);
