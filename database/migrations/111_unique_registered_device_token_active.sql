-- Migration 111: Unique active registered device token
-- Prevents the same physical/browser-bound device token from being linked to
-- multiple active users at the same time.

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
          PARTITION BY registered_device_token
          ORDER BY registered_device_registered_at ASC NULLS LAST, id ASC
        ) AS rn
      FROM users
      WHERE device_reset_pending = false
        AND registered_device_token IS NOT NULL
    ) dedup
    WHERE rn > 1
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'uq_users_registered_device_token_active'
  ) THEN
    CREATE UNIQUE INDEX uq_users_registered_device_token_active
      ON users (registered_device_token)
      WHERE device_reset_pending = false
        AND registered_device_token IS NOT NULL;
  END IF;
END $$;
