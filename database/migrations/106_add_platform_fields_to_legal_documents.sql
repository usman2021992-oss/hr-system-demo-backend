-- Migration: Add platform_company_name and platform_company_email to legal_documents
ALTER TABLE legal_documents 
ADD COLUMN IF NOT EXISTS platform_company_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS platform_company_email VARCHAR(255);
