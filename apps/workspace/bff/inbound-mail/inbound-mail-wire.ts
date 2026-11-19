import { z } from 'zod'
import { DOCUMENT_TYPE_TAGS, type DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import type { PreselectionBlock } from '@/lib/mail-thread/mail-threading'
import type { ThreadMatchStrength } from '@/lib/mail-thread/mail-thread-vocabulary'
import type { NotStagedReason } from './inbound-mail-vocabulary'
import type { InboundMailSuggestion } from './suggest'
import {
  INBOUND_MAIL_MESSAGE_TEXTS,
  type ImpersonationBasis,
  type InboundMailContentFinding,
  type InboundMailFilingFailure,
  type InboundMailPartKind,
  type InboundMailPartScanStatus,
  type InboundMailPartState,
  type InboundMailSenderClass,
  type InboundSenderTrust,
  type MailParticipant,
  type MalwareScanStatus,
  type PartRiskFlag,
  type SenderFlag,
  type SenderReason,
  type SenderRiskLevel,
  type SenderTrust,
} from './inbound-mail-vocabulary'

const uuid = z.string().uuid()

export const INBOUND_MAIL_DECISION_MAX_MAILS = 20
export const INBOUND_MAIL_DECISION_MAX_PARTS = 101
export const INBOUND_MAIL_LIST_LIMIT = 25
export const INBOUND_MAIL_LIST_MAX_LIMIT = 50
export const INBOUND_MAIL_FILE_NAME_MAX = 255
export const INBOUND_MAIL_FOLDER_PATH_MAX = 1000

export const INBOUND_MAIL_REFUSALS = [
  'stale',
  'part_not_waiting',
  'part_unknown',
  'scan_not_clean',
  'type_not_accepted',
  'name_stop',
  'risk_not_acknowledged',
  'sender_not_acknowledged',
  'sender_only',
  'acknowledgement_in_bulk',
  'card_carries_acknowledgement',
  'name_taken',
  'target_unknown',
  'thread_full',
  'unreadable',
  'nothing_to_mask',
  'not_restorable',
  'gone',
  'original_not_clean',
  'mail_not_received_here',
  'legal_hold', // kept past erasure for a legal hold: a person may read the bytes, an agent may not
] as const
export type InboundMailRefusal = (typeof INBOUND_MAIL_REFUSALS)[number]

export const INBOUND_MAIL_ADDRESS_STATES = ['active', 'none', 'unavailable'] as const
export type InboundMailAddressState = (typeof INBOUND_MAIL_ADDRESS_STATES)[number]

export interface InboundMailAddressView {
  state: InboundMailAddressState
  address: string | null
  canManage: boolean
  lastReceivedAt: string | null
  droppedLast30Days: number
  ownDomainVerifiedShare: number | null
  forwardedFrom: string[]
}

export const INBOUND_MAIL_INCOMPLETE_REASONS = [
  'not_waiting',
  'project_closed',
  'sender',
  'scanning',
  'needs_person',
  'no_thread',
  'folder_missing',
] as const
export type IncompleteReason = (typeof INBOUND_MAIL_INCOMPLETE_REASONS)[number]

export interface InboundMailSenderRiskView {
  riskLevel: SenderRiskLevel
  impersonation: ImpersonationBasis | null
  senderClass: InboundMailSenderClass | null
  waitReason: InboundMailWaitReason | null
  onlySenderReleases: boolean
  ownClaimedMail: boolean
}

export const INBOUND_MAIL_WAIT_REASONS = ['signature', 'replay', 'automatic', 'paused', 'not_filed', 'no_write_rights', 'outside_office', 'sender_unchecked'] as const
export type InboundMailWaitReason = (typeof INBOUND_MAIL_WAIT_REASONS)[number]

export const INBOUND_MAIL_LIST_STATUSES = ['waiting', 'handled'] as const
export type InboundMailListStatus = (typeof INBOUND_MAIL_LIST_STATUSES)[number]

export const INBOUND_MAIL_OUTCOMES = ['filed', 'dismissed', 'expired'] as const
export type InboundMailOutcome = (typeof INBOUND_MAIL_OUTCOMES)[number]

export const inboundMailListQuerySchema = z
  .object({
    status: z
      .enum(INBOUND_MAIL_LIST_STATUSES)
      .default('waiting')
      .describe('"waiting": a part waits for a person. "handled": none does.'),
    outcome: z
      .enum(INBOUND_MAIL_OUTCOMES)
      .optional()
      .describe('With "handled": mails with a part that ended so.'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(INBOUND_MAIL_LIST_MAX_LIMIT)
      .default(INBOUND_MAIL_LIST_LIMIT)
      .describe(`Default ${INBOUND_MAIL_LIST_LIMIT}, max ${INBOUND_MAIL_LIST_MAX_LIMIT}.`),
    cursor: z.string().min(1).max(200).optional().describe('The previous page’s `nextCursor`.'),
  })
export type InboundMailListQuery = z.infer<typeof inboundMailListQuerySchema>

export interface InboundMailSenderView {
  name: string | null
  address: string
  domain: string | null
  signerDomain: string | null
  trust: InboundSenderTrust
  reason: SenderReason
  flags: SenderFlag[]
}

export interface InboundMailThreadCandidateView {
  threadId: string
  documentId: string
  name: string
  folderPath: string | null
  nextVersion: number
  strength: ThreadMatchStrength
  preselected: boolean
  blocks: PreselectionBlock[]
  full: boolean
}

export interface InboundMailSummaryView extends InboundMailSenderRiskView {
  id: string
  projectId: string
  status: InboundMailListStatus
  subject: string | null
  senderName: string | null
  senderDomain: string | null
  senderTrust: InboundSenderTrust | null
  senderFlags: SenderFlag[]
  automatic: boolean
  receivedAt: string
  expiresAt: string
  attachments: number
  waitingParts: number
  outcomes: Record<InboundMailOutcome, number>
  restorableUntil: string | null
  thread: Pick<InboundMailThreadCandidateView, 'threadId' | 'name' | 'nextVersion' | 'preselected'> | null
  incompleteReason: IncompleteReason | null
  followedBy: string | null
  updatedAt: string
}

export interface InboundMailThreadGroupView {
  threadId: string
  name: string
  mails: Array<{ mailId: string; version: number }>
  firstVersion: number
  lastVersion: number
}

export interface InboundMailListView {
  items: InboundMailSummaryView[]
  threadGroups: InboundMailThreadGroupView[]
  nextCursor: string | null
}

export interface InboundMailDocumentRefView {
  documentId: string
  name: string
  folderPath: string | null
}

export interface InboundMailFiledAsView {
  name: string
  folderPath: string | null
  version: number | null
}

export interface InboundMailPartView {
  id: string
  kind: InboundMailPartKind
  position: number
  filename: string | null
  contentType: string
  sizeBytes: number
  state: InboundMailPartState
  scan: InboundMailPartScanStatus
  scannedAt: string | null
  riskFlags: PartRiskFlag[]
  nameStopTerms: string[]
  contentFindings: InboundMailContentFinding[]
  offered: boolean
  lastFailure: InboundMailFilingFailure | null
  documentId: string | null
  filedAs: InboundMailFiledAsView | null
  duplicateOf: InboundMailDocumentRefView | null
  revisionCandidate: (InboundMailDocumentRefView & { nextVersion: number }) | null
  revisionCandidateHidden: boolean
  suggestion: InboundMailSuggestion | null
  preselected: boolean
  restorableUntil: string | null
}

export interface InboundMailView extends InboundMailSenderRiskView {
  id: string
  projectId: string
  status: InboundMailListStatus
  projectClosed: boolean
  ifMatch: string
  subject: string | null
  sender: InboundMailSenderView | null
  participants: MailParticipant[]
  sentAt: string | null
  receivedAt: string
  expiresAt: string
  automatic: boolean
  rawScan: MalwareScanStatus
  originalHeld: boolean
  notStaged: Array<{ filename: string; reason: NotStagedReason }>
  parts: InboundMailPartView[]
  threadCandidates: InboundMailThreadCandidateView[]
  hiddenThreadCandidates: number
  followedBy: string | null
  needsSenderAcknowledgement: boolean
  incompleteReason: IncompleteReason | null
  updatedAt: string
}

export interface InboundMailTextView {
  ownText: string
  ownTextTruncated: boolean
  quoted: Array<{ header: string; text: string }>
  calendar: Array<{
    summary: string | null
    start: string | null
    end: string | null
    allDay: boolean
    location: string | null
    status: string | null
  }>
  masked: boolean
  unreadable: boolean
  forwardedFrom: { name: string | null; address: string | null } | null
}

const partDecisionSchema = z
  .object({
    partId: uuid.describe('From inbound-mail-get `parts`.'),
    folderId: uuid
      .nullable()
      .describe('null: root or `newFolderPath`.'),
    newFolderPath: z
      .string()
      .min(1)
      .max(INBOUND_MAIL_FOLDER_PATH_MAX)
      .nullable()
      .describe('Created if missing, e.g. "Permits/Fire".'),
    name: z
      .string()
      .min(1)
      .max(INBOUND_MAIL_FILE_NAME_MAX)
      .describe('The file name; name-screened.'),
    documentType: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => (DOCUMENT_TYPE_TAGS as readonly string[]).includes(value), 'Not a document type of the vocabulary')
      .optional()
      .describe('A document type tag.'),
    revisionOf: uuid
      .optional()
      .describe('File as the next version of this document.'),
    screeningRelease: z
      .literal('name')
      .optional()
      .describe('The person overrides the name check.'),
  })
  .strict()
  .refine((part) => part.folderId === null || part.newFolderPath === null, {
    message: 'Name either folderId or newFolderPath, not both',
    path: ['newFolderPath'],
  })
export type InboundMailPartDecision = z.infer<typeof partDecisionSchema>

const threadTargetSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('append'),
      mailThreadId: uuid.describe('From `threadCandidates` or mail-thread-list.'),
    })
    .strict(),
  z
    .object({
      action: z.literal('create'),
      folderId: uuid.nullable().describe('null: root or `newFolderPath`.'),
      newFolderPath: z.string().min(1).max(INBOUND_MAIL_FOLDER_PATH_MAX).nullable().describe('Created if missing.'),
      name: z
        .string()
        .min(1)
        .max(INBOUND_MAIL_FILE_NAME_MAX)
        .describe('The thread document’s name; name-screened.'),
      screeningRelease: z.literal('name').optional().describe('The person overrides the name check.'),
    })
    .strict(),
])
export type InboundMailThreadTarget = z.infer<typeof threadTargetSchema>

