import { z } from 'zod'
import { BFF_JOB_PRIORITY, type BffJobPriority } from '@/lib/db/schema/bff-job-queue'
import { requesterSchema } from './requester'

export const BFF_JOB_KINDS = [
  'root_sort',
  'reindex_project',
  'reingest_failed',
  'placement_reingest',
  'restore_folder_bin',
  'purge_binned_chunks',
  'bim_extract',
  'office_rendition',
  'file_research_report',
  'mail_import',
  'piloti_wake',
  'piloti_wake_stop',
  'project_intake_read',
  'filing_review',
  'inbox_push',
  'annotation_due_reminders',
  'revision_notice',
  'document_check',
  'inbound_mail_receive',
  'inbound_mail_suggest',
  'inbound_mail_file',
  'inbound_mail_follow',
  'inbound_mail_sender_file',
  'search_facets_sync',
  'platform_text_index',
  'platform_text_deindex',
  'office_norms_scan',
] as const
export type BffJobKind = (typeof BFF_JOB_KINDS)[number]

export function isBffJobKind(value: string): value is BffJobKind {
  return (BFF_JOB_KINDS as readonly string[]).includes(value)
}

export { BFF_JOB_PRIORITY }
export type { BffJobPriority }

export { requesterOf, requesterSchema, sessionOf, type JobRequester } from './requester'

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() })

export const FAILED_NAMES_KEPT = 20

const countsSchema = z.object({
  queued: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  failedNames: z.array(z.string()).max(FAILED_NAMES_KEPT),
})
export type JobCounts = z.infer<typeof countsSchema>

export const emptyCounts = (): JobCounts => ({ queued: 0, skipped: 0, failed: 0, failedNames: [] })

export function recordJobFailure(counts: JobCounts, name: string): void {
  counts.failed += 1
  if (counts.failedNames.length < FAILED_NAMES_KEPT) counts.failedNames.push(name)
}

export const reindexProjectPayloadSchema = z.object({
  projectId: z.string().min(1),
  requester: requesterSchema,
  cursor: cursorSchema.nullable(),
  counts: countsSchema,
})
export type ReindexProjectPayload = z.infer<typeof reindexProjectPayloadSchema>

export const reingestFailedPayloadSchema = z.object({
  requester: requesterSchema,
  cursor: cursorSchema.nullable(),
  counts: countsSchema,
})
export type ReingestFailedPayload = z.infer<typeof reingestFailedPayloadSchema>

export const placementReingestPayloadSchema = z.object({
  projectId: z.string().min(1),
})
export type PlacementReingestPayload = z.infer<typeof placementReingestPayloadSchema>

export const restoreFolderBinPayloadSchema = z.object({
  projectId: z.string().min(1),
  folderId: z.string().min(1),
  jobId: z.guid(),
  requester: requesterSchema,
  cursor: z.string().nullable(),
  counts: countsSchema,
})
export type RestoreFolderBinPayload = z.infer<typeof restoreFolderBinPayloadSchema>

export const rootSortPayloadSchema = z.object({
  runId: z.guid(),
  requester: requesterSchema,
})
export type RootSortPayload = z.infer<typeof rootSortPayloadSchema>

export const purgeBinnedChunksPayloadSchema = z.object({
  projectId: z.string().min(1),
  folderId: z.string().min(1),
  entryId: z.string().min(1),
  requester: requesterSchema,
  cursor: z.string().nullable(),
  documents: z.number().int().nonnegative(),
})
export type PurgeBinnedChunksPayload = z.infer<typeof purgeBinnedChunksPayloadSchema>

const documentWorkPayloadSchema = z.object({
  projectId: z.string().nullable(),
  documentId: z.string().min(1),
  filename: z.string().min(1),
  storageKey: z.string().min(1),
  storageBucket: z.string().nullable(),
  collectionName: z.string().min(1),
  folderPath: z.string().nullable().optional(),
  versionId: z.string().nullable().optional(),
  priority: z.enum(['interactive', 'bulk']).optional(),
})

export const bimExtractPayloadSchema = documentWorkPayloadSchema
export type BimExtractPayload = z.infer<typeof bimExtractPayloadSchema>

export const officeRenditionPayloadSchema = documentWorkPayloadSchema.extend({
  fileName: z.string().min(1),
  provenance: z
    .object({
      authored_by: z.literal('agent'),
      approved_by: z.string().nullable(),
      approved_at: z.string().nullable(),
      producer: z.string().nullable(),
    })
    .nullable()
    .optional(),
  revisionOf: z.string().nullable().optional(),
  revisionOfId: z.string().uuid().nullable().optional(),
  fassungOf: z.string().nullable().optional(),
  documentType: z.string().nullable().optional(),
  mailThread: z.unknown().optional(),
  mailOrigin: z.unknown().optional(),
})
export type OfficeRenditionPayload = z.infer<typeof officeRenditionPayloadSchema>

export const fileResearchReportPayloadSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  report: z.string().min(1),
  cards: z.array(z.unknown()).optional(),
  taskRunId: z.string().nullable(),
  requester: requesterSchema.nullable(),
})
export type FileResearchReportPayload = z.infer<typeof fileResearchReportPayloadSchema>

