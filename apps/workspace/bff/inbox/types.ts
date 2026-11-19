import type { InboxItemType, InboxTargetType } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import type { MarkMention } from '@/lib/annotations/types'
import type { UploadReport } from '@/lib/upload-batches/upload-report'
import { LEGACY_AGENT_INBOX_TYPES, type StoredInboxType } from './legacy-agent-types'

export type { InboxItemType, InboxTargetType, ShareableResourceType }

export type InboxItemState = 'unread' | 'read' | 'resolved' | 'archived' | 'inert'

export interface InboxItemView {
  id: string
  type: InboxItemType
  state: InboxItemState
  archived: boolean
  read: boolean
  actionable: boolean
  resourceType: InboxTargetType
  resourceId: string
  projectId?: string | null
  projectName?: string | null
  anchorId: string | null
  actorName: string | null
  actorUserId: string | null
  count: number
  href: string | null
  subject: string | null
  related: string | null
  excerpt: string | null
  mentions: MarkMention[]
  variant: string | null
  dueOn?: string | null
  openMarks?: number | null
  marksRevision?: number | null
  uploadReport?: UploadReport | null
  answerIn: InboxAnswerPlace | null
  pilotiWakes?: boolean
  createdAt: string
  updatedAt: string
}

export type InboxAnswerPlace = 'row' | 'review'

export const INBOX_LIST_FILTERS = ['pending', 'requests', 'unread', 'all', 'archived'] as const
export type InboxListFilter = (typeof INBOX_LIST_FILTERS)[number]

export interface InboxListResponse {
  items: InboxItemView[]
  pending: number
  counts: { requests: number; unread: number }
  hasMore: boolean
  nextCursor: string | null
}

export interface InboxMutationResult {
  affected: number
  pending: number
}

export interface InboxSummaryResponse {
  pending: number
}

export interface InboxTypePresentation {
  readonly icon:
    | 'at-sign'
    | 'message-square'
    | 'user-plus'
    | 'check-circle'
    | 'hard-drive'
    | 'alert-triangle'
    | 'clock'
    | 'megaphone'
    | 'shield-alert'
    | 'layers'
    | 'mail'
    | 'mail-clock'
    | 'mail-check'
    | 'mail-x'
    | 'mail-warning'
    | 'mail-plus'
    | 'agent'
  readonly i18nKey: string
  readonly tone: 'request' | 'info' | 'warning'
  readonly anchor?: 'mark'
}

