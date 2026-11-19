-- 0250: what keeps a reply in its E-Mail-Verlauf (ADR-0137, the 2026-11
-- threading review).
--
-- ## The entry keeps its own subject and conversation
--
-- `mail_thread_entries.base_subject` and `thread_index_guid` hold the base
-- subject and the Thread-Index GUID of the mail the entry is. The inbound mail
-- row loses its subject when it settles and is deleted after its keep, so a
-- detach could not give the Verlauf it starts the moved message's subject: it
-- took the subject of the Verlauf it left, and a reply to the moved message
-- matched only as `reference_subject_changed` (never preselected, never
-- followed). NULL for an entry filed before 0250; a detach then keeps the
-- left Verlauf's subject, as before.
ALTER TABLE "mail_thread_entries" ADD COLUMN IF NOT EXISTS "base_subject" text;
--> statement-breakpoint
ALTER TABLE "mail_thread_entries" ADD COLUMN IF NOT EXISTS "thread_index_guid" uuid;
--> statement-breakpoint
-- ## A follow on a full Verlauf ends
--
-- A reply to a Verlauf at 200 entries or 2 MiB cannot be appended
-- (`thread_full`); a follow on it waited forever while every reply waited for a
-- person. It now ends `thread_full` and its follower is told. NOT VALID, as
-- 0249 does: every existing row holds under the wider rule.
ALTER TABLE "mail_thread_follows" DROP CONSTRAINT IF EXISTS "mail_thread_follows_ended_reason_known";
--> statement-breakpoint
ALTER TABLE "mail_thread_follows" ADD CONSTRAINT "mail_thread_follows_ended_reason_known"
  CHECK ("ended_reason" IS NULL OR "ended_reason" IN
    ('unfollowed', 'expired', 'access_lost', 'address_rotated', 'detached', 'document_gone', 'revoked_by_manager',
     'project_closed', 'thread_full')) NOT VALID;
--> statement-breakpoint
-- ## A detached section names no more than its new Verlauf's readers may see
--
-- What a section prints for an attachment was decided for the Verlauf it was
-- filed into (RT-S13). Detached into a Verlauf more readers can open, it named
-- files and folders those readers cannot open. The detach now stops naming
-- them there: `section_name` and `section_folder_path` may become NULL
-- together, never a name again, so no Fassung names anew what an earlier one
-- did not.
CREATE OR REPLACE FUNCTION mail_thread_entry_attachments_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  keeps constant text[] := ARRAY['document_id', 'document_version_id', 'disposition', 'not_filed_reason',
                                 'section_name', 'section_folder_path'];
  was_pending boolean;
BEGIN
  was_pending := OLD.disposition = 'not_filed' AND OLD.not_filed_reason = 'pending';
  IF NEW.document_id IS NULL THEN
    NEW.document_version_id := NULL;
  END IF;
  IF (to_jsonb(NEW) - keeps) IS DISTINCT FROM (to_jsonb(OLD) - keeps)
     OR ((NEW.section_name IS DISTINCT FROM OLD.section_name
          OR NEW.section_folder_path IS DISTINCT FROM OLD.section_folder_path)
         AND (NEW.section_name IS NOT NULL OR NEW.section_folder_path IS NOT NULL)) THEN
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
