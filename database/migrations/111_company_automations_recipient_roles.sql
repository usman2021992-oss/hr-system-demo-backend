ALTER TABLE company_automations
  ADD COLUMN IF NOT EXISTS recipient_roles TEXT[];
