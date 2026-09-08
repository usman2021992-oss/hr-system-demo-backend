-- Store canonical UTC timestamps for shift windows while keeping legacy local date/time fields.
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64),
  ADD COLUMN IF NOT EXISTS start_at_utc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_at_utc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS break_start_at_utc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS break_end_at_utc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS split_start2_at_utc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS split_end2_at_utc TIMESTAMPTZ;

UPDATE shifts
SET timezone = 'Europe/Rome'
WHERE timezone IS NULL OR BTRIM(timezone) = '';

UPDATE shifts
SET
  start_at_utc = COALESCE(
    start_at_utc,
    ((date::timestamp + start_time) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
  ),
  end_at_utc = COALESCE(
    end_at_utc,
    ((date::timestamp + end_time) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
  ),
  break_start_at_utc = CASE
    WHEN break_start IS NULL THEN NULL
    ELSE COALESCE(
      break_start_at_utc,
      ((date::timestamp + break_start) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
    )
  END,
  break_end_at_utc = CASE
    WHEN break_end IS NULL THEN NULL
    ELSE COALESCE(
      break_end_at_utc,
      ((date::timestamp + break_end) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
    )
  END,
  split_start2_at_utc = CASE
    WHEN split_start2 IS NULL THEN NULL
    ELSE COALESCE(
      split_start2_at_utc,
      ((date::timestamp + split_start2) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
    )
  END,
  split_end2_at_utc = CASE
    WHEN split_end2 IS NULL THEN NULL
    ELSE COALESCE(
      split_end2_at_utc,
      ((date::timestamp + split_end2) AT TIME ZONE COALESCE(NULLIF(BTRIM(timezone), ''), 'Europe/Rome'))
    )
  END
WHERE
  start_at_utc IS NULL
  OR end_at_utc IS NULL
  OR (break_start IS NOT NULL AND break_start_at_utc IS NULL)
  OR (break_end IS NOT NULL AND break_end_at_utc IS NULL)
  OR (split_start2 IS NOT NULL AND split_start2_at_utc IS NULL)
  OR (split_end2 IS NOT NULL AND split_end2_at_utc IS NULL);

CREATE INDEX IF NOT EXISTS idx_shifts_company_start_utc ON shifts(company_id, start_at_utc);
CREATE INDEX IF NOT EXISTS idx_shifts_user_start_utc ON shifts(user_id, start_at_utc);
CREATE INDEX IF NOT EXISTS idx_shifts_store_start_utc ON shifts(store_id, start_at_utc);
CREATE INDEX IF NOT EXISTS idx_shifts_attendance_window
  ON shifts(company_id, user_id, store_id, start_at_utc, end_at_utc)
  WHERE status != 'cancelled';
