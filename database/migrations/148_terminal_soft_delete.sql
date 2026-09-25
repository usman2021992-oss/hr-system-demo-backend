-- ---------------------------------------------------------------------------
-- 148. Deleting a terminal stops destroying it.
--
--      Until now DELETE /api/terminals/:id removed the user row and, with it,
--      every audit_logs row that named the terminal — including its logins. Four
--      terminals disappeared from a production company and nothing recorded it.
--
--      Two changes:
--
--      1. users.deleted_at / deleted_by. An admin's "delete" now archives the
--         terminal: it stops working, stops being billable, leaves the lists,
--         and waits in the Super Admin's deleted view, where it can be restored
--         or removed for good.
--
--      2. audit_logs.user_id becomes ON DELETE SET NULL. The column is already
--         nullable and deleteStorePermanent already nulls it by hand; with the
--         constraint doing it, a permanent deletion keeps the trail instead of
--         erasing it, and the DELETE FROM audit_logs in deleteTerminal can go.
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Archived rows are the exception, so the index only carries them.
CREATE INDEX IF NOT EXISTS idx_users_deleted
  ON users (company_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- Repoint the audit_logs foreign key, whatever it happens to be called.
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT con.conname INTO fk_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
   WHERE rel.relname = 'audit_logs'
     AND con.contype = 'f'
     AND att.attname = 'user_id'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
END $$;
