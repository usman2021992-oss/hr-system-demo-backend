-- Fix Italian province codes in job_postings job_state column
UPDATE job_postings
SET job_state = 'MI'
WHERE job_state = '25' OR LOWER(job_state) = 'milano' OR LOWER(job_state) = 'milan';

UPDATE job_postings
SET job_state = 'NA'
WHERE job_state = '63' OR LOWER(job_state) = 'napoli' OR LOWER(job_state) = 'naples';

UPDATE job_postings
SET job_state = 'SA'
WHERE job_state = '72' OR LOWER(job_state) = 'salerno';
