-- 0197: a dependency that does not answer leaves no frozen guess on a held
-- mail (ADR-0137; B3 of the 2026-11 ship review).
--
-- ## What went wrong
--
-- The receive job held a mail on its last of three attempts, 90 seconds in,
-- with whatever an outage made of it, and 0195 freezes the verdict. A WorkOS
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
--     mail tied to no member must still be `external` (0195's
--     `inbound_mails_sender_class_member`), and this is what keeps that label
--     from shortening its life;
--   - its expiry is not final: 0195's decision guard
--     (`inbound_mail_decisions_external_expiry_final`) lets its expired part be
--     restored, as a member's is, for the seven days the sweep keeps it.
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
-- ## `receive_progress`
--
-- What a receive run learned before a fault gave its claim back, for the next
-- run of the same mail (`lib/inbound-mail/receive-progress.ts`; R10 of the
-- second 2026-11 ship review): the sender's authentication, unless its reason
-- was transient, and each attachment's scan by the SHA-256 of its bytes. Each
-- of up to eleven runs scanned every attachment again before, and could turn
-- a DKIM pass into a DNS timeout. A `failed` scan is kept and scanned again.
-- It names the sender, so only a mail still `received` carries it
-- (`inbound_mails_receive_progress_received`): the hold and the drop clear it.
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
                                 'claims_member_name', 'relaxed_alignment', 'sender_unchecked']::text[]);
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
  'The Python reader did not answer while the receive job held the mail: its text waits unreadable and sweep 15 reads it again from this time on while the mail waits. NULL once read (migration 0197).';
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "receive_progress" jsonb;
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_receive_progress_received";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_receive_progress_received"
  CHECK ("receive_progress" IS NULL OR ("status" = 'received' AND jsonb_typeof("receive_progress") = 'object'));
--> statement-breakpoint
COMMENT ON COLUMN "inbound_mails"."receive_progress" IS
  'What a receive run learned before a dependency fault, for the next run of the same mail: the sender''s authentication and each attachment''s scan by SHA-256. Only a received mail carries it; the hold and the drop clear it (migration 0197).';
