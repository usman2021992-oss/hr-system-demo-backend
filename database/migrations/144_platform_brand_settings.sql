-- ---------------------------------------------------------------------------
-- 144. Who the billing emails say they are from.
--
--      The platform sends three kinds of mail to its customers - a renewal
--      reminder, a failed-payment warning, and the test that rehearses it -
--      and until now each was a hand-built block of HTML with the brand name
--      spelled inline. That meant three places to change a logo, and three
--      chances for them to disagree.
--
--      These four settings feed one shared template. They live beside the
--      platform SMTP credentials because they answer the same question - what
--      the customer sees in their inbox - and because they have to be editable
--      without a redeploy: the supplier's legal details are the sort of thing
--      that arrives by email on a Friday afternoon.
-- ---------------------------------------------------------------------------

ALTER TABLE platform_smtp_config
  -- Shown in the header beside the logo, and used in subjects and signatures.
  -- Text as well as image, so it survives a client that blocks images.
  ADD COLUMN IF NOT EXISTS brand_name       TEXT NOT NULL DEFAULT 'Veylo HR',
  -- An absolute https URL. Empty renders the name alone rather than a broken
  -- image, which is the better failure for an email nobody can re-send.
  ADD COLUMN IF NOT EXISTS logo_url         TEXT NOT NULL DEFAULT '',
  -- The legal footer: who is actually issuing the invoice.
  ADD COLUMN IF NOT EXISTS supplier_name    TEXT NOT NULL DEFAULT '',
  -- Address, VAT number, contact details. Free text, rendered line by line and
  -- escaped - it is typed by a person, not authored as markup.
  ADD COLUMN IF NOT EXISTS supplier_details TEXT NOT NULL DEFAULT '';
