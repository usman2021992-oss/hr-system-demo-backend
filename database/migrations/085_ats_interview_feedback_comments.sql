-- =============================================================================
-- 085: ATS Interview Feedback Comments
-- Adds multi-comment feedback for interviews with user attribution.
-- =============================================================================

CREATE TABLE IF NOT EXISTS interview_feedback_comments (
  id            SERIAL PRIMARY KEY,
  interview_id  INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_feedback_comments_interview
  ON interview_feedback_comments (interview_id, created_at DESC);
