-- =============================================================================
-- 084: ATS Phone Interview & Enhanced Features
-- Adds phone_interview status, candidate comments, interview enhancements,
-- rejection reasons, and notification tracking.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Update candidates status constraint to include 'phone_interview'
-- ---------------------------------------------------------------------------
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_status_check;

-- Re-check: the original CHECK may have been inline on CREATE TABLE
DO $$
BEGIN
  -- Drop any unnamed check constraint on status column
  EXECUTE (
    SELECT string_agg('ALTER TABLE candidates DROP CONSTRAINT ' || quote_ident(conname), '; ')
    FROM pg_constraint
    WHERE conrelid = 'candidates'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  );
EXCEPTION WHEN others THEN
  NULL;
END $$;

ALTER TABLE candidates ADD CONSTRAINT candidates_status_check
  CHECK (status IN ('received','review','phone_interview','interview','hired','rejected'));

-- ---------------------------------------------------------------------------
-- 2. Add rejection_reason column to candidates
-- ---------------------------------------------------------------------------
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ---------------------------------------------------------------------------
-- 3. Enhance interviews table with type, description, duration
-- ---------------------------------------------------------------------------
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interview_type TEXT NOT NULL DEFAULT 'in_person';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'interviews'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'interviews_interview_type_check'
  ) THEN
    ALTER TABLE interviews
      ADD CONSTRAINT interviews_interview_type_check
      CHECK (interview_type IN ('phone','in_person'));
  END IF;
END $$;

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- ---------------------------------------------------------------------------
-- 4. Candidate comments table (multi-comment support)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidate_comments (
  id              SERIAL PRIMARY KEY,
  candidate_id    INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidate_comments_candidate
  ON candidate_comments (candidate_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Interview notification logs table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_notification_logs (
  id              SERIAL PRIMARY KEY,
  interview_id    INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('email','push','in_app')),
  recipient_type  TEXT NOT NULL CHECK (recipient_type IN ('candidate','interviewer')),
  recipient_email TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sending','done','error')),
  error_message   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_notif_logs_interview
  ON interview_notification_logs (interview_id);

CREATE INDEX IF NOT EXISTS idx_interview_notif_logs_status
  ON interview_notification_logs (status)
  WHERE status IN ('pending','error');
