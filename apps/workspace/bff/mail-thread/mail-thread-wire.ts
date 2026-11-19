import { z } from 'zod'
import { SCREENING_DETECTORS } from '@/lib/upload-screening/policy'
import type { SenderTrust } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'
import {
  THREAD_MATCH_HEADERS,
  THREAD_MATCH_STRENGTHS,
  type MailThreadAttachmentDisposition,
  type MailThreadAttachmentNotFiledReason,
  type MailThreadCalendarEvent,
  type MailThreadEntrySource,
  type MailThreadFiledVia,
  type MailThreadMaskedSpan,
  type MailThreadParticipant,
  type MailThreadQuote,
  type ThreadMatch,
} from './mail-thread-vocabulary'

const uuid = z.string().uuid()
const isoDateTime = z.string().datetime({ offset: true })

export {
  MAIL_THREAD_ATTACHMENT_DISPOSITIONS,
  MAIL_THREAD_ATTACHMENT_NOT_FILED_REASONS,
  MAIL_THREAD_ENTRY_SOURCES,
  MAIL_THREAD_FILED_VIA,
  MAIL_THREAD_FOLLOW_END_REASONS,
  MAIL_THREAD_FOLLOW_DEFAULT_DAYS,
  MAIL_THREAD_FOLLOW_MAX_DAYS,
  MAIL_THREAD_MAX_ENTRIES,
  MAIL_THREAD_MAX_RENDERED_BYTES,
  type MailThreadAttachmentDisposition,
  type MailThreadAttachmentNotFiledReason,
  type MailThreadCalendarEvent,
  type MailThreadEntrySource,
  type MailThreadFiledVia,
  type MailThreadFollowEndReason,
  type MailThreadMaskedSpan,
  type MailThreadParticipant,
  type MailThreadQuote,
  type MailThreadSectionAttachment,
} from './mail-thread-vocabulary'
import { MAIL_THREAD_FOLLOW_DEFAULT_DAYS, MAIL_THREAD_FOLLOW_MAX_DAYS } from './mail-thread-vocabulary'

export const MAIL_THREAD_LIST_LIMIT = 50

export const mailThreadParticipantSchema = z.object({
  role: z.enum(['from', 'reply_to', 'to', 'cc']),
  name: z.string().max(300).nullable(),
  address: z.string().min(1).max(320),
})
mailThreadParticipantSchema satisfies z.ZodType<MailThreadParticipant>

export const mailThreadMaskedSpanSchema = z
  .object({
    kind: z.enum([...SCREENING_DETECTORS, 'term']),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((span) => span.end > span.start, { message: 'A masked span ends after it starts' })
mailThreadMaskedSpanSchema satisfies z.ZodType<MailThreadMaskedSpan>

export const mailThreadQuoteSchema = z.object({ text: z.string().max(524_288) })
mailThreadQuoteSchema satisfies z.ZodType<MailThreadQuote>

export const mailThreadCalendarEventSchema = z.object({
  method: z.string().max(40).nullable(),
  summary: z.string().max(500).nullable(),
  start: isoDateTime.nullable(),
  end: isoDateTime.nullable(),
  allDay: z.boolean(),
  location: z.string().max(500).nullable(),
  status: z.string().max(40).nullable(),
})
mailThreadCalendarEventSchema satisfies z.ZodType<MailThreadCalendarEvent>

export const threadMatchSchema = z.object({
  threadId: uuid,
  strength: z.enum(THREAD_MATCH_STRENGTHS),
  headers: z.array(z.enum(THREAD_MATCH_HEADERS)).max(THREAD_MATCH_HEADERS.length),
})
threadMatchSchema satisfies z.ZodType<ThreadMatch>
export const threadMatchListSchema = z.array(threadMatchSchema).max(50)

export const mailThreadListQuerySchema = z.object({
  documentId: uuid.optional().describe('Finds this document’s thread.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAIL_THREAD_LIST_LIMIT)
    .default(MAIL_THREAD_LIST_LIMIT)
    .describe(`Default and max ${MAIL_THREAD_LIST_LIMIT}.`),
  cursor: z.string().min(1).max(200).optional().describe('The previous `nextCursor`.'),
})
export type MailThreadListQuery = z.infer<typeof mailThreadListQuerySchema>

export const mailThreadFollowBodySchema = z
  .object({
    days: z
      .number()
      .int()
      .min(1)
      .max(MAIL_THREAD_FOLLOW_MAX_DAYS)
      .optional()
      .describe(
        `Days it holds (default ${MAIL_THREAD_FOLLOW_DEFAULT_DAYS}, at most ${MAIL_THREAD_FOLLOW_MAX_DAYS} from its start).`
      ),
  })
  .strict()
export type MailThreadFollowBody = z.infer<typeof mailThreadFollowBodySchema>

export const mailThreadUnfollowQuerySchema = z.object({
  userId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Whose follow to end; your own when omitted. Ending someone else's needs project:manage."),
})
export type MailThreadUnfollowQuery = z.infer<typeof mailThreadUnfollowQuerySchema>

const detachTargetSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('append'), mailThreadId: uuid.describe('From mail-thread-list.') }).strict(),
  z
    .object({
      action: z.literal('create'),
      folderId: uuid.optional(),
      newFolderPath: z.string().min(1).max(1000).optional(),
      name: z.string().min(1).max(240),
      screeningRelease: z.literal('name').optional(),
    })
    .strict(),
])

