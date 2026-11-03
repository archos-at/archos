-- Reverse 0196. ORDER: roll the frontend back first; the newer build writes
-- `reader_fault_at` and the `sender_unchecked` flag.
--
-- Refused while a mail carries `sender_unchecked`: the older CHECK does not
-- know the flag, and 0194's verdict guard freezes a held mail's flags, so it
-- cannot be taken off. Wait until no such mail is held (they settle within
-- their 30 days and are deleted 30 days later), or delete those rows first.
--
-- Lossy: a text waiting for its re-read stays unreadable; its `.eml` can
-- still be downloaded.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inbound_mails" WHERE 'sender_unchecked' = ANY ("sender_flags")) THEN
    RAISE EXCEPTION 'reverse 0196 refused: a mail carries the sender_unchecked flag; wait for it to settle or delete it first';
  END IF;
END
$$;
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_sender_unchecked_full_window";
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_sender_unchecked_not_direct";
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_sender_flags_known";
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_sender_flags_known"
  CHECK ("sender_flags" <@ ARRAY['not_addressed_to_project', 'bcc_own', 'stale_date',
                                 'date_out_of_range', 'message_id_reused', 'already_filed',
                                 'claims_member_name']::text[]);
DROP INDEX IF EXISTS "inbound_mails_reader_fault_idx";
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_reader_fault_held";
ALTER TABLE "inbound_mails" DROP COLUMN IF EXISTS "reader_fault_at";