export const mailImportPayloadSchema = z.object({
  importId: z.guid(),
  projectId: z.guid(),
  requester: requesterSchema,
})
export type MailImportPayload = z.infer<typeof mailImportPayloadSchema>

export const agentWakePayloadSchema = z.object({
  wakeId: z.guid(),
  trigger: z.enum(['thread_mention', 'thread_reply', 'assigned']),
  eventId: z.string().min(1).max(128),
  documentId: z.guid(),
  annotationId: z.guid(),
  actor: z.object({ userId: z.string().min(1), email: z.string().nullable() }),
  waits: z.number().int().nonnegative(),
})
export type AgentWakePayload = z.infer<typeof agentWakePayloadSchema>

export const agentWakeStopPayloadSchema = z.object({
  wakeId: z.guid(),
  documentId: z.guid(),
  annotationId: z.guid(),
  actorUserId: z.string().min(1),
})
export type AgentWakeStopPayload = z.infer<typeof agentWakeStopPayloadSchema>

export const projectIntakeReadPayloadSchema = z.object({
  projectId: z.guid(),
  requester: requesterSchema,
})
export type ProjectIntakeReadPayload = z.infer<typeof projectIntakeReadPayloadSchema>

export const filingReviewPayloadSchema = z.object({
  batchId: z.guid(),
  basis: z.enum(['name', 'content']),
  requester: requesterSchema,
})
export type FilingReviewPayload = z.infer<typeof filingReviewPayloadSchema>

export const inboxPushPayloadSchema = z.object({
  itemId: z.guid(),
  recipientUserId: z.string().min(1),
  stamp: z.string().min(1),
})
export type InboxPushJobPayload = z.infer<typeof inboxPushPayloadSchema>

const dueReminderCountsSchema = z.object({
  checked: z.number().int().nonnegative(),
  dueSoon: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  already: z.number().int().nonnegative(),
  unreachable: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
})
export type DueReminderCounts = z.infer<typeof dueReminderCountsSchema>

export const emptyDueReminderCounts = (): DueReminderCounts => ({
  checked: 0,
  dueSoon: 0,
  overdue: 0,
  already: 0,
  unreachable: 0,
  failed: 0,
})

export const annotationDueRemindersPayloadSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cursor: z.guid().nullable(),
  counts: dueReminderCountsSchema,
})
export type AnnotationDueRemindersPayload = z.infer<typeof annotationDueRemindersPayloadSchema>

export const revisionNoticePayloadSchema = z.object({
  noticeId: z.guid(),
  newerId: z.guid(),
  olderId: z.guid(),
  actor: z.object({ userId: z.string().min(1), email: z.string().nullable() }),
})
export type RevisionNoticePayload = z.infer<typeof revisionNoticePayloadSchema>

export const documentCheckPayloadSchema = z.object({
  checkId: z.guid(),
  documentId: z.guid(),
  actor: z.object({ userId: z.string().min(1), email: z.string().nullable() }),
  conversationId: z.string().min(1).nullable(),
  waits: z.number().int().nonnegative(),
})
export type DocumentCheckPayload = z.infer<typeof documentCheckPayloadSchema>

export const inboundMailReceivePayloadSchema = z.object({
  mailId: z.string().uuid(),
  projectId: z.string().uuid(),
  faults: z.number().int().nonnegative().max(100).optional(),
  dkimFaults: z.number().int().nonnegative().max(100).optional(),
})
export type InboundMailReceivePayload = z.infer<typeof inboundMailReceivePayloadSchema>

export const inboundMailSuggestPayloadSchema = z.object({
  mailId: z.string().uuid(),
  projectId: z.string().uuid(),
})
export type InboundMailSuggestPayload = z.infer<typeof inboundMailSuggestPayloadSchema>

export const inboundMailFilePayloadSchema = z.object({
  projectId: z.string().uuid(),
  mailIds: z.array(z.string().uuid()).min(1).max(20),
  decisionIds: z.array(z.string().uuid()).min(1).max(2_020).optional(),
  requester: requesterSchema,
})
export type InboundMailFilePayload = z.infer<typeof inboundMailFilePayloadSchema>

export const inboundMailFollowPayloadSchema = z.object({
  projectId: z.string().uuid(),
  mailId: z.string().uuid(),
  followId: z.string().uuid(),
  requester: requesterSchema,
})
export type InboundMailFollowPayload = z.infer<typeof inboundMailFollowPayloadSchema>

export const inboundMailSenderFilePayloadSchema = z.object({
  mailId: z.string().uuid(),
  projectId: z.string().uuid(),
  waits: z.number().int().nonnegative(),
})
export type InboundMailSenderFilePayload = z.infer<typeof inboundMailSenderFilePayloadSchema>

export interface JobAttempt {
  last: boolean
  jobId?: string
}

export interface JobSliceResult<TPayload> {
  done: boolean
  payload: TPayload
  notBefore?: Date
}

export const searchFacetsSyncPayloadSchema = z.object({
  shelfKey: z.string().min(1).max(60),
  afterId: z.guid().nullable(),
  sourceFingerprint: z.string().min(1).max(120),
  written: z.number().int().nonnegative(),
})
export type SearchFacetsSyncPayload = z.infer<typeof searchFacetsSyncPayloadSchema>
