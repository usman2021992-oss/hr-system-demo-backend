-- ---------------------------------------------------------------------------
-- 147. A store gets a banner, like a company already has.
--
--      The store page shows the same hero header as the company page, and until
--      now it had nothing to put in it. Nullable and empty by default: every
--      existing store keeps the plain header it has today until someone uploads
--      one.
-- ---------------------------------------------------------------------------

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS banner_filename VARCHAR(255);
