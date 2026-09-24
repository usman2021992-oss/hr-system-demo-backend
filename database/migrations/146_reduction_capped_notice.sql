-- ---------------------------------------------------------------------------
-- 146. Remembers that a scheduled licence reduction could not be applied.
--
--      A reduction is checked against usage when the admin asks for it, but
--      usage moves before it lands: deactivate 3 people, ask to go 10 -> 7,
--      hire 3 again, and applying 7 would leave 10 active people on 7 licences.
--      The reduction is therefore capped at the live count and kept pending, so
--      it applies by itself once the counts come down.
--
--      The customer is told, and so is the operator — they are still paying for
--      more than they asked to. This column stops that warning repeating on
--      every renewal check: it is stamped when the notice goes out and cleared
--      as soon as the reduction is either fully applied or withdrawn.
-- ---------------------------------------------------------------------------

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS reduction_capped_notified_at TIMESTAMPTZ;
