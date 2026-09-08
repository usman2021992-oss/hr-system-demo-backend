-- =============================================================================
-- Migration 004: Phase 2 Attendance & QR Terminal
-- =============================================================================
BEGIN;

-- QR token nonce table (replay prevention — one-time use per token)
CREATE TABLE IF NOT EXISTS qr_tokens (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  store_id    INTEGER NOT NULL REFERENCES stores(id),
  nonce       VARCHAR(64) NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at     TIMESTAMPTZ,
  CONSTRAINT qr_nonce_unique UNIQUE (nonce)
);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_company_store ON qr_tokens(company_id, store_id);

-- attendance_events replaces the legacy attendance table
CREATE TABLE IF NOT EXISTS attendance_events (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  store_id      INTEGER NOT NULL REFERENCES stores(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  event_type    VARCHAR(20) NOT NULL
                CHECK (event_type IN ('checkin','checkout','break_start','break_end')),
  event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        VARCHAR(20) NOT NULL DEFAULT 'qr'
                CHECK (source IN ('qr','manual','sync')),
  qr_token_id   INTEGER REFERENCES qr_tokens(id),
  shift_id      INTEGER REFERENCES shifts(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attendance_events_company ON attendance_events(company_id, event_time);
CREATE INDEX IF NOT EXISTS idx_attendance_events_user    ON attendance_events(user_id, event_time);

COMMIT;
