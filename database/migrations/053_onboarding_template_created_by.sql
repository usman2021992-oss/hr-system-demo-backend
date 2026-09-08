-- =============================================================================
-- Migration 053: Track onboarding template creator
-- =============================================================================

ALTER TABLE onboarding_templates
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;

UPDATE onboarding_templates
SET created_by_user_id = NULL
WHERE created_by_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = onboarding_templates.created_by_user_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'onboarding_templates'
      AND constraint_name = 'onboarding_templates_created_by_user_id_fkey'
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE onboarding_templates
      ADD CONSTRAINT onboarding_templates_created_by_user_id_fkey
      FOREIGN KEY (created_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_onboarding_templates_created_by_user_id
  ON onboarding_templates(created_by_user_id);
