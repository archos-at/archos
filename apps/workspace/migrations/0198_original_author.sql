-- 0198: who wrote a forwarded mail, beside who forwarded it (ADR-0137,
-- amendment of 2026-11-03: a filed mail is "cited as a source with its author
-- and date").
--
-- ## What was missing
--
-- A colleague forwards the Behörde's mail to the project address. Until now
-- the mail's only sender was the colleague: the From of the delivery, which
-- DKIM checks and the audit trail keeps. Every citation then said the
-- colleague wrote what the Behörde wrote, at the time it was forwarded.
--
-- ## The columns
--
-- `inbound_mails` gets the ORIGINAL message the receive job reads out of the
-- delivery (`lib/inbound-mail/original-message.ts`): an attached original
-- (`message/rfc822`, an `.eml`), or else the header block a mail program
-- writes into an inline forward. All NULL for a mail that is no forward.
--
--   original_author_address, original_author_name   the original's From
--   original_sent_at                                  its Date, as written
--   original_subject                                  its Subject
--   original_message_id                               its Message-ID (an attached
--                                                     original only: an inline
--                                                     block has none)
--   original_source                                   'attachment' or 'inline'
--
-- Nothing here is verified: an inline block is text the forwarder's program
-- wrote, and the forwarder could edit it. It names the author for
-- attribution, never for trust; trust stays the forwarder's (DKIM/DMARC, the
-- `sender_*` columns, unchanged).
--
-- The name, address and subject are third-party data and go when the mail
-- ends, like `sender_address` and `subject` (`inbound_mails_ended_is_scrubbed`).
-- The code paths that end a mail were written before these columns, so a
-- trigger clears them on the way to `settled` or `dropped` and a CHECK says it
-- holds. The Message-ID, the date and the source stay, like `message_id`:
-- ids and times, kept for the audit.
--
-- `mail_thread_entries` gets the author the filed entry is attributed to
-- (`author_*`; the entry's `original_*` columns already name the delivery's
-- `.eml`, the evidence): the heading names the author and the date they wrote,
-- and a line under it names the forwarder (`lib/mail-thread/render.ts`). The
-- entry outlives the mail, so the author lives where the Verlauf does.
--
-- ## An original's Message-ID drops nothing
--
-- `original_message_id` is what the `.eml` inside the delivery says, written
-- by whoever sent the delivery and read before anyone checked who that is. An
-- outsider who knows the id of a mail they sent the architect (they wrote it)
-- can attach a fake `.eml` that claims it. So the id is never unique and never
-- a reason to drop: every forward is held, its own text and attachments
-- shown, whoever claimed the id first. `inbound_mails_original_message_id_idx`
-- is a plain index, for the reviewer's and the operator's "who else forwarded
-- this".
--
-- The id counts once, at filing (`lib/mail-thread/append.ts`): when another
-- mail's entry in the project already holds that original
-- (`mail_thread_entries.author_message_id`), the original is not given a
-- second section under its author's name. The forward is filed as its
-- forwarder's own message instead, with its text and what came with it.
-- An attachment the project already holds byte for byte is flagged
-- `duplicate_of` at receipt, as any attachment is.
--
-- Additive and idempotent.

ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "original_author_address" text;
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "original_author_name" text;
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "original_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "original_subject" text;
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "original_message_id" text;
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "original_source" text;
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_source_known";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_original_source_known"
  CHECK ("original_source" IS NULL OR "original_source" IN ('attachment', 'inline'));
--> statement-breakpoint
-- Every original says where it was read; no source, no original.
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_with_source";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_original_with_source"
  CHECK ("original_source" IS NOT NULL
     OR ("original_author_address" IS NULL AND "original_author_name" IS NULL AND "original_sent_at" IS NULL
         AND "original_subject" IS NULL AND "original_message_id" IS NULL));
--> statement-breakpoint
-- An inline block carries no Message-ID: one there was made up.
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_message_id_attached";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_original_message_id_attached"
  CHECK ("original_message_id" IS NULL OR "original_source" = 'attachment');
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_lengths";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_original_lengths"
  CHECK (("original_author_address" IS NULL OR char_length("original_author_address") BETWEEN 1 AND 320)
     AND ("original_author_name" IS NULL OR char_length("original_author_name") BETWEEN 1 AND 300)
     AND ("original_subject" IS NULL OR char_length("original_subject") <= 998)
     AND ("original_message_id" IS NULL OR char_length("original_message_id") BETWEEN 1 AND 998));
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_original_scrubbed";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_original_scrubbed"
  CHECK ("status" NOT IN ('settled', 'dropped')
     OR ("original_author_address" IS NULL AND "original_author_name" IS NULL AND "original_subject" IS NULL));
--> statement-breakpoint
-- The ending paths (filing, the sweeps, the drop) predate these columns: the
-- trigger clears them as the row ends, so none of them has to remember.
CREATE OR REPLACE FUNCTION inbound_mails_scrub_original() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.original_author_address := NULL;
  NEW.original_author_name := NULL;
  NEW.original_subject := NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "inbound_mails_scrub_original" ON "inbound_mails";
--> statement-breakpoint
CREATE TRIGGER "inbound_mails_scrub_original"
  BEFORE INSERT OR UPDATE ON "inbound_mails"
  FOR EACH ROW WHEN (NEW.status IN ('settled', 'dropped'))
  EXECUTE FUNCTION inbound_mails_scrub_original();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_mails_original_message_id_idx"
  ON "inbound_mails" ("project_id", "original_message_id") WHERE "original_message_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" ADD COLUMN IF NOT EXISTS "author_address" text;
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" ADD COLUMN IF NOT EXISTS "author_name" text;
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" ADD COLUMN IF NOT EXISTS "author_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" ADD COLUMN IF NOT EXISTS "author_message_id" text;
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" DROP CONSTRAINT IF EXISTS "mail_thread_entries_author_lengths";
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" ADD CONSTRAINT "mail_thread_entries_author_lengths"
  CHECK (("author_address" IS NULL OR char_length("author_address") BETWEEN 1 AND 320)
     AND ("author_name" IS NULL OR char_length("author_name") BETWEEN 1 AND 300)
     AND ("author_message_id" IS NULL OR char_length("author_message_id") BETWEEN 1 AND 998));
--> statement-breakpoint
-- An author is a forward's: the archive import reads no forward, and a
-- message id or date with nobody named is no attribution.
ALTER TABLE "mail_thread_entries" DROP CONSTRAINT IF EXISTS "mail_thread_entries_author_named";
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" ADD CONSTRAINT "mail_thread_entries_author_named"
  CHECK (("author_address" IS NULL AND "author_name" IS NULL AND "author_sent_at" IS NULL AND "author_message_id" IS NULL)
     OR ("source" = 'inbound' AND ("author_address" IS NOT NULL OR "author_name" IS NOT NULL)));
--> statement-breakpoint
-- A filed original: a later forward of it is filed as its forwarder's own message.
CREATE INDEX IF NOT EXISTS "mail_thread_entries_author_message_id_idx"
  ON "mail_thread_entries" ("project_id", "author_message_id") WHERE "author_message_id" IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN "inbound_mails"."original_message_id" IS
  'The Message-ID of the original a forward carried as an attachment, as the .eml said: the sender''s word, never unique and never a reason to drop a delivery. Filing reads it against mail_thread_entries.author_message_id, so an original is attributed one section per project (migration 0198).';
--> statement-breakpoint
COMMENT ON COLUMN "mail_thread_entries"."author_name" IS
  'Who wrote a forwarded message (its original''s From), as the forward said: attribution, never verified. The sender_* columns stay the forwarder''s (migration 0198).';
