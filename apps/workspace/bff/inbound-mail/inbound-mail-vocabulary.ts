/**
 * The vocabulary of the E-Mail-Eingang (ADR-0137, migration 0194), free of
 * drizzle and of zod.
 *
 * Every tuple here is also a CHECK in `migrations/0194_inbound_mail.sql`: the
 * database refuses a value this file does not list, so a new value is a change
 * to both, in one migration. The drizzle schema (`db/schema/inbound-mail.ts`),
 * the wire module, the jobs and the browser import the tuples from here, so a
 * client component never drags the schema into its bundle (the
 * `projects/memory-vocabulary.ts` arrangement, held by `wire-modules.spec.ts`).
 *
 * Pure: no database, no `server-only`, no service.
 */

import type { ScreeningDetector } from '@/lib/upload-screening/policy'

// ------------------------------------------------------------ people

/**
 * The shape of a WorkOS user id (`user_` and a 26-character ULID). Who decides
 * about a mail, who files a message and who follows a thread is always a
 * person: the database refuses `system:*` actors and every other shape in those
 * columns (`inbound_mail_decisions.decided_by`, RT-S7), so no code path can
 * file mail in the name of a job.
 */
export const PERSON_USER_ID_PATTERN = /^user_[0-9A-Z]{26}$/

/** Whether `value` is a person's user id, as the database checks it. */
export function isPersonUserId(value: string): boolean {
  return PERSON_USER_ID_PATTERN.test(value)
}

// ------------------------------------------------------------ addresses

/** Why an address stopped resolving: replaced by a new one, or the project takes no mail. */
export const INBOUND_MAIL_ADDRESS_REVOKED_REASONS = ['rotated', 'switched_off'] as const
export type InboundMailAddressRevokedReason = (typeof INBOUND_MAIL_ADDRESS_REVOKED_REASONS)[number]

/**
 * What an address's managers were last told about the staged-bytes caps (D18):
 * `nearly_full` at 80% of the address's or its organization's cap, `full` at
 * 100% (the webhook then answers 429). Ordered: a rise is told, a fall is not.
 */
export const INBOUND_MAIL_CAP_NOTICES = ['nearly_full', 'full'] as const
export type InboundMailCapNotice = (typeof INBOUND_MAIL_CAP_NOTICES)[number]

// ------------------------------------------------------------ mails

/**
 * Where one delivery stands.
 *
 * - `receiving`: the row exists and the raw message is being streamed to staging.
 * - `received`: staged whole, the receive job has not read it yet.
 * - `waiting`: a person's turn (only after the whole message was scanned).
 * - `settled`: no part waits or is being filed; the row is scrubbed to ids.
 * - `dropped`: an auto-reply, a delivery report or a loop; counted, never shown.
 */
export const INBOUND_MAIL_STATUSES = ['receiving', 'received', 'waiting', 'settled', 'dropped'] as const
export type InboundMailStatus = (typeof INBOUND_MAIL_STATUSES)[number]

/** Why a mail was accepted and then dropped unseen (`./automatic-mail`, `dropped_reason`). A forward is never dropped for its original (migration 0196). */
export const DROPPED_REASONS = ['auto_reply', 'delivery_report', 'self_loop'] as const
export type DroppedReason = (typeof DROPPED_REASONS)[number]

/** Where a forward's original was read (migration 0196): an attached message, or the header block of an inline forward. */
export const ORIGINAL_MESSAGE_SOURCES = ['attachment', 'inline'] as const
export type OriginalMessageSource = (typeof ORIGINAL_MESSAGE_SOURCES)[number]

/**
 * A sender's trust (DECISION D4): an aligned DKIM pass or not, a directory
 * member or not. `not_checked` is an archive entry's (D33): the Outlook
 * import cannot verify anything, so it claims nothing.
 */
export const SENDER_TRUSTS = [
  'member_verified',
  'member_unverified',
  'external_verified',
  'external_unverified',
  'not_checked',
] as const
export type SenderTrust = (typeof SENDER_TRUSTS)[number]

/**
 * Who a mail at the project's address is from, as far as the bytes and DNS can
 * tell (`./sender-auth`, `inbound_mails.sender_trust`). `verified` is an
 * aligned DKIM pass that also meets the hygiene rules; `member` is a From
 * address equal to a directory member's address. DKIM proves a domain, never a
 * person, which is why no label claims more than the domain. Every received
 * mail was checked, so `not_checked` is not among them.
 */
