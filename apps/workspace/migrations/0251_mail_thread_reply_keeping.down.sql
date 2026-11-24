-- Reverse 0251. ORDER: roll the frontend back first; the newer build writes
-- the entry columns and ends follows `thread_full`.
--
-- Lossy: an entry forgets its own subject and conversation, and a follow that
-- ended `thread_full` reads `expired`, the closest the old vocabulary says.
-- Sections a detach stopped naming stay unnamed.
UPDATE "mail_thread_follows" SET "ended_reason" = 'expired' WHERE "ended_reason" = 'thread_full';
--> statement-breakpoint
ALTER TABLE "mail_thread_follows" DROP CONSTRAINT IF EXISTS "mail_thread_follows_ended_reason_known";
--> statement-breakpoint
ALTER TABLE "mail_thread_follows" ADD CONSTRAINT "mail_thread_follows_ended_reason_known"
  CHECK ("ended_reason" IS NULL OR "ended_reason" IN
    ('unfollowed', 'expired', 'access_lost', 'address_rotated', 'detached', 'document_gone', 'revoked_by_manager',
     'project_closed'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mail_thread_entry_attachments_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  keeps constant text[] := ARRAY['document_id', 'document_version_id', 'disposition', 'not_filed_reason'];
  was_pending boolean;
BEGIN
  was_pending := OLD.disposition = 'not_filed' AND OLD.not_filed_reason = 'pending';
  IF NEW.document_id IS NULL THEN
    NEW.document_version_id := NULL;
  END IF;
  IF (to_jsonb(NEW) - keeps) IS DISTINCT FROM (to_jsonb(OLD) - keeps) THEN
    RAISE EXCEPTION 'what came with a filed message is never rewritten'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'mail_thread_entry_attachments_frozen',
            TABLE = 'mail_thread_entry_attachments';
  END IF;
  IF NOT was_pending AND (
       NEW.disposition IS DISTINCT FROM OLD.disposition
       OR NEW.not_filed_reason IS DISTINCT FROM OLD.not_filed_reason
       OR (NEW.document_id IS DISTINCT FROM OLD.document_id AND NEW.document_id IS NOT NULL)
       OR (NEW.document_version_id IS DISTINCT FROM OLD.document_version_id AND NEW.document_version_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'only an attachment that still waited is decided later, and only once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'mail_thread_entry_attachments_decided_once',
            TABLE = 'mail_thread_entry_attachments';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" DROP COLUMN IF EXISTS "thread_index_guid";
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" DROP COLUMN IF EXISTS "base_subject";
