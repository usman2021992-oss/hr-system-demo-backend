-- Migration 025: Unique Device Token
-- Ensures that a device token is only assigned to one user at a time.
-- Postgres UNIQUE allows multiple NULLs, so unregistered users won't conflict.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_registered_device_token'
  ) THEN
    -- Data cleanup: Before applying the unique constraint, we must ensure
    -- no duplicate device tokens exist. Since the system was previously
    -- permissive, multiple employees might have registered the same device.
    -- We keep only the oldest registration (smallest ID) and clear the others.
    UPDATE users
    SET registered_device_token = NULL
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY registered_device_token ORDER BY id ASC) as rn
        FROM users
        WHERE registered_device_token IS NOT NULL
      ) t
      WHERE rn > 1
    );

    ALTER TABLE users
      ADD CONSTRAINT uq_users_registered_device_token UNIQUE (registered_device_token);
  END IF;
END $$;
