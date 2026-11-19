-- Reverse 0250. ORDER: roll the frontend back first; the newer build files a
-- relaxed-aligned writer's mail directly, lets a colleague release a mail that
-- claims a writer, and reads and writes `forwarded_from`.
--
-- Lossy: the list of forwarding addresses goes, so a mail forwarded from one
-- is held as not addressed to the project again. Decisions are append-only and
-- stay as they were made: a colleague's release and a relaxed-aligned direct
-- filing keep their rows. The evidence CHECK comes back NOT VALID for the same
-- reason: rows held as verified writers under 0250 with `relaxed_alignment`
-- keep their class; only new holds are refused.
ALTER TABLE "inbound_mail_addresses" DROP CONSTRAINT IF EXISTS "inbound_mail_addresses_forwarded_from_shape";
--> statement-breakpoint
ALTER TABLE "inbound_mail_addresses" DROP COLUMN IF EXISTS "forwarded_from";
--> statement-breakpoint
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_verified_writer_evidence";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_verified_writer_evidence"
  CHECK ("sender_class" IS DISTINCT FROM 'verified_writer' OR (
    "sender_trust" = 'member_verified' AND "sender_reason" = 'dkim_pass' AND "sender_user_id" IS NOT NULL
    AND NOT "automatic"
    AND NOT ("sender_flags" && ARRAY['stale_date', 'date_out_of_range', 'message_id_reused', 'already_filed',
                                     'not_addressed_to_project', 'relaxed_alignment']::text[]))) NOT VALID;
--> statement-breakpoint
-- 0197's decision guard, as it was.
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
