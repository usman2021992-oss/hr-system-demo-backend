-- =============================================================================
-- Migration 052: Onboarding task type explicit phase
-- =============================================================================
-- Adds task_type so onboarding phase is independent from sort_order.

ALTER TABLE onboarding_templates
  ADD COLUMN IF NOT EXISTS task_type VARCHAR(20);

UPDATE onboarding_templates
SET task_type = CASE
  WHEN sort_order <= 3 THEN 'day1'
  WHEN sort_order <= 7 THEN 'week1'
  WHEN sort_order <= 14 THEN 'month1'
  ELSE 'ongoing'
END
WHERE task_type IS NULL
   OR task_type NOT IN ('day1', 'week1', 'month1', 'ongoing');

ALTER TABLE onboarding_templates
  ALTER COLUMN task_type SET DEFAULT 'day1';

ALTER TABLE onboarding_templates
  ALTER COLUMN task_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'onboarding_templates'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'onboarding_templates_task_type_chk'
  ) THEN
    ALTER TABLE onboarding_templates
      ADD CONSTRAINT onboarding_templates_task_type_chk
      CHECK (task_type IN ('day1', 'week1', 'month1', 'ongoing'));
  END IF;
END $$;