export const INBOUND_SENDER_TRUSTS = [
  'member_verified',
  'member_unverified',
  'external_verified',
  'external_unverified',
] as const satisfies readonly SenderTrust[]
export type InboundSenderTrust = (typeof INBOUND_SENDER_TRUSTS)[number]

/** The trusts that are an aligned DKIM pass. */
export const VERIFIED_SENDER_TRUSTS: readonly SenderTrust[] = ['member_verified', 'external_verified']

/**
 * Why the sender is or is not verified, one code per mail (`sender_reason`).
 * `dkim_pass` is the only verified one (the database holds the pair). The
 * others are ordered as `./sender-auth` ranks them when several signatures
 * disagree: the most specific explanation first.
 */
export const SENDER_REASONS = [
  'dkim_pass',
  // The raw header block (checked before any signature, against parser differentials).
  'header_malformed',
  'header_duplicate',
  'from_count',
  'from_not_ascii',
  'dkim_too_many',
  // An aligned signature that verified but breaks a hygiene rule.
  'dkim_body_length',
  'dkim_testing',
  'dkim_expired',
  'dkim_unsigned_fields',
  'dkim_weak_algorithm',
  'dkim_short_key',
  // An aligned signature that did not verify.
  'dkim_temperror',
  'dkim_fail',
  'dkim_policy',
  'dkim_permerror',
  // No aligned signature at all.
  'dkim_unaligned',
  'dkim_none',
  // The verifier itself.
  'verifier_timeout',
  'verifier_error',
] as const
export type SenderReason = (typeof SENDER_REASONS)[number]

/**
 * Facts about one mail's sender that shape defaults (`sender_flags`, D4, D11,
 * D33). Each one but `relaxed_alignment` disables pre-selection and
 * following. The first four, `claims_member_name` and `relaxed_alignment` come
 * from `./sender-auth`; `message_id_reused` and `already_filed` from the
 * receive job's Message-ID lookup.
 *
 * - `not_addressed_to_project`: a verified mail whose signed To and Cc do not
 *   name the project's address: a member's mail to someone else, replayed.
 * - `bcc_own`: set TOGETHER with `not_addressed_to_project` when the mail is
 *   `member_verified` with a signed Date within a day of receipt: the
 *   member's own Bcc copy (the database holds the pairing). The pair errs
 *   safe: whoever forgets the exception asks for one acknowledgement too many
 *   and never offers a follow it should not. It is a label, never evidence:
 *   a recipient re-sending the member's signed mail within the day carries it
 *   too, so it never makes a mail a verified writer's.
 * - `stale_date`: the signed Date is more than seven days before receipt.
 * - `date_out_of_range`: the Date is missing or outside the clamp window, and
 *   the receipt time stands in for it.
 * - `message_id_reused`: the project already received this Message-ID.
 * - `already_filed`: and its own text is the same, so it is in a Verlauf already.
 * - `claims_member_name`: the From display name is a directory member's name,
 *   but the address is not that member's (`./sender-risk`,
 *   `claimsMemberName`): „Miriam Huber <miriam.huber@mail.example>“. The
 *   classic payment-diversion mail. Only on an `external_*` mail (the database
 *   holds the pairing): a member's own address is a `member_*` mail.
 * - `relaxed_alignment`: a verified mail whose admitting signature's `d=` is
 *   not the From domain itself but a parent or a subdomain of it (DMARC's
 *   relaxed mode, RFC 7489 §3.1.1): `news.buero.at` signing for
 *   `miriam@buero.at`, a key a newsletter service may hold. The label stays
 *   verified; a direct filing needs strict alignment (`./sender-class`, the
 *   database's `inbound_mails_verified_writer_evidence`).
 * - `sender_unchecked`: the receive job could not ask WorkOS who the sender
 *   is to the project (the directory or the write check did not answer for
 *   its whole fault budget, `./receive-faults`). Never a verified writer's,
 *   and never an outsider's 14 days: it waits the full 30 (migration 0197
 *   holds both), and the E-Mail-Eingang says it could not be checked.
 */
