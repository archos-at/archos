-- 0195: mail a project writer signed is filed as them; mail that only claims a
-- writer waits for that writer; the rest waits for the project's writers
-- (ADR-0137, "Amendment, 2026-11-03").
--
-- ## What changed
--
-- 0194 held every mail for a person. The product owner's rule replaces that
-- guarantee: a mail whose From is a member who may write in the project, whose
-- own domain signed it (DKIM by the From domain itself: strict alignment; a
-- parent's or a subdomain's key, which a newsletter service may hold, is only
-- `relaxed_alignment` and waits), whose signed
-- To or Cc names the project, without a replay or date flag and not sent
-- automatically, is filed directly, AS THAT MEMBER. Everything else still
-- waits, and who may release it depends on who it claims to be from. A
-- member's own Bcc copy (`bcc_own`) waits for that member: its flag is told
-- apart from a recipient re-sending the member's signed mail by time alone,
-- and time does not tell them apart.
--
-- ## One column, written once
--
-- `inbound_mails.sender_class` is the receive job's classification of the
-- sender, made when the mail is held:
--
--   verified_writer    the rule above holds: filed by its sender, without a click
--   unverified_writer  From is such a member, but the signature fails, is absent,
--                      or does not name the project (a Bcc copy included), or
--                      carries a replay or date flag: only that member
--                      releases it, saying they sent it (`acknowledged_sender`)
--   office_member      From is a member without write rights in the project
--   external           From is nobody in the office
--
-- The old 4-way `sender_trust` stays as the evidence. The database ties the
-- class to it (`inbound_mails_verified_writer_evidence`), and freezes both once
-- the mail is held (`inbound_mails_sender_verdict_guard`): the verdict is
-- written by the `received -> waiting` transition and by nothing else, so no
-- later UPDATE can turn a stranger's mail into a writer's.
--
-- Write rights live in WorkOS, which the database cannot see: the class records
-- the app's check at receipt (`userHoldsProjectPermissionStrict`; one WorkOS
-- does not answer is waited out, then held `sender_unchecked`, 0197). A wrong class can
-- only file AS the authenticated sender, whose upload the filing job authorizes
-- again in their own session. A forged or unsigned From never reaches
-- `via = 'sender'`, whatever the app does.
--
-- ## Who decides a direct filing
--
-- A person, still: the sender. A direct filing is a decision row
-- `via = 'sender'` with `decided_by = inbound_mails.sender_user_id`, so
-- `inbound_mail_decisions_decider_is_person` and
-- `mail_thread_entries_filer_is_person` hold unchanged, and no `system:*` actor
-- ever files. `inbound_mail_decisions_guard` refuses a `via = 'sender'` row
-- unless the mail is `verified_writer`, the decider is its sender, its raw
-- message scanned clean and the part carries no flag or finding; and a file or
-- restore on an `unverified_writer` mail unless its member makes it (a file
-- saying they sent it). An expired part of an outsider's mail is not restored:
-- its window has no restore after expiry.
--
-- No new table, so no `secure_table` and no GRANT; the triggers stay SECURITY
-- INVOKER and read the mail and the part by their full composite keys, under
-- the caller's row-level security.
ALTER TABLE "inbound_mails" ADD COLUMN IF NOT EXISTS "sender_class" text;
--> statement-breakpoint
-- What 0194 held was classified by nobody's write right: never `verified_writer`.
UPDATE "inbound_mails"
   SET "sender_class" = CASE WHEN "sender_trust" LIKE 'member\_%' THEN 'office_member' ELSE 'external' END
 WHERE "sender_trust" IS NOT NULL AND "sender_class" IS NULL;
