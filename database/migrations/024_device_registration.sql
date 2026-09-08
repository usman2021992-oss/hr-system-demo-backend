-- Device Binding / Trusted Device Registration
-- Adds columns to tie an employee account to a single registered device token.

-- HR can toggle device reset; when ON we clear the stored device token and the
-- employee must re-register on the next login.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS device_reset_pending BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registered_device_token VARCHAR(128),
  ADD COLUMN IF NOT EXISTS registered_device_metadata JSONB,
  ADD COLUMN IF NOT EXISTS registered_device_registered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_registered_device_token
  ON users(registered_device_token);

