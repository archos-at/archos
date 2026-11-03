-- Reverse 0194. ORDER: roll the frontend back first; the newer build writes
-- `sender_class`, files a verified writer's mail as them (`via = 'sender'`) and
-- reads the class in the E-Mail-Eingang.
--
-- REFUSED while any decision or filed message says `sender`: decisions are
-- append-only and an entry's `filed_via` is its record, so this cannot rewrite
-- them, and 0193's lists would refuse them. List them:
--
--   SELECT id, mail_id, part_id, decided_by FROM inbound_mail_decisions WHERE via = 'sender';
--   SELECT id, inbound_mail_id, filed_by FROM mail_thread_entries WHERE filed_via = 'sender';
--
-- Lossy, even then: the class goes, and every mail waits for a person again,
-- an outsider's for its 30 days from receipt as 0193 fixed it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inbound_mail_decisions WHERE via = 'sender')
  OR EXISTS (SELECT 1 FROM mail_thread_entries WHERE filed_via = 'sender') THEN
    RAISE EXCEPTION 'reverse 0194 refused: mail was filed directly by its sender (via = sender)'
      USING ERRCODE = 'object_in_use',
            HINT = 'The listing queries are in the header of 0194_sender_class.down.sql; those rows are the record of a person''s filing and are not rewritten.';
  END IF;
END
$$;
--> statement-breakpoint
DELETE FROM "bff_job_queue" WHERE "kind" = 'inbound_mail_sender_file';
--> statement-breakpoint
DELETE FROM "inbox_items" WHERE "type" IN ('inbound_mail.held', 'inbound_mail.held_for_writers', 'inbound_mail.rejected', 'inbound_mail.expired');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "inbound_mails_sender_verdict_guard" ON "inbound_mails";
--> statement-breakpoint
DROP FUNCTION IF EXISTS inbound_mails_sender_verdict_guard();
--> statement-breakpoint
ALTER TABLE "mail_thread_entries"
  DROP CONSTRAINT IF EXISTS "mail_thread_entries_sender_filing_verified",
  DROP CONSTRAINT IF EXISTS "mail_thread_entries_filed_via_known",
  ADD CONSTRAINT "mail_thread_entries_filed_via_known"
    CHECK ("filed_via" IN ('app', 'agent', 'agent_proposal', 'follow', 'archive_import'));
--> statement-breakpoint
ALTER TABLE "inbound_mail_decisions"
  DROP CONSTRAINT IF EXISTS "inbound_mail_decisions_sender_files_clean",
  DROP CONSTRAINT IF EXISTS "inbound_mail_decisions_via_known",
  ADD CONSTRAINT "inbound_mail_decisions_via_known"
    CHECK ("via" IN ('app', 'agent', 'agent_proposal', 'follow'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inbound_mail_decisions_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  part_kind text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT kind INTO part_kind FROM inbound_mail_parts WHERE id = NEW.part_id;
    IF NOT FOUND THEN
      RETURN NEW;  -- the composite key refuses it, with its own name
    END IF;
    IF NEW.via = 'follow' AND part_kind <> 'message' THEN
      RAISE EXCEPTION 'a follow appends a mail''s text, never an attachment'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_follow_files_text',
              TABLE = 'inbound_mail_decisions';
    END IF;
    IF (NEW.thread_action IS NOT NULL) <> (part_kind = 'message' AND NEW.action = 'file') THEN
      RAISE EXCEPTION 'a thread is chosen for a filed mail text, and only for it'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_thread_for_text',
              TABLE = 'inbound_mail_decisions';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.audited_at IS NOT NULL
       OR NEW.audited_at IS NULL
       OR (to_jsonb(NEW) - 'audited_at') IS DISTINCT FROM (to_jsonb(OLD) - 'audited_at') THEN
      RAISE EXCEPTION 'an inbound mail decision is never changed, only marked audited once'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_immutable',
              TABLE = 'inbound_mail_decisions';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.audited_at IS NULL AND EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id) THEN
    RAISE EXCEPTION 'an inbound mail decision is deleted only after the audit trail took it'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_audited_before_delete',
            TABLE = 'inbound_mail_decisions';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inbound_mail_parts_decision_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  decided_action text;
BEGIN
  IF NEW.decision_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.decision_id IS NOT DISTINCT FROM OLD.decision_id) THEN
    RETURN NEW;
  END IF;
  SELECT action INTO decided_action FROM inbound_mail_decisions WHERE id = NEW.decision_id;
  -- Not found: the composite key refuses it, with its own name.
  IF FOUND AND decided_action <> 'file' THEN
    RAISE EXCEPTION 'an inbound mail part is filed only on a file decision, not on %', decided_action
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_parts_decision_files',
            TABLE = 'inbound_mail_parts';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
ALTER TABLE "inbound_mails"
  DROP CONSTRAINT IF EXISTS "inbound_mails_verified_writer_evidence",
  DROP CONSTRAINT IF EXISTS "inbound_mails_sender_class_member",
  DROP CONSTRAINT IF EXISTS "inbound_mails_sender_class_with_trust",
  DROP CONSTRAINT IF EXISTS "inbound_mails_sender_class_known";
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP COLUMN IF EXISTS "sender_class";
--> statement-breakpoint
COMMENT ON TABLE "inbound_mails" IS
  'One delivery to a project mail address, held until a person files or dismisses its parts (ADR-0137). Holds what a reviewer needs to decide until it settles, then only ids, counts and the member it came from; the message itself is a staged object named by its key. Deleted after the retention window. Tenant data (migration 0193).';
--> statement-breakpoint
COMMENT ON TABLE "inbound_mail_decisions" IS
  'Append-only: every file, dismiss or restore a person decided on a received mail''s part, and how it reached us. The filing job reads what to do from here, the audit trail is sent from here (audited_at). Only audited_at changes, once; a row is deleted only after it was audited, unless its project is purged. Tenant data (migration 0193).';
