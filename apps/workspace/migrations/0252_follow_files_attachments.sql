-- 0252: replies from known correspondents are filed without a click; a follow
-- files a reply's attachments too (ADR-0137, amendment of 2026-11-19).
--
-- ## What changed
--
-- 0196 and 0197 let a follow decision (`via = 'follow'`) append a reply's text
-- to its E-Mail-Verlauf and nothing else: every attachment waited for a person
-- (`inbound_mail_decisions_follow_appends_text_only`, and the guard's
-- `inbound_mail_decisions_follow_files_text`). Now a follow also files each
-- attachment ARCHOS's suggestion places in a folder that already exists, or as
-- the next Fassung of a document the review defaults vouch for. Which ones is
-- the follow job's judgement (`followAttachmentDecisions`); the database holds
-- the bounds no code path may cross:
--
--   inbound_mail_decisions_follow_files_clean (CHECK)
--           a follow decision files, releases and acknowledges nothing, and
--           never names a folder to be created: an attachment goes into a
--           folder by id, the project root ('') or as a Fassung of a document.
--   inbound_mail_decisions_follow_attachment_clean (guard, INSERT)
--           a follow files an attachment only of a reply whose text the same
--           follow appended in the same name (that text decision holds the
--           follower key, `inbound_mail_decisions_follower_fkey`, which an
--           attachment's decision names no thread for), with the raw message and
--           the part scanned clean and the part free of risk flags and content
--           findings.
--   inbound_mail_parts_follow_files_clean (part guard)
--           an attachment flagged since its follow decision is not claimed on
--           it; it waits for a person, as a sender's part does.
--
-- The CHECK is NOT VALID, as 0250's: it only widens, every row already holds
-- under it, and the deploy does not scan the table to prove it. No new table,
-- so no `secure_table` and no GRANT; the guards stay SECURITY INVOKER and read
-- the mail, the part and the text's decision by their full keys, under the
-- caller's row-level security.
ALTER TABLE "inbound_mail_decisions" DROP CONSTRAINT IF EXISTS "inbound_mail_decisions_follow_appends_text_only";
--> statement-breakpoint
ALTER TABLE "inbound_mail_decisions" DROP CONSTRAINT IF EXISTS "inbound_mail_decisions_follow_files_clean";
--> statement-breakpoint
ALTER TABLE "inbound_mail_decisions" ADD CONSTRAINT "inbound_mail_decisions_follow_files_clean"
  CHECK ("via" <> 'follow'
     OR ("action" = 'file' AND "thread_action" IS DISTINCT FROM 'create'
         AND NOT "screening_release" AND NOT "acknowledged_risk" AND NOT "acknowledged_sender"
         AND ("thread_action" IS NOT DISTINCT FROM 'append' OR "folder_id" IS NOT NULL
              OR "target_document_id" IS NOT NULL OR "folder_path" IS NOT DISTINCT FROM ''))) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inbound_mail_decisions_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  part_kind text;
  part_state text;
  part_scan text;
  part_flags text[];
  part_findings text[];
  mail_class text;
  mail_flags text[];
  mail_sender text;
  mail_reason text;
  raw_scan text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT kind, state, scan_status, risk_flags, content_findings
      INTO part_kind, part_state, part_scan, part_flags, part_findings
      FROM inbound_mail_parts
     WHERE id = NEW.part_id AND mail_id = NEW.mail_id
       AND project_id = NEW.project_id AND organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RETURN NEW;  -- the composite key refuses it, with its own name
    END IF;
    IF (NEW.thread_action IS NOT NULL) <> (part_kind = 'message' AND NEW.action = 'file') THEN
      RAISE EXCEPTION 'a thread is chosen for a filed mail text, and only for it'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_thread_for_text',
              TABLE = 'inbound_mail_decisions';
    END IF;
    SELECT sender_class, sender_flags, sender_user_id, sender_reason, raw_scan_status
      INTO mail_class, mail_flags, mail_sender, mail_reason, raw_scan
      FROM inbound_mails
     WHERE id = NEW.mail_id AND project_id = NEW.project_id AND organization_id = NEW.organization_id;
    -- A follow's attachment rides on the text the same follow appended, and is clean.
    IF NEW.via = 'follow' AND part_kind <> 'message' AND NOT (
         raw_scan = 'clean' AND part_scan = 'clean'
         AND cardinality(part_flags) = 0 AND cardinality(part_findings) = 0
         AND EXISTS (SELECT 1 FROM inbound_mail_decisions text_decision
                      WHERE text_decision.mail_id = NEW.mail_id
                        AND text_decision.project_id = NEW.project_id
                        AND text_decision.organization_id = NEW.organization_id
                        AND text_decision.follow_id = NEW.follow_id
                        AND text_decision.decided_by = NEW.decided_by
                        AND text_decision.thread_action = 'append')) THEN
      RAISE EXCEPTION 'a follow files an attachment only with the text it appended, scanned clean and unflagged'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_follow_attachment_clean',
              TABLE = 'inbound_mail_decisions';
    END IF;
    IF NEW.via = 'sender' AND NOT (FOUND
         AND mail_class = 'verified_writer' AND NEW.decided_by = mail_sender AND raw_scan = 'clean'
         AND cardinality(part_flags) = 0 AND cardinality(part_findings) = 0) THEN
      RAISE EXCEPTION 'only a verified writer''s own clean, unflagged mail is filed without a click'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_sender_files_own_verified_mail',
              TABLE = 'inbound_mail_decisions';
    END IF;
    -- Its member, or any writer who says they checked it is from them; an
    -- impersonation (a signature the domain rejected, or no verdict at all)
    -- only by its member. The reasons are `REJECTED_SIGNATURE_REASONS` in
    -- `lib/inbound-mail/impersonation.ts`.
    IF mail_class = 'unverified_writer' AND NEW.action IN ('file', 'restore')
       AND ((NEW.action = 'file' AND NOT NEW.acknowledged_sender)
         OR (NEW.decided_by IS DISTINCT FROM mail_sender
             AND (mail_reason IS NULL
               OR mail_reason IN ('dkim_fail', 'dkim_policy', 'dkim_weak_algorithm', 'dkim_short_key')
               OR 'claims_member_name' = ANY (mail_flags)))) THEN
      RAISE EXCEPTION 'mail that claims a member is released only with an acknowledgement, an impersonation only by that member'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_claimed_sender_releases',
              TABLE = 'inbound_mail_decisions';
    END IF;
    -- A mail whose sender could not be checked (`sender_unchecked`, 0199) may be a member's: a member's restore.
    IF mail_class = 'external' AND NEW.action = 'restore' AND part_state = 'expired'
       AND NOT ('sender_unchecked' = ANY (mail_flags)) THEN
      RAISE EXCEPTION 'an outsider''s mail that ran out is discarded, never restored'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_external_expiry_final',
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
-- 0197's part guard, plus: an attachment flagged since its follow's decision
-- is not claimed on it either.
CREATE OR REPLACE FUNCTION inbound_mail_parts_decision_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  decided_action text;
  decided_via text;
BEGIN
  IF NEW.decision_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.decision_id IS NOT DISTINCT FROM OLD.decision_id) THEN
    RETURN NEW;
  END IF;
  SELECT action, via INTO decided_action, decided_via FROM inbound_mail_decisions WHERE id = NEW.decision_id;
  -- Not found: the composite key refuses it, with its own name.
  IF FOUND AND decided_action <> 'file' THEN
    RAISE EXCEPTION 'an inbound mail part is filed only on a file decision, not on %', decided_action
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_parts_decision_files',
            TABLE = 'inbound_mail_parts';
  END IF;
  IF FOUND AND decided_via = 'sender'
     AND (cardinality(NEW.risk_flags) > 0 OR cardinality(NEW.content_findings) > 0) THEN
    RAISE EXCEPTION 'a part flagged since its sender''s decision waits for a person'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_parts_sender_files_clean',
            TABLE = 'inbound_mail_parts';
  END IF;
  IF FOUND AND decided_via = 'follow' AND NEW.kind = 'attachment'
     AND (cardinality(NEW.risk_flags) > 0 OR cardinality(NEW.content_findings) > 0) THEN
    RAISE EXCEPTION 'an attachment flagged since its follow''s decision waits for a person'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_parts_follow_files_clean',
            TABLE = 'inbound_mail_parts';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON TABLE "inbound_mail_decisions" IS
  'Append-only: every file, dismiss or restore a person decided on a received mail''s part, and how it reached us; a direct filing is the verified sender''s own decision (via = sender), a follow''s the follower''s (via = follow: a reply''s text, and its clean attachments into existing folders). The filing job reads what to do from here, the audit trail is sent from here (audited_at). Only audited_at changes, once; a row is deleted only after it was audited, unless its project is purged. Tenant data (migrations 0196, 0197, 0252).';
