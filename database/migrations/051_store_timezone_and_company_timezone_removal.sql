-- Move timezone ownership from company to stores and enrich stores profile fields.
BEGIN;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(255),
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'companies'
      AND column_name = 'timezones'
  ) THEN
    UPDATE stores s
    SET timezone = COALESCE(
      NULLIF(BTRIM(s.timezone), ''),
      NULLIF(BTRIM(SPLIT_PART(c.timezones, ',', 1)), ''),
      'Europe/Rome'
    )
    FROM companies c
    WHERE c.id = s.company_id
      AND (s.timezone IS NULL OR BTRIM(s.timezone) = '');

    ALTER TABLE companies DROP COLUMN IF EXISTS timezones;
  END IF;
END $$;

UPDATE stores
SET timezone = 'Europe/Rome'
WHERE timezone IS NULL OR BTRIM(timezone) = '';

CREATE INDEX IF NOT EXISTS idx_stores_company_timezone ON stores(company_id, timezone);

COMMIT;