--> statement-breakpoint
ALTER TABLE "inbound_mails"
  DROP CONSTRAINT IF EXISTS "inbound_mails_sender_flags_known",
  DROP CONSTRAINT IF EXISTS "inbound_mails_relaxed_alignment_verified",
  DROP CONSTRAINT IF EXISTS "inbound_mails_sender_class_known",
  DROP CONSTRAINT IF EXISTS "inbound_mails_sender_class_with_trust",
  DROP CONSTRAINT IF EXISTS "inbound_mails_sender_class_member",
  DROP CONSTRAINT IF EXISTS "inbound_mails_verified_writer_evidence",
  -- 0194's list, plus `relaxed_alignment`: a verified mail signed by a parent
  -- or a subdomain of the From domain, never the From domain itself.
  ADD CONSTRAINT "inbound_mails_sender_flags_known"
    CHECK ("sender_flags" <@ ARRAY['not_addressed_to_project', 'bcc_own', 'stale_date',
                                   'date_out_of_range', 'message_id_reused', 'already_filed',
                                   'claims_member_name', 'relaxed_alignment']::text[]),
  ADD CONSTRAINT "inbound_mails_relaxed_alignment_verified"
    CHECK (NOT ('relaxed_alignment' = ANY ("sender_flags"))
       OR "sender_trust" IN ('member_verified', 'external_verified')),
  ADD CONSTRAINT "inbound_mails_sender_class_known" CHECK ("sender_class" IS NULL
    OR "sender_class" IN ('verified_writer', 'unverified_writer', 'office_member', 'external')),
  -- Classified exactly when judged, so every mail a person sees has a class
  -- (`inbound_mails_trust_when_shown`, 0194).
  ADD CONSTRAINT "inbound_mails_sender_class_with_trust"
    CHECK (("sender_class" IS NULL) = ("sender_trust" IS NULL)),
  -- `external` is exactly "no member": the three member classes name one (`inbound_mails_member_has_user`).
  ADD CONSTRAINT "inbound_mails_sender_class_member"
    CHECK ("sender_class" IS NULL OR ("sender_class" = 'external') = ("sender_trust" LIKE 'external\_%')),
  -- The evidence of a direct filing: a DKIM pass by the From domain itself
  -- (strict alignment, no `relaxed_alignment`) for a named member,
  -- a signed To or Cc naming the project (never a Bcc copy: an outsider who
  -- received the member's mail can re-send it within the Bcc window), no replay
  -- or date flag, not automatic.
  ADD CONSTRAINT "inbound_mails_verified_writer_evidence"
    CHECK ("sender_class" IS DISTINCT FROM 'verified_writer' OR (
      "sender_trust" = 'member_verified' AND "sender_reason" = 'dkim_pass' AND "sender_user_id" IS NOT NULL
      AND NOT "automatic"
      AND NOT ("sender_flags" && ARRAY['stale_date', 'date_out_of_range', 'message_id_reused', 'already_filed',
                                       'not_addressed_to_project', 'relaxed_alignment']::text[])));
--> statement-breakpoint
-- The verdict is the hold's: set in `received -> waiting` (`holdMail`'s
-- compare-and-set) and frozen after it; a mail never goes back to `receiving`
-- or `received`, and nothing INSERTs a `verified_writer` (the receive path
-- inserts `receiving` rows only).
CREATE OR REPLACE FUNCTION inbound_mails_sender_verdict_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sender_class = 'verified_writer' THEN
      RAISE EXCEPTION 'a mail becomes a verified writer''s only when it is held'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mails_sender_verdict_held_once',
              TABLE = 'inbound_mails';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IN ('receiving', 'received') AND OLD.status NOT IN ('receiving', 'received') THEN
    RAISE EXCEPTION 'a held or ended mail is never received again'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mails_sender_verdict_held_once',
            TABLE = 'inbound_mails';
  END IF;
  IF NOT (OLD.status = 'received' AND NEW.status = 'waiting')
     AND (NEW.sender_class, NEW.sender_trust, NEW.sender_user_id, NEW.sender_reason, NEW.sender_flags,
          NEW.signer_domain, NEW.signed_headers, NEW.automatic, NEW.received_at)
         IS DISTINCT FROM
         (OLD.sender_class, OLD.sender_trust, OLD.sender_user_id, OLD.sender_reason, OLD.sender_flags,
          OLD.signer_domain, OLD.signed_headers, OLD.automatic, OLD.received_at) THEN
    RAISE EXCEPTION 'who sent a mail is judged once, when it is held'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mails_sender_verdict_frozen',
            TABLE = 'inbound_mails';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "inbound_mails_sender_verdict_guard" ON "inbound_mails";
--> statement-breakpoint
CREATE TRIGGER "inbound_mails_sender_verdict_guard"
  BEFORE INSERT OR UPDATE ON "inbound_mails"
  FOR EACH ROW EXECUTE FUNCTION inbound_mails_sender_verdict_guard();
--> statement-breakpoint
ALTER TABLE "inbound_mail_decisions"
  DROP CONSTRAINT IF EXISTS "inbound_mail_decisions_via_known",
  DROP CONSTRAINT IF EXISTS "inbound_mail_decisions_sender_files_clean",
  ADD CONSTRAINT "inbound_mail_decisions_via_known"
    CHECK ("via" IN ('app', 'agent', 'agent_proposal', 'follow', 'sender')),
  -- A sender's direct filing files, and acknowledges or releases nothing (as an agent's card, RT-S5).
  ADD CONSTRAINT "inbound_mail_decisions_sender_files_clean"
    CHECK ("via" <> 'sender' OR ("action" = 'file'
       AND NOT "screening_release" AND NOT "acknowledged_risk" AND NOT "acknowledged_sender"));
