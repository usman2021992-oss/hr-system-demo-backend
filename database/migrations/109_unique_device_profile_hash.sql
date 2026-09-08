-- Migration 109: Unique active device profile hash
-- Prevents the same device profile from being linked to multiple active users,
-- even if the browser-stored fingerprint token changes.

DO $$
BEGIN
  UPDATE users
  SET registered_device_token = NULL,
      registered_device_metadata = NULL,
      registered_device_registered_at = NULL
  WHERE id IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY registered_device_metadata->'deviceProfile'->>'hash'
          ORDER BY registered_device_registered_at ASC NULLS LAST, id ASC
        ) AS rn
      FROM users
      WHERE device_reset_pending = false
        AND registered_device_metadata->'deviceProfile'->>'hash' IS NOT NULL
    ) dedup
    WHERE rn > 1
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'uq_users_registered_device_profile_hash_active'
  ) THEN
    CREATE UNIQUE INDEX uq_users_registered_device_profile_hash_active
      ON users ((registered_device_metadata->'deviceProfile'->>'hash'))
      WHERE device_reset_pending = false
        AND registered_device_metadata->'deviceProfile'->>'hash' IS NOT NULL;
  END IF;
END $$;
