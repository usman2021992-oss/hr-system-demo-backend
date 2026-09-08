-- 017_messages.sql
CREATE TABLE IF NOT EXISTS messages (
  id            SERIAL PRIMARY KEY,
  company_id    INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sender_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject       VARCHAR(255) NOT NULL,
  body          TEXT NOT NULL,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_company   ON messages(company_id, created_at DESC);
