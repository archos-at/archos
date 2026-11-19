import type { Locale } from '@/i18n/config'
import type { ScreeningDetector } from '@/lib/upload-screening/policy'
import type { MailParticipant } from '@/lib/inbound-mail/inbound-mail-vocabulary'

export const MAIL_THREAD_LOCALES = ['de', 'en'] as const satisfies readonly Locale[]
export type MailThreadLocale = (typeof MAIL_THREAD_LOCALES)[number]

export const MAIL_THREAD_MAX_ENTRIES = 200
export const MAIL_THREAD_MAX_RENDERED_BYTES = 2 * 1024 * 1024

export const THREAD_MATCH_STRENGTHS = ['reference', 'thread_index', 'reference_subject_changed', 'subject'] as const
export type ThreadMatchStrength = (typeof THREAD_MATCH_STRENGTHS)[number]

export const THREAD_MATCH_HEADERS = ['in-reply-to', 'references', 'thread-index', 'subject'] as const
export type ThreadMatchHeader = (typeof THREAD_MATCH_HEADERS)[number]

export interface ThreadMatch {
  threadId: string
  strength: ThreadMatchStrength
  headers: ThreadMatchHeader[]
}

export const MAIL_THREAD_MESSAGE_ID_STATES = ['received', 'referenced'] as const
export type MailThreadMessageIdState = (typeof MAIL_THREAD_MESSAGE_ID_STATES)[number]

export const MAIL_THREAD_ENTRY_SOURCES = ['inbound', 'archive'] as const
export type MailThreadEntrySource = (typeof MAIL_THREAD_ENTRY_SOURCES)[number]

export const MAIL_THREAD_FILED_VIA = ['app', 'agent', 'agent_proposal', 'follow', 'archive_import', 'sender'] as const
export type MailThreadFiledVia = (typeof MAIL_THREAD_FILED_VIA)[number]

export type MailThreadParticipant = MailParticipant

export interface MailThreadMaskedSpan {
  kind: ScreeningDetector | 'term'
  start: number
  end: number
}

export interface MailThreadQuote {
  text: string
}

export interface MailThreadCalendarEvent {
  method: string | null
  summary: string | null
  start: string | null
  end: string | null
  allDay: boolean
  location: string | null
  status: string | null
}

export const MAIL_THREAD_ATTACHMENT_DISPOSITIONS = ['filed', 'already_present', 'not_filed'] as const
export type MailThreadAttachmentDisposition = (typeof MAIL_THREAD_ATTACHMENT_DISPOSITIONS)[number]

export const MAIL_THREAD_ATTACHMENT_NOT_FILED_REASONS = [
  'pending',
  'dismissed',
  'expired',
  'infected',
  'scan_failed',
  'type_not_accepted',
  'encrypted',
  'archive',
  'size',
  'limit',
  'empty',
  'screened',
  'access',
  'name_taken',
  'unreadable',
] as const
export type MailThreadAttachmentNotFiledReason = (typeof MAIL_THREAD_ATTACHMENT_NOT_FILED_REASONS)[number]

export interface MailThreadSectionAttachment {
  name: string | null
  folderPath: string | null
}

export const MAIL_THREAD_ENTRY_MAX_TEXT_BYTES = 512 * 1024

export const MAIL_THREAD_FOLLOW_END_REASONS = [
  'unfollowed',
  'expired',
  'access_lost',
  'address_rotated',
  'detached',
  'document_gone',
  'revoked_by_manager',
  'project_closed',
  'thread_full',
] as const
export type MailThreadFollowEndReason = (typeof MAIL_THREAD_FOLLOW_END_REASONS)[number]

export const MAIL_THREAD_FOLLOW_PERSON_END_REASONS = [
  'unfollowed',
  'revoked_by_manager',
] as const satisfies readonly MailThreadFollowEndReason[]

export const MAIL_THREAD_FOLLOW_DEFAULT_DAYS = 60

export const MAIL_THREAD_FOLLOW_DEFAULT_DAILY_CAP = 20
export const MAIL_THREAD_FOLLOW_MAX_DAILY_CAP = 50

export const MAIL_THREAD_FOLLOW_PROJECT_DAILY_CAP = 100

export const MAIL_THREAD_WAITING_REASONS = ['sender_not_verified', 'attachment_left', 'before_follow', 'needs_check'] as const
export type MailThreadWaitingReason = (typeof MAIL_THREAD_WAITING_REASONS)[number]
