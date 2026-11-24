-- 0250: automatic by default, review only the exceptions; dock onto the
-- office's existing project addresses (ADR-0137, amendment of 2026-11-19).
--
-- ## Relaxed alignment files directly
--
-- 0197 let only a DKIM pass by the From domain itself (strict alignment) file a
-- writer's mail directly; a pass by the organizational domain or a subdomain
-- (`relaxed_alignment`) waited for its member. DMARC accepts relaxed alignment
-- as authentic, and so does the product owner: the flag stays as evidence, and
-- `inbound_mails_verified_writer_evidence` no longer lists it. Every other rule
-- of the evidence stands. NOT VALID, as 0249 does: the rule only widens, every
-- row already holds under it, and the deploy does not scan the table to prove it.
--
-- ## A colleague releases a mail that claims a writer
--
-- 0197 let only the member an `unverified_writer` mail claims file or restore
-- it, so a mail whose member was away, or had left, waited for nobody. Now any
-- decider may, once they say they checked it is from that member: a file needs
-- `acknowledged_sender` whoever makes it. An impersonation stays the member's
-- alone: a signature their domain rejected (`dkim_fail`, `dkim_policy`,
-- `dkim_weak_algorithm`, `dkim_short_key`, which `impersonationOf` names), a
-- `claims_member_name`, or no verdict. Who may decide at all (a project writer)
-- is the app's check, as before; a follow and an agent's card still cannot
-- acknowledge, so they still cannot release it.
--
-- ## The office's existing project addresses
--
-- `inbound_mail_addresses.forwarded_from`: up to ten addresses the office
-- already uses for the project (projekt-x@buero.at), lowercase, that forward
-- to this address by a rule. A signed To or Cc naming one of them counts as
-- addressed to the project (`not_addressed_to_project` is not set). A rotation
-- carries the list to the new address. Tenant data on an existing table, so no
-- `secure_table` and no GRANT.
ALTER TABLE "inbound_mails" DROP CONSTRAINT IF EXISTS "inbound_mails_verified_writer_evidence";
--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_verified_writer_evidence"
  CHECK ("sender_class" IS DISTINCT FROM 'verified_writer' OR (
    "sender_trust" = 'member_verified' AND "sender_reason" = 'dkim_pass' AND "sender_user_id" IS NOT NULL
    AND NOT "automatic"
    AND NOT ("sender_flags" && ARRAY['stale_date', 'date_out_of_range', 'message_id_reused', 'already_filed',
                                     'not_addressed_to_project']::text[]))) NOT VALID;
--> statement-breakpoint
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
  mail_reason text;
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
    SELECT sender_class, sender_flags, sender_user_id, sender_reason, raw_scan_status
      INTO mail_class, mail_flags, mail_sender, mail_reason, raw_scan
      FROM inbound_mails
     WHERE id = NEW.mail_id AND project_id = NEW.project_id AND organization_id = NEW.organization_id;
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
ALTER TABLE "inbound_mail_addresses" ADD COLUMN IF NOT EXISTS "forwarded_from" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbound_mail_addresses" DROP CONSTRAINT IF EXISTS "inbound_mail_addresses_forwarded_from_shape";
--> statement-breakpoint
ALTER TABLE "inbound_mail_addresses" ADD CONSTRAINT "inbound_mail_addresses_forwarded_from_shape"
  CHECK (cardinality("forwarded_from") <= 10
     AND NOT ('' = ANY ("forwarded_from"))
     AND "forwarded_from"::text = lower("forwarded_from"::text));
--> statement-breakpoint
COMMENT ON COLUMN "inbound_mail_addresses"."forwarded_from" IS
  'The office''s existing addresses for this project that forward to this address by a rule (at most ten, lowercase): a signed To or Cc naming one counts as addressed to the project. Carried to the new address on a rotation (migration 0250).';
