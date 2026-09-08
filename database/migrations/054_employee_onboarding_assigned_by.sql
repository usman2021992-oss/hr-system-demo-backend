-- Track who assigned each onboarding task instance (separate from template creator).

ALTER TABLE employee_onboarding_tasks
  ADD COLUMN IF NOT EXISTS assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employee_onboarding_assigned_by
  ON employee_onboarding_tasks (assigned_by_user_id);

-- Backfill: use employee's supervisor when present (historical best-effort).
UPDATE employee_onboarding_tasks t
SET assigned_by_user_id = u.supervisor_id
FROM users u
WHERE t.employee_id = u.id
  AND u.supervisor_id IS NOT NULL
  AND t.assigned_by_user_id IS NULL;