export const SENDER_FLAGS = [
  'not_addressed_to_project',
  'bcc_own',
  'stale_date',
  'date_out_of_range',
  'message_id_reused',
  'already_filed',
  'claims_member_name',
  'relaxed_alignment',
  'sender_unchecked',
] as const
export type SenderFlag = (typeof SENDER_FLAGS)[number]

/**
 * How much a held mail's sender asks of the person before anything of it is
 * filed (`./sender-risk`, `riskLevel` on the views). Not stored: derived from
 * the sender's trust, reason and flags on every read.
 *
 * - `impersonation`: the mail may be someone pretending (a signature the From
 *   domain refuses, or a member's name on another address). Nothing of it is
 *   pre-selected, the agent suggests nothing, and filing needs `acknowledgeSender`.
 * - `caution`: filing needs `acknowledgeSender` (a member's address without
 *   its domain's signature, a mail addressed to others, a stale Date).
 * - `none`: nothing to accept.
 */
export const SENDER_RISK_LEVELS = ['none', 'caution', 'impersonation'] as const
export type SenderRiskLevel = (typeof SENDER_RISK_LEVELS)[number]

/**
 * Why a mail reads as an impersonation: the From domain's own signature
 * failed, or its policy refused it (`rejected_signature`); or the display name
 * is a member's while the address is not theirs (`member_name`).
 */
export const IMPERSONATION_BASES = ['rejected_signature', 'member_name'] as const
export type ImpersonationBasis = (typeof IMPERSONATION_BASES)[number]

/**
 * A malware scan's outcome (ADR-0152, `lib/malware-scan`). Only `clean` lets a
 * part be filed or a file be served; `failed` is scanned again.
 */
export const MALWARE_SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const
export type MalwareScanStatus = (typeof MALWARE_SCAN_STATUSES)[number]

/**
 * Why a MIME part was not staged as a part a person decides on (`./mime`).
 * Every one of them is still in the original `.eml`; once the mail settles
 * they are counted by reason.
 */
export const NOT_STAGED_REASONS = [
  /** Part of the message's own layout: a `cid:` image, an auto-named pasted image, a tracking pixel. */
  'embedded',
  /** An S/MIME or PGP signature. */
  'signature',
  /** `winmail.dat`: Outlook's own container, not a file anybody sent. */
  'tnef',
  /** S/MIME or PGP encryption: nothing in it is readable here. */
  'encrypted',
  /** A calendar invitation; the Python reader renders it into the text. */
  'calendar',
  /** No bytes. */
  'empty',
  /** An archive the office does not accept as a file; it is never expanded. */
  'archive',
  /** Larger than one part may be. */
  'size',
  /** Past the number of parts one mail may stage, or a forward nested too deep. */
  'limit',
] as const
export type NotStagedReason = (typeof NOT_STAGED_REASONS)[number]

/** One file of the mail that was not staged, while the mail waits (`inbound_mails.not_staged`). */
export interface InboundMailNotStaged {
  filename: string
  reason: NotStagedReason
}

/** What was left out, by reason, with no names (`inbound_mails.ignored`). */
export type InboundMailIgnoredCounts = Partial<Record<NotStagedReason, number>>

/**
 * One address of a mail (`inbound_mails.participants`, `mail_thread_entries.participants`).
 * The project addresses are not participants: the receive job takes them out (B8).
 */
export interface MailParticipant {
  role: 'from' | 'reply_to' | 'to' | 'cc'
  name: string | null
  address: string
}

// ------------------------------------------------------------ parts

/** The mail's own text, or one attached file. */
export const INBOUND_MAIL_PART_KINDS = ['message', 'attachment'] as const
export type InboundMailPartKind = (typeof INBOUND_MAIL_PART_KINDS)[number]

/**
 * Where a part stands.
 *
 * - `waiting`: a person's turn.
 * - `filing`: a person said file; the filing job holds the claim.
 * - `filed`: a document holds it (until somebody deletes that document).
 * - `dismissed`: a person said no; restorable for seven days.
 * - `expired`: nobody decided within the window; restorable for seven days.
 */
export const INBOUND_MAIL_PART_STATES = ['waiting', 'filing', 'filed', 'dismissed', 'expired'] as const
export type InboundMailPartState = (typeof INBOUND_MAIL_PART_STATES)[number]