export const INBOX_TYPE_PRESENTATION: Record<InboxItemType, InboxTypePresentation> = {
  'mention.requested': { icon: 'at-sign', i18nKey: 'mentionRequested', tone: 'request' },
  'mention.answered': { icon: 'check-circle', i18nKey: 'mentionAnswered', tone: 'info' },
  'conversation.shared_with_you': { icon: 'user-plus', i18nKey: 'conversationShared', tone: 'info' },
  'conversation.activity': { icon: 'message-square', i18nKey: 'conversationActivity', tone: 'info' },
  'storage.quota_warning': { icon: 'hard-drive', i18nKey: 'storageQuotaWarning', tone: 'warning' },
  'document.assigned_to_you': { icon: 'user-plus', i18nKey: 'documentAssigned', tone: 'info' },
  'resource.ownership_taken': { icon: 'shield-alert', i18nKey: 'ownershipTaken', tone: 'info' },
  'task_run.completed': { icon: 'check-circle', i18nKey: 'taskRunCompleted', tone: 'info' },
  'task_run.failed': { icon: 'alert-triangle', i18nKey: 'taskRunFailed', tone: 'warning' },
  'task_run.waiting': { icon: 'clock', i18nKey: 'taskRunWaiting', tone: 'request' },
  'document.review_requested': {
    icon: 'check-circle',
    i18nKey: 'documentReviewRequested',
    tone: 'request',
  },
  'feedback.submitted': { icon: 'megaphone', i18nKey: 'feedbackSubmitted', tone: 'info' },
  'feedback.replied': { icon: 'message-square', i18nKey: 'feedbackReplied', tone: 'info' },
  'upload.completed': { icon: 'check-circle', i18nKey: 'uploadCompleted', tone: 'info' },
  'document.quarantined': { icon: 'shield-alert', i18nKey: 'documentQuarantined', tone: 'warning' },
  'document.release_requested': { icon: 'shield-alert', i18nKey: 'documentReleaseRequested', tone: 'request' },
  'mail_import.completed': { icon: 'check-circle', i18nKey: 'mailImportCompleted', tone: 'info' },
  'mail_import.failed': { icon: 'alert-triangle', i18nKey: 'mailImportFailed', tone: 'warning' },
  'document.new_revision': { icon: 'layers', i18nKey: 'documentNewRevision', tone: 'info' },
  'agent.work_done': { icon: 'agent', i18nKey: 'agentWorkDone', tone: 'info', anchor: 'mark' },
  'agent.work_failed': { icon: 'agent', i18nKey: 'agentWorkFailed', tone: 'warning', anchor: 'mark' },
  'agent.asks_you': { icon: 'agent', i18nKey: 'agentAsksYou', tone: 'request', anchor: 'mark' },
  'agent.proposal_waiting': { icon: 'agent', i18nKey: 'agentProposalWaiting', tone: 'request' },
  'agent.intake_ready': { icon: 'agent', i18nKey: 'agentIntakeReady', tone: 'request' },
  'agent.revision_checked': { icon: 'agent', i18nKey: 'agentRevisionChecked', tone: 'info', anchor: 'mark' },
  'annotation.assigned_to_you': { icon: 'user-plus', i18nKey: 'annotationAssigned', tone: 'request', anchor: 'mark' },
  'annotation.activity': { icon: 'message-square', i18nKey: 'annotationActivity', tone: 'info', anchor: 'mark' },
  'annotation.mentioned': { icon: 'at-sign', i18nKey: 'annotationMentioned', tone: 'request', anchor: 'mark' },
  'root_sort.ready': { icon: 'check-circle', i18nKey: 'rootSortReady', tone: 'info' },
  'root_sort.failed': { icon: 'alert-triangle', i18nKey: 'rootSortFailed', tone: 'warning' },
  'inbound_mail.waiting': { icon: 'mail', i18nKey: 'inboundMailWaiting', tone: 'request' },
  'inbound_mail.expiring': { icon: 'mail-clock', i18nKey: 'inboundMailExpiring', tone: 'warning' },
  'inbound_mail.decided': { icon: 'mail-check', i18nKey: 'inboundMailDecided', tone: 'info' },
  'inbound_mail.filing_failed': { icon: 'mail-x', i18nKey: 'inboundMailFilingFailed', tone: 'warning' },
  'inbound_mail.cap_reached': { icon: 'mail-warning', i18nKey: 'inboundMailCapReached', tone: 'warning' },
  'inbound_mail.appended': { icon: 'mail-plus', i18nKey: 'inboundMailAppended', tone: 'info' },
  'inbound_mail.held': { icon: 'shield-alert', i18nKey: 'inboundMailHeld', tone: 'request' },
  'inbound_mail.held_for_writers': { icon: 'mail', i18nKey: 'inboundMailHeldForWriters', tone: 'info' },
  'inbound_mail.rejected': { icon: 'mail-x', i18nKey: 'inboundMailRejected', tone: 'info' },
  'inbound_mail.expired': { icon: 'mail-clock', i18nKey: 'inboundMailExpired', tone: 'info' },
  'mail_thread.follow_expiring': { icon: 'clock', i18nKey: 'mailThreadFollowExpiring', tone: 'request' },
  'mail_thread.follow_ended': { icon: 'mail-x', i18nKey: 'mailThreadFollowEnded', tone: 'info' },
  'inbound_mail.fraud_reported': { icon: 'shield-alert', i18nKey: 'inboundMailFraudReported', tone: 'warning' },
}

export const LEGACY_INBOX_TYPES: Readonly<Record<string, InboxItemType>> = {
  'document.new_fassung': 'document.new_revision',
  'job.completed': 'task_run.completed',
  'job.failed': 'task_run.failed',
  'job.waiting': 'task_run.waiting',
  ...LEGACY_AGENT_INBOX_TYPES,
}

export function canonicalInboxType(type: string): InboxItemType {
  return (LEGACY_INBOX_TYPES[type] ?? type) as InboxItemType
}

export function legacyInboxTypeAliases(types: readonly string[]): string[] {
  return Object.entries(LEGACY_INBOX_TYPES)
    .filter(([, current]) => types.includes(current))
    .map(([legacy]) => legacy)
}

export function storedInboxTypesOf(types: readonly string[]): StoredInboxType[] {
  const current = types.map(canonicalInboxType)
  return [...new Set([...current, ...legacyInboxTypeAliases(current)])] as StoredInboxType[]
}

export function inboxTypePresentation(type: string): InboxTypePresentation | undefined {
  return INBOX_TYPE_PRESENTATION[canonicalInboxType(type) as InboxItemType]
}

export const UNKNOWN_TYPE_PRESENTATION: InboxTypePresentation = {
  icon: 'message-square',
  i18nKey: 'unknown',
  tone: 'info',
}

export function isMarkAnchored(type: string): boolean {
  return inboxTypePresentation(type)?.anchor === 'mark'
}

export const INBOX_LIST_LIMIT = 50
