-- Reverse 0255. ORDER: roll the frontend back first; the newer build offers
-- the restore of an outsider's expired part, which the older guard refuses.
--
-- Lossy: decisions are append-only, so an outsider's expired part restored
-- under 0255 stays restored. The older build's sweep 6 erases an outsider's
-- part that expires from then on at once, as before.
--
-- 0252's decision guard, as it was.
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