const messageDecisionSchema = z
  .object({
    partId: uuid.describe('The part of kind "message".'),
    text: z
      .enum(INBOUND_MAIL_MESSAGE_TEXTS)
      .describe('"masked" only with `contentFindings`.'),
    thread: threadTargetSchema,
  })
  .strict()
  .refine((message) => message.thread.action === 'append' || message.thread.folderId === null || message.thread.newFolderPath === null, {
    message: 'Name either folderId or newFolderPath, not both',
    path: ['thread', 'newFolderPath'],
  })
export type InboundMailMessageDecision = z.infer<typeof messageDecisionSchema>

const mailDecisionSchema = z
  .object({
    mailId: uuid,
    ifMatch: z.string().min(1).max(100).describe('From inbound-mail-get.'),
    parts: z
      .array(partDecisionSchema)
      .max(INBOUND_MAIL_DECISION_MAX_PARTS - 1)
      .describe('To file; the others are dismissed.'),
    message: messageDecisionSchema
      .nullable()
      .describe('null dismisses the text.'),
    acknowledgeSender: z
      .literal(true)
      .optional()
      .describe('The person accepts an unconfirmed sender; one mail only.'),
    acknowledgeRisk: z
      .array(uuid)
      .max(INBOUND_MAIL_DECISION_MAX_PARTS)
      .optional()
      .describe('Parts whose risk the person accepts; one mail only.'),
  })
  .strict()
  .refine((mail) => new Set(mail.parts.map((part) => part.partId)).size === mail.parts.length, {
    message: 'A part is named twice',
    path: ['parts'],
  })
  .refine((mail) => !mail.message || !mail.parts.some((part) => part.partId === mail.message?.partId), {
    message: 'The text part is decided in `message`, not in `parts`',
    path: ['message', 'partId'],
  })