export const MAIL_THREAD_REFUSALS = [
  'last_entry',
  'busy',
  'target_unknown',
  'thread_full',
  'name_stop',
  'name_taken',
  'upload_refused',
  'gone',
  'original_not_clean',
] as const
export type MailThreadRefusal = (typeof MAIL_THREAD_REFUSALS)[number]

export const mailThreadEntryDetachBodySchema = z
  .object({ target: detachTargetSchema })
  .strict()
export type MailThreadEntryDetachBody = z.infer<typeof mailThreadEntryDetachBodySchema>

export interface MailThreadFollowView {
  id: string
  userId: string
  createdAt: string
  expiresAt: string
  renewedAt: string | null
  dailyCap: number
}

export interface MailThreadFollowResultView {
  follow: MailThreadFollowView
  renewed: boolean
}

export interface MailThreadUnfollowResultView {
  endedFollowId: string | null
}

export interface MailThreadAttachmentView {
  position: number
  filename: string | null
  disposition: MailThreadAttachmentDisposition
  notFiledReason?: MailThreadAttachmentNotFiledReason
  documentId?: string
  documentVersionId?: string
  visible: boolean
}

export interface MailThreadEntryView {
  id: string
  heading: string
  source: MailThreadEntrySource
  senderName: string | null
  senderDomain: string | null
  signerDomain: string | null
  senderTrust: SenderTrust
  forwardedBy: { name: string | null; domain: string | null } | null
  sentAt: string
  receivedAt: string
  firstVersion: { id: string; number: number } | null
  original: { scanStatus: 'pending' | 'clean' | 'infected' | 'failed' } | null
  attachments: MailThreadAttachmentView[]
  filedBy: string
  filedVia: MailThreadFiledVia
  filedAt: string
}

export interface MailThreadEntryDetachResultView {
  entryId: string
  from: { threadId: string; documentId: string; versionId: string | null }
  to: { threadId: string; documentId: string; versionId: string | null }
  followsEnded: number
}

export interface MailThreadSummaryView {
  id: string
  documentId: string
  name: string
  entryCount: number
  lastEntryAt: string | null
  followed: boolean
}

export const MAIL_THREAD_WAITING_REASONS = ['sender_not_verified', 'attachment_left', 'before_follow', 'needs_check'] as const
export type MailThreadWaitingReason = (typeof MAIL_THREAD_WAITING_REASONS)[number]

export interface MailThreadWaiting {
  count: number
  reasons: MailThreadWaitingReason[]
}

export interface MailThreadView extends MailThreadSummaryView {
  participantDomains: string[]
  continuesThreadId: string | null
  entries: MailThreadEntryView[]
  follows: MailThreadFollowView[]
  managesFollows: boolean
  waitingCount: number | null
  waitingReasons: MailThreadWaitingReason[]
}

export interface MailThreadListView {
  items: MailThreadSummaryView[]
  nextCursor: string | null
}

export interface DocumentMailOriginView extends MailOriginView {
  documentVersionId: string | null
}
