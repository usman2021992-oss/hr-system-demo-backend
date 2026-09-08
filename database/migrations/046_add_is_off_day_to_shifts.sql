-- Ensure environments missing the off-day column can still run affluence preview safely.
ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS is_off_day BOOLEAN NOT NULL DEFAULT false;