--> statement-breakpoint
ALTER TABLE "mail_thread_entries"
  DROP CONSTRAINT IF EXISTS "mail_thread_entries_filed_via_known",
  DROP CONSTRAINT IF EXISTS "mail_thread_entries_sender_filing_verified",
  ADD CONSTRAINT "mail_thread_entries_filed_via_known"
    CHECK ("filed_via" IN ('app', 'agent', 'agent_proposal', 'follow', 'archive_import', 'sender')),
  -- A message filed by its sender's own signature names that verdict.
  ADD CONSTRAINT "mail_thread_entries_sender_filing_verified"
    CHECK ("filed_via" <> 'sender' OR "sender_trust" = 'member_verified');
--> statement-breakpoint
-- 0194's decision guard, with the sender rule in its INSERT branch:
--
--   INSERT  a thread is chosen for the mail's text and nothing else, and a
--           filed text always goes into one; a follow files a text (D31);
--           `via = 'sender'` only on a verified writer's own clean, unflagged
--           mail, decided by that writer; a file or restore on a mail that
--           only claims a writer only by that writer (a file saying they sent
--           it); an outsider's expired part is not restored, unless its
--           sender could not be checked (`sender_unchecked`, migration 0197):
--           that mail may be a member's, and keeps a member's restore.
--   UPDATE  nothing changes but `audited_at`, once, from NULL to a time.
--   DELETE  only after the audit trail took it (RT-S8), unless the project is
--           gone: a purge deletes the project row first and cascades from it,
--           so inside the cascade the project no longer exists.
CREATE OR REPLACE FUNCTION inbound_mail_decisions_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  part_kind text;
  part_state text;
  part_flags text[];
  part_findings text[];
  mail_class text;
  mail_flags text[];
  mail_sender text;
  raw_scan text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT kind, state, risk_flags, content_findings INTO part_kind, part_state, part_flags, part_findings
      FROM inbound_mail_parts
     WHERE id = NEW.part_id AND mail_id = NEW.mail_id
       AND project_id = NEW.project_id AND organization_id = NEW.organization_id;
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
    SELECT sender_class, sender_flags, sender_user_id, raw_scan_status INTO mail_class, mail_flags, mail_sender, raw_scan
      FROM inbound_mails
     WHERE id = NEW.mail_id AND project_id = NEW.project_id AND organization_id = NEW.organization_id;
    IF NEW.via = 'sender' AND NOT (FOUND
         AND mail_class = 'verified_writer' AND NEW.decided_by = mail_sender AND raw_scan = 'clean'
         AND cardinality(part_flags) = 0 AND cardinality(part_findings) = 0) THEN
      RAISE EXCEPTION 'only a verified writer''s own clean, unflagged mail is filed without a click'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_sender_files_own_verified_mail',
              TABLE = 'inbound_mail_decisions';
    END IF;
    IF mail_class = 'unverified_writer' AND NEW.action IN ('file', 'restore')
       AND (NEW.decided_by IS DISTINCT FROM mail_sender OR (NEW.action = 'file' AND NOT NEW.acknowledged_sender)) THEN
      RAISE EXCEPTION 'mail that claims a member is released only by that member, who says they sent it'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'inbound_mail_decisions_claimed_sender_releases',
              TABLE = 'inbound_mail_decisions';
    END IF;
    -- A mail whose sender could not be checked (`sender_unchecked`, 0197) may be a member's: a member's restore.
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
-- 0194's part guard, plus: a part flagged since its sender's direct decision
-- is not claimed on it; it waits for a person.
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
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON COLUMN "inbound_mails"."sender_class" IS
  'Who the sender is to this project, judged once when the mail is held and frozen after (migration 0195): verified_writer (filed directly as the sender), unverified_writer (only that member releases it), office_member, external (held for the project''s writers; an outsider''s mail is discarded after 14 days).';
--> statement-breakpoint
COMMENT ON TABLE "inbound_mails" IS
  'One delivery to a project mail address (ADR-0137 and its 2026-11-03 amendment). A verified writer''s mail is filed directly as that writer; every other mail is held until a person files or dismisses its parts. Holds what a reviewer needs to decide until it settles, then only ids, counts and the member it came from; the message itself is a staged object named by its key. Deleted after the retention window. Tenant data (migrations 0194, 0195).';
--> statement-breakpoint
COMMENT ON TABLE "inbound_mail_decisions" IS
  'Append-only: every file, dismiss or restore a person decided on a received mail''s part, and how it reached us; a direct filing is the verified sender''s own decision (via = sender). The filing job reads what to do from here, the audit trail is sent from here (audited_at). Only audited_at changes, once; a row is deleted only after it was audited, unless its project is purged. Tenant data (migrations 0194, 0195).';
