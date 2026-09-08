-- 034_employee_off_days.sql
-- Persist per-employee off days (Mon=0 ... Sun=6)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS off_days SMALLINT[] NOT NULL DEFAULT ARRAY[5,6]::SMALLINT[];

UPDATE users
SET off_days = ARRAY[5,6]::SMALLINT[]
WHERE off_days IS NULL OR cardinality(off_days) = 0;

-- Sanitize existing values and keep them sorted/distinct.
UPDATE users
SET off_days = (
  SELECT COALESCE(array_agg(DISTINCT d ORDER BY d), ARRAY[5,6]::SMALLINT[])
  FROM unnest(off_days) AS d
  WHERE d BETWEEN 0 AND 6
)
WHERE off_days IS NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_off_days_valid_chk;

ALTER TABLE users
  ADD CONSTRAINT users_off_days_valid_chk
  CHECK (off_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_off_days_not_empty_chk;

ALTER TABLE users
  ADD CONSTRAINT users_off_days_not_empty_chk
  CHECK (cardinality(off_days) >= 1);
