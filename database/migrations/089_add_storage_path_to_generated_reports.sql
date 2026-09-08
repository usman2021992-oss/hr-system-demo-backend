ALTER TABLE generated_reports
ADD COLUMN IF NOT EXISTS storage_path TEXT;
