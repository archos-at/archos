import type { ScreeningDetector } from '@/lib/upload-screening/policy'

export const PERSON_USER_ID_PATTERN = /^user_[0-9A-Z]{26}$/

export function isPersonUserId(value: string): boolean {
  return PERSON_USER_ID_PATTERN.test(value)
}

export const INBOUND_MAIL_ADDRESS_REVOKED_REASONS = ['rotated', 'switched_off'] as const
export type InboundMailAddressRevokedReason = (typeof INBOUND_MAIL_ADDRESS_REVOKED_REASONS)[number]

export const INBOUND_MAIL_CAP_NOTICES = ['nearly_full', 'full'] as const
export type InboundMailCapNotice = (typeof INBOUND_MAIL_CAP_NOTICES)[number]

export const INBOUND_MAIL_STATUSES = ['receiving', 'received', 'waiting', 'settled', 'dropped'] as const
export type InboundMailStatus = (typeof INBOUND_MAIL_STATUSES)[number]

export const DROPPED_REASONS = ['auto_reply', 'delivery_report', 'self_loop'] as const
export type DroppedReason = (typeof DROPPED_REASONS)[number]

export const ORIGINAL_MESSAGE_SOURCES = ['attachment', 'inline'] as const
export type OriginalMessageSource = (typeof ORIGINAL_MESSAGE_SOURCES)[number]

export const SENDER_TRUSTS = [
  'member_verified',
  'member_unverified',
  'external_verified',
  'external_unverified',
  'not_checked',
] as const
export type SenderTrust = (typeof SENDER_TRUSTS)[number]

export const INBOUND_SENDER_TRUSTS = [
  'member_verified',
  'member_unverified',
  'external_verified',
  'external_unverified',
] as const satisfies readonly SenderTrust[]
export type InboundSenderTrust = (typeof INBOUND_SENDER_TRUSTS)[number]

export const VERIFIED_SENDER_TRUSTS: readonly SenderTrust[] = ['member_verified', 'external_verified']

export const SENDER_REASONS = [
  'dkim_pass',
  'header_malformed',
  'header_duplicate',
  'from_count',
  'from_not_ascii',
  'dkim_too_many',
  'dkim_body_length',
  'dkim_testing',
  'dkim_expired',
  'dkim_unsigned_fields',
  'dkim_weak_algorithm',
  'dkim_short_key',
  'dkim_temperror',
  'dkim_fail',
  'dkim_policy',
  'dkim_permerror',
  'dkim_unaligned',
  'dkim_none',
  'verifier_timeout',
  'verifier_error',
] as const
export type SenderReason = (typeof SENDER_REASONS)[number]

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

export const SENDER_RISK_LEVELS = ['none', 'caution', 'impersonation'] as const
export type SenderRiskLevel = (typeof SENDER_RISK_LEVELS)[number]

export const IMPERSONATION_BASES = ['rejected_signature', 'member_name'] as const
export type ImpersonationBasis = (typeof IMPERSONATION_BASES)[number]

export const MALWARE_SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const
export type MalwareScanStatus = (typeof MALWARE_SCAN_STATUSES)[number]

export const NOT_STAGED_REASONS = [
  'embedded',
  'signature',
  'tnef',
  'encrypted',
  'calendar',
  'empty',
  'archive',
  'size',
  'limit',
] as const
export type NotStagedReason = (typeof NOT_STAGED_REASONS)[number]

export interface InboundMailNotStaged {
  filename: string
  reason: NotStagedReason
}

export type InboundMailIgnoredCounts = Partial<Record<NotStagedReason, number>>

export interface MailParticipant {
  role: 'from' | 'reply_to' | 'to' | 'cc'
  name: string | null
  address: string
}

export const INBOUND_MAIL_PART_KINDS = ['message', 'attachment'] as const
export type InboundMailPartKind = (typeof INBOUND_MAIL_PART_KINDS)[number]

export const INBOUND_MAIL_PART_STATES = ['waiting', 'filing', 'filed', 'dismissed', 'expired'] as const
export type InboundMailPartState = (typeof INBOUND_MAIL_PART_STATES)[number]

export const INBOUND_MAIL_PART_SCAN_STATUSES = [...MALWARE_SCAN_STATUSES, 'not_applicable'] as const
export type InboundMailPartScanStatus = (typeof INBOUND_MAIL_PART_SCAN_STATUSES)[number]

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

export type InboundMailContentFinding = ScreeningDetector | 'term'

export const INBOUND_MAIL_SENDER_CLASSES = ['verified_writer', 'unverified_writer', 'office_member', 'external'] as const
export type InboundMailSenderClass = (typeof INBOUND_MAIL_SENDER_CLASSES)[number]

export const INBOUND_MAIL_DECISION_ACTIONS = ['file', 'dismiss', 'restore'] as const
export type InboundMailDecisionAction = (typeof INBOUND_MAIL_DECISION_ACTIONS)[number]

export const INBOUND_MAIL_DECISION_VIAS = ['app', 'agent', 'agent_proposal', 'follow', 'sender'] as const
export type InboundMailDecisionVia = (typeof INBOUND_MAIL_DECISION_VIAS)[number]

export const INBOUND_MAIL_THREAD_ACTIONS = ['append', 'create'] as const
export type InboundMailThreadAction = (typeof INBOUND_MAIL_THREAD_ACTIONS)[number]

export const INBOUND_MAIL_MESSAGE_TEXTS = ['masked', 'full'] as const
export type InboundMailMessageText = (typeof INBOUND_MAIL_MESSAGE_TEXTS)[number]

export const INBOUND_MAIL_WAIT_DAYS = 30
export const INBOUND_MAIL_EXTERNAL_WAIT_DAYS = 14
export const INBOUND_MAIL_RESTORE_DAYS = 7
export const INBOUND_MAIL_EXPIRING_NOTICE_DAYS = 5
export const MAIL_THREAD_FOLLOW_EXPIRING_NOTICE_DAYS = 5
export const INBOUND_MAIL_STALE_DATE_DAYS = 7
export const INBOUND_MAIL_ADDRESS_STATS_DAYS = 30

export const INBOUND_MAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024

export const INBOUND_MAIL_MAX_ATTACHMENT_BYTES = Math.floor((INBOUND_MAIL_MAX_MESSAGE_BYTES * 3) / 4)

export const INBOUND_MAIL_STAGING_SEGMENT = '_inbound-mail'
export const MAIL_ORIGINALS_SEGMENT = '_mail-originals'

interface ProjectObjectOwner {
  organizationId: string
  projectId: string
}

export function inboundMailStagingPrefix(owner: ProjectObjectOwner, mailId: string): string {
  return `org/${owner.organizationId}/project/${owner.projectId}/${INBOUND_MAIL_STAGING_SEGMENT}/${mailId}/`
}

export function inboundMailStagingKey(
  owner: ProjectObjectOwner,
  mailId: string,
  object: 'raw.eml' | 'read.json' | { position: number }
): string {
  const name = typeof object === 'string' ? object : String(object.position)
  return `${inboundMailStagingPrefix(owner, mailId)}${name}`
}

export function mailOriginalStorageKey(owner: ProjectObjectOwner, entryId: string): string {
  return `org/${owner.organizationId}/project/${owner.projectId}/${MAIL_ORIGINALS_SEGMENT}/${entryId}.eml`
}