/** A part's scan: an attachment's outcome, or `not_applicable` for the mail's text (its raw message is scanned whole). */
export const INBOUND_MAIL_PART_SCAN_STATUSES = [...MALWARE_SCAN_STATUSES, 'not_applicable'] as const
export type InboundMailPartScanStatus = (typeof INBOUND_MAIL_PART_SCAN_STATUSES)[number]

/**
 * Facts about one attachment (`risk_flags`, D10, D11, D17). `./mime` sets
 * `macro`, `type_mismatch`, `encrypted`, `forwarded_inner` and
 * `type_not_accepted`; the receive job and the decision set the rest.
 * `macro`, `type_mismatch` and `unverified_thread` need the part in
 * `acknowledgeRisk`; `name_stop` needs `screeningRelease: 'name'`.
 */
export const PART_RISK_FLAGS = [
  'macro',
  'type_mismatch',
  'encrypted',
  'name_stop',
  'duplicate_of',
  'forwarded_inner',
  'unreadable',
  'unverified_thread',
  'type_not_accepted',
] as const
export type PartRiskFlag = (typeof PART_RISK_FLAGS)[number]

/** Why the last filing attempt made no document; the part waits again and the person is told. */
export const INBOUND_MAIL_FILING_FAILURES = [
  'screened',
  'type',
  'size',
  'quota',
  'access',
  'name_taken',
  'unreadable',
  'digest_mismatch',
  'unavailable',
  'thread_document_gone',
  'scan_not_clean',
  'project_closed',
  'type_not_accepted',
] as const
export type InboundMailFilingFailure = (typeof INBOUND_MAIL_FILING_FAILURES)[number]

/** The content-check findings in the mail's own text, by kind (D13). */
export type InboundMailContentFinding = ScreeningDetector | 'term'

// ------------------------------------------------------------ the sender rule

/**
 * Who the sender is to the project, judged once when the mail is held and
 * frozen after (`inbound_mails.sender_class`, migration 0195; ADR-0137's
 * amendment of 2026-11-03):
 *
 * - `verified_writer`: DKIM passed aligned with the From domain, the From is a
 *   member who holds `project:documents:write`, the signed To or Cc names the
 *   project, no replay or date flag, not automatic. Filed directly, as that
 *   member (`via = 'sender'`).
 * - `unverified_writer`: the From is such a member, but the signature failed,
 *   is missing, does not name the project (a Bcc copy included), or carries a
 *   replay or date flag. Only that member files it
 *   („Haben Sie diese E-Mail gesendet?“, `acknowledgeSender`); any writer dismisses it.
 * - `office_member`: the From is a member without write rights in the project.
 * - `external`: the From is nobody in the office; it waits
 *   {@link INBOUND_MAIL_EXTERNAL_WAIT_DAYS} days and is then discarded.
 */
export const INBOUND_MAIL_SENDER_CLASSES = ['verified_writer', 'unverified_writer', 'office_member', 'external'] as const
export type InboundMailSenderClass = (typeof INBOUND_MAIL_SENDER_CLASSES)[number]

// ------------------------------------------------------------ decisions

/** What a person decided about a part. */
export const INBOUND_MAIL_DECISION_ACTIONS = ['file', 'dismiss', 'restore'] as const
export type InboundMailDecisionAction = (typeof INBOUND_MAIL_DECISION_ACTIONS)[number]

/**
 * How the decision reached us: in the app, from an outside agent acting as the
 * person, through an agent's operation card the person confirmed, as the
 * person's standing decision to follow a thread (D31), or as a verified
 * writer's own mail filed directly (`sender`, migration 0195: the decider is
 * the mail's sender, whose signature and write right the hold recorded). The
 * decider is a person in every case.
 */
export const INBOUND_MAIL_DECISION_VIAS = ['app', 'agent', 'agent_proposal', 'follow', 'sender'] as const
export type InboundMailDecisionVia = (typeof INBOUND_MAIL_DECISION_VIAS)[number]

/** Where a filed message goes: into an existing thread as its next Fassung, or a new thread. */
export const INBOUND_MAIL_THREAD_ACTIONS = ['append', 'create'] as const
export type InboundMailThreadAction = (typeof INBOUND_MAIL_THREAD_ACTIONS)[number]

/** Whether a filed message's text is masked where the content check found something (D13). */
export const INBOUND_MAIL_MESSAGE_TEXTS = ['masked', 'full'] as const
export type InboundMailMessageText = (typeof INBOUND_MAIL_MESSAGE_TEXTS)[number]

