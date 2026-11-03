-- 0196: a dependency that does not answer leaves no frozen guess on a held
-- mail (ADR-0137; B3 of the 2026-11 ship review).
--
-- ## What went wrong
--
-- The receive job held a mail on its last of three attempts, 90 seconds in,
-- with whatever an outage made of it, and 0194 freezes the verdict. A WorkOS
-- blip labelled a member's mail a stranger's (`external`, discarded after 14
-- days, no restore) or a writer's mail read-only; a rolling deploy of the
-- Python reader left a text unreadable for good.
--
-- Now a dependency fault spends no attempt: the job waits it out for about
-- six hours (`lib/inbound-mail/receive-faults.ts`). Past that it holds the
-- mail with what it could not learn, and these columns say so.
--
-- ## `sender_unchecked`
--
-- A sender flag: the directory or the write check did not answer for the
-- whole budget, or the sender was never judged at all (a mail held unreadable
-- before the verifier ran). Such a mail may be a member's, so:
--
--   - it is never a verified writer's (`inbound_mails_sender_unchecked_not_direct`):
--     no direct filing on a question nobody answered;
--   - it waits the full 30 days, never an outsider's 14
--     (`inbound_mails_sender_unchecked_full_window`), whatever its class: a
--     mail tied to no member must still be `external` (0194's
--     `inbound_mails_sender_class_member`), and this is what keeps that label
--     from shortening its life.
--
-- The E-Mail-Eingang says it could not be checked (`waitReason`
-- `sender_unchecked`), not that its sender is outside the office.
--
-- ## `reader_fault_at`
--
-- The reader did not answer for the whole budget: the text waits unreadable,
-- and sweep 15 reads it again from this time on while the mail waits
-- (`lib/inbound-mail/receive-reread.ts`), each failure moving it on. NULL
-- once read, and for every text the reader did read (a refusal or a parser
-- timeout is its answer, not a fault). Only a held mail carries it.
--
-- Additive and idempotent.

ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "reader_fault_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_reader_fault_held";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_reader_fault_held"
  CHECK ("reader_fault_at" IS NULL OR "status" IN ('waiting', 'settled'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_mails_reader_fault_idx"
  ON "inbound_mails" ("reader_fault_at") WHERE "reader_fault_at" IS NOT NULL AND "status" = 'waiting';
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_sender_flags_known";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_sender_flags_known"
  CHECK ("sender_flags" <@ ARRAY['not_addressed_to_project', 'bcc_own', 'stale_date',
                                 'date_out_of_range', 'message_id_reused', 'already_filed',
                                 'claims_member_name', 'sender_unchecked']::text[]);
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_sender_unchecked_not_direct";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_sender_unchecked_not_direct"
  CHECK (NOT ('sender_unchecked' = ANY ("sender_flags")) OR "sender_class" IS DISTINCT FROM 'verified_writer');
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_sender_unchecked_full_window";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_sender_unchecked_full_window"
  CHECK (NOT ('sender_unchecked' = ANY ("sender_flags")) OR "expires_at" >= "received_at" + interval '30 days');
--> statement-breakpoint
COMMENT ON COLUMN "inbound_mails"."reader_fault_at" IS
  'The Python reader did not answer while the receive job held the mail: its text waits unreadable and sweep 15 reads it again from this time on while the mail waits. NULL once read (migration 0196).';
