ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_ip VARCHAR(45);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS device_events (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, -- 'registered' | 'mismatch_blocked' | 'admin_bypass' | 'reset' | 'suspicious_ip'
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_events_user_time ON device_events(user_id, created_at DESC);
