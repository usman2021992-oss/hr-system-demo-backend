ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS target_role TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'job_postings_target_role_chk'
      AND t.relname = 'job_postings'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_target_role_chk
      CHECK (
        target_role IS NULL
        OR target_role IN ('hr', 'area_manager', 'store_manager', 'employee')
      );
  END IF;
END $$;

ALTER TABLE job_postings
  DROP CONSTRAINT IF EXISTS job_postings_salary_period_chk;

ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_salary_period_chk
  CHECK (
    salary_period IS NULL
    OR salary_period IN (
      'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'annually',
      'all''ora', 'a settimana', 'al mese', 'per anno'
    )
  );