// ------------------------------------------------------------ windows

/** How long a mail waits for a person (D8). Fixed on the row at receipt. */
export const INBOUND_MAIL_WAIT_DAYS = 30
/**
 * How long an outsider's mail (`sender_class = 'external'`) waits, from receipt
 * (ADR-0137, amendment of 2026-11-03). It is set at the hold, once the sender
 * is known, and an outsider's mail that runs out is discarded on the next sweep:
 * no restore window after expiry.
 */
export const INBOUND_MAIL_EXTERNAL_WAIT_DAYS = 14
/** How long a dismissed or expired part can be restored (D8); an outsider's expired mail is the exception. */
export const INBOUND_MAIL_RESTORE_DAYS = 7
/** How long before its end a held mail's people are told it expires (sweep 4, D8). */
export const INBOUND_MAIL_EXPIRING_NOTICE_DAYS = 5
/** How long before a follow ends its follower is told (sweep 12). */
export const MAIL_THREAD_FOLLOW_EXPIRING_NOTICE_DAYS = 5
/** A verified mail whose signed Date is more than this many days before receipt is `stale_date` (`./sender-auth`). */
export const INBOUND_MAIL_STALE_DATE_DAYS = 7
/**
 * The window the address's figures look back over: the automatic mail dropped
 * unseen, and the share of the office's own mail its domain signed
 * (`./repository`, `droppedLast30Days`, `ownDomainVerifiedShare`).
 */
export const INBOUND_MAIL_ADDRESS_STATS_DAYS = 30

// ------------------------------------------------------------ size

/**
 * The largest mail a project address takes, as the sender's server sends it
 * (headers, text and every attachment, base64-encoded): 25 MiB, the most
 * Cloudflare Email Routing hands the Worker (ADR-0138). The webhook's bound
 * (`MAX_RAW_MESSAGE_BYTES` in `./contract`, 26 MiB) and Envoy's (27 MiB) sit
 * above it, so this is the limit a person meets; the UI states it beside the
 * address and offers the upload for anything larger.
 */
export const INBOUND_MAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024

/**
 * How much of {@link INBOUND_MAIL_MAX_MESSAGE_BYTES} attachments can fill:
 * base64 sends three bytes as four, so about three quarters of it. What the UI
 * tells a person who wants to know whether their file fits.
 */
export const INBOUND_MAIL_MAX_ATTACHMENT_BYTES = Math.floor((INBOUND_MAIL_MAX_MESSAGE_BYTES * 3) / 4)

// ------------------------------------------------------------ object keys

/**
 * The reserved project-prefix segment a mail is staged under, and the one a
 * filed message's original is kept under (D6). `lib/s3.ts` reserves both, so
 * no person's folder can take them, and the migration's CHECKs hold every key
 * a row names to exactly the shapes below.
 */
export const INBOUND_MAIL_STAGING_SEGMENT = '_inbound-mail'
export const MAIL_ORIGINALS_SEGMENT = '_mail-originals'

interface ProjectObjectOwner {
  organizationId: string
  projectId: string
}

/** The staging prefix of one mail: `org/<org>/project/<project>/_inbound-mail/<mailId>/`. */
export function inboundMailStagingPrefix(owner: ProjectObjectOwner, mailId: string): string {
  return `org/${owner.organizationId}/project/${owner.projectId}/${INBOUND_MAIL_STAGING_SEGMENT}/${mailId}/`
}

/**
 * The key of one staged object of a mail: the raw message, what the reader
 * made of it, or an attachment part by its position.
 */
export function inboundMailStagingKey(
  owner: ProjectObjectOwner,
  mailId: string,
  object: 'raw.eml' | 'read.json' | { position: number }
): string {
  const name = typeof object === 'string' ? object : String(object.position)
  return `${inboundMailStagingPrefix(owner, mailId)}${name}`
}

/** The key a filed message's original is kept under: `org/<org>/project/<project>/_mail-originals/<entryId>.eml`. */
export function mailOriginalStorageKey(owner: ProjectObjectOwner, entryId: string): string {
  return `org/${owner.organizationId}/project/${owner.projectId}/${MAIL_ORIGINALS_SEGMENT}/${entryId}.eml`
}