export type InboundMailDecision = z.infer<typeof mailDecisionSchema>

export const fileInboundMailsBodySchema = z
  .object({
    mails: z
      .array(mailDecisionSchema)
      .min(1)
      .max(INBOUND_MAIL_DECISION_MAX_MAILS),
  })
  .strict()
  .refine((body) => new Set(body.mails.map((mail) => mail.mailId)).size === body.mails.length, {
    message: 'A mail is named twice',
    path: ['mails'],
  })
export type FileInboundMailsBody = z.infer<typeof fileInboundMailsBodySchema>

export const dismissInboundMailsBodySchema = z
  .object({
    mailIds: z
      .array(uuid)
      .min(1)
      .max(INBOUND_MAIL_DECISION_MAX_MAILS)
      .describe('From inbound-mail-list.'),
  })
  .strict()
  .refine((body) => new Set(body.mailIds).size === body.mailIds.length, { message: 'A mail is named twice', path: ['mailIds'] })
export type DismissInboundMailsBody = z.infer<typeof dismissInboundMailsBodySchema>

export interface InboundMailDecisionResultView {
  mails: InboundMailView[]
  filingJobId: string | null
}

export type InboundMailDocumentType = DocumentTypeTag

export interface MailOriginView {
  threadId: string
  entryId: string
  sentAt: string
  receivedAt: string
  fromName: string | null
  forwardedByName: string | null
  forwarded: boolean
  signerDomain: string | null
  senderTrust: SenderTrust
}
