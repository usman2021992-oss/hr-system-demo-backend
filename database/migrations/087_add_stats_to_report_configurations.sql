-- Migration to add run_count and last_generated statistics to report_configurations
ALTER TABLE report_configurations 
ADD COLUMN IF NOT EXISTS run_count INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_generated TIMESTAMP WITH TIME ZONE;
