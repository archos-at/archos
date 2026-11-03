-- Reverse 0195. ORDER: roll the frontend back first; the newer build writes
-- and reads these columns.
--
-- Refused while a mail was dropped as `duplicate_original`: the older CHECK
-- does not know the reason, and rewriting it would claim a drop the receive
-- job never made. Delete those rows (they hold ids and counts only) first.
--
-- Lossy: who wrote a forwarded mail is forgotten. A filed entry's heading
-- keeps the words it was stored with, but the older renderer recomputes the
-- heading from the sender and refuses a forwarded entry's section
-- (`heading_mismatch`) until the Verlauf is rendered without it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inbound_mails" WHERE "dropped_reason" = 'duplicate_original') THEN
    RAISE EXCEPTION 'reverse 0195 refused: a mail was dropped as duplicate_original; delete those rows first';
  END IF;
END
$$;
DROP INDEX IF EXISTS "mail_thread_entries_author_message_id_idx";
ALTER TABLE "mail_thread_entries" DROP CONSTRAINT IF EXISTS "mail_thread_entries_author_named";
ALTER TABLE "mail_thread_entries" DROP CONSTRAINT IF EXISTS "mail_thread_entries_author_lengths";
ALTER TABLE "mail_thread_entries" DROP COLUMN IF EXISTS "author_message_id";
ALTER TABLE "mail_thread_entries" DROP COLUMN IF EXISTS "author_sent_at";
ALTER TABLE "mail_thread_entries" DROP COLUMN IF EXISTS "author_name";
ALTER TABLE "mail_thread_entries" DROP COLUMN IF EXISTS "author_address";
DROP INDEX IF EXISTS "uniq_inbound_mails_open_original";
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_dropped_reason_known";
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_dropped_reason_known"
  CHECK ("dropped_reason" IS NULL OR "dropped_reason" IN ('auto_reply', 'delivery_report', 'self_loop'));
DROP TRIGGER IF EXISTS "inbound_mails_scrub_original" ON "inbound_mails";
DROP FUNCTION IF EXISTS inbound_mails_scrub_original();
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_scrubbed";
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_lengths";
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_message_id_attached";
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_with_source";
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_source_known";
ALTER TABLE "inbound_mails" DROP COLUMN IF EXISTS "original_source";
ALTER TABLE "inbound_mails" DROP COLUMN IF EXISTS "original_message_id";
ALTER TABLE "inbound_mails" DROP COLUMN IF EXISTS "original_subject";
ALTER TABLE "inbound_mails" DROP COLUMN IF EXISTS "original_sent_at";
ALTER TABLE "inbound_mails" DROP COLUMN IF EXISTS "original_author_name";
ALTER TABLE "inbound_mails" DROP COLUMN IF EXISTS "original_author_address";
