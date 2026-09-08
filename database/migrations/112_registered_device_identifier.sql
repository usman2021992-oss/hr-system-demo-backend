-- Migration 112: Canonical active device identifier
-- Stores one stable device identity per active registration and enforces that a
-- physical/profile-matched device can belong to only one account at a time.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registered_device_identifier VARCHAR(160);

UPDATE users
SET registered_device_identifier = CASE
  WHEN registered_device_metadata->'stableDevice'->>'hash' IS NOT NULL
    THEN 'profile:' || (registered_device_metadata->'stableDevice'->>'hash')
  WHEN registered_device_metadata->'deviceProfile'->>'hash' IS NOT NULL
    THEN 'profile:' || (registered_device_metadata->'deviceProfile'->>'hash')
  WHEN registered_device_token IS NOT NULL
    THEN 'fingerprint:' || registered_device_token
  ELSE NULL
END
WHERE registered_device_identifier IS NULL
  AND device_reset_pending = false;

UPDATE users
SET registered_device_token = NULL,
    registered_device_identifier = NULL,
    registered_device_metadata = NULL,
    registered_device_registered_at = NULL
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY registered_device_identifier
        ORDER BY registered_device_registered_at ASC NULLS LAST, id ASC
      ) AS rn
    FROM users
    WHERE device_reset_pending = false
      AND registered_device_identifier IS NOT NULL
  ) dedup
  WHERE rn > 1
);

CREATE INDEX IF NOT EXISTS idx_users_registered_device_identifier
  ON users(registered_device_identifier);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_registered_device_identifier_active
  ON users(registered_device_identifier)
  WHERE device_reset_pending = false
    AND registered_device_identifier IS NOT NULL;
