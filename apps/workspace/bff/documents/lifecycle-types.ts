import { z } from 'zod'
import { DOCUMENT_LIFECYCLES, DOCUMENT_VERSION_STATES, type DocumentVersionState } from './lifecycle-vocabulary'
import { mailOriginViewSchema } from './mail-origin-schema'

export { mailOriginViewSchema } from './mail-origin-schema'
export {
  REVIEW_QUEUE_ROLES,
  reviewQueueQuerySchema,
  type ReviewQueueQuery,
  type ReviewQueueResponse,
} from './review-queue-types'

export {
  DOCUMENT_LIFECYCLES,
  DOCUMENT_SUBMIT_ACTORS,
  DOCUMENT_VERSION_ORIGINS,
  DOCUMENT_VERSION_STATES,
  OPEN_DOCUMENT_VERSION_STATES,
  type DocumentLifecycle,
  type DocumentSubmitActor,
  type DocumentVersionOrigin,
  type DocumentVersionState,
} from './lifecycle-vocabulary'

export const DOCUMENT_VERSION_OPS = [
  'upload',
  'create',
  'update',
  'submit',
  'approve',
  'request_changes',
  'reject',
  'publish',
] as const
export type DocumentVersionOp = (typeof DOCUMENT_VERSION_OPS)[number]

export type DocumentLifecyclePermission =
  | 'project:view'
  | 'project:edit'
  | 'project:documents:write'
  | 'project:documents:generate'

export const DOCUMENT_VERSION_EFFECTS = [
  'audit',
  'openReviewInbox',
  'resolveReviewInbox',
  'eventHint',
  'ingestPublished',
  'openRevisionTask',
  'announceNewRevision',
] as const
export type DocumentVersionEffect = (typeof DOCUMENT_VERSION_EFFECTS)[number]

export type DocumentLifecycleAuditAction =
  | 'document.version.drafted'
  | 'document.version.submitted'
  | 'document.version.approved'
  | 'document.version.changes_requested'
  | 'document.version.rejected'
  | 'document.version.published'
  | 'document.archived'

export interface DocumentVersionTransition {
  readonly from: DocumentVersionState | null
  readonly to: DocumentVersionState
  readonly op: DocumentVersionOp
  readonly actor: 'human' | 'either'
  readonly permission: readonly DocumentLifecyclePermission[]
  readonly alsoRequires?: DocumentLifecyclePermission
  readonly requires: {
    readonly comment?: true
    readonly notSubmitter?: true
    readonly ifMatch?: true
    readonly reviewer?: true
  }
  readonly auditAction: DocumentLifecycleAuditAction
  readonly promotes?: true
  readonly effects: readonly DocumentVersionEffect[]
}

export const DOCUMENT_VERSION_TRANSITIONS = [
  {
    from: null,
    to: 'published',
    op: 'upload',
    actor: 'human',
    permission: ['project:documents:write', 'project:edit'],
    requires: {},
    auditAction: 'document.version.published',
    promotes: true,
    effects: ['audit', 'eventHint', 'announceNewRevision'],
  },
  {
    from: null,
    to: 'draft',
    op: 'create',
    actor: 'either',
    permission: ['project:documents:write', 'project:edit'],
    alsoRequires: 'project:documents:generate',
    requires: {},
    auditAction: 'document.version.drafted',
    effects: ['audit', 'eventHint'],
  },
  {
    from: 'draft',
    to: 'draft',
    op: 'update',
    actor: 'either',
    permission: ['project:documents:write', 'project:edit'],
    alsoRequires: 'project:documents:generate',
    requires: { ifMatch: true },
    auditAction: 'document.version.drafted',
    effects: ['audit', 'eventHint'],
  },
  {
    from: 'changes_requested',
    to: 'draft',
    op: 'update',
    actor: 'either',
    permission: ['project:documents:write', 'project:edit'],
    alsoRequires: 'project:documents:generate',
    requires: { ifMatch: true },
    auditAction: 'document.version.drafted',
    effects: ['audit', 'eventHint'],
  },
  {
    from: 'draft',
    to: 'in_review',
    op: 'submit',
    actor: 'either',
    permission: ['project:edit', 'project:documents:write'],
    requires: { reviewer: true },
    auditAction: 'document.version.submitted',
    effects: ['openReviewInbox', 'audit', 'eventHint'],
  },
  {
    from: 'changes_requested',
    to: 'in_review',
    op: 'submit',
    actor: 'either',
    permission: ['project:edit', 'project:documents:write'],
    requires: { reviewer: true },
    auditAction: 'document.version.submitted',
    effects: ['openReviewInbox', 'audit', 'eventHint'],
  },
  {
    from: 'in_review',
    to: 'published',
    op: 'approve',
    actor: 'human',
    permission: ['project:edit'],
    requires: { notSubmitter: true, ifMatch: true },
    auditAction: 'document.version.approved',
    promotes: true,
    effects: ['resolveReviewInbox', 'ingestPublished', 'audit', 'eventHint', 'announceNewRevision'],
  },
  {
    from: 'in_review',
    to: 'changes_requested',
    op: 'request_changes',
    actor: 'human',
    permission: ['project:edit'],
    requires: { comment: true, ifMatch: true },
    auditAction: 'document.version.changes_requested',
    effects: ['resolveReviewInbox', 'openRevisionTask', 'audit', 'eventHint'],
  },
  {
    from: 'in_review',
    to: 'rejected',
    op: 'reject',
    actor: 'human',
    permission: ['project:edit'],
    requires: { comment: true, ifMatch: true },
    auditAction: 'document.version.rejected',
    effects: ['resolveReviewInbox', 'audit', 'eventHint'],
  },
  {
    from: 'approved',
    to: 'published',
    op: 'publish',
    actor: 'human',
    permission: ['project:documents:write', 'project:edit'],
    requires: {},
    auditAction: 'document.version.published',
    promotes: true,
    effects: ['ingestPublished', 'audit', 'eventHint', 'announceNewRevision'],
  },
] as const satisfies readonly DocumentVersionTransition[]

export function findDocumentVersionTransition(
  from: DocumentVersionState | null,
  op: DocumentVersionOp,
): DocumentVersionTransition | null {
  return DOCUMENT_VERSION_TRANSITIONS.find((row) => row.from === from && row.op === op) ?? null
}

export function transitionsForOp(op: DocumentVersionOp): readonly DocumentVersionTransition[] {
  return DOCUMENT_VERSION_TRANSITIONS.filter((row) => row.op === op)
}

export const AGENT_REACHABLE_OPS: readonly DocumentVersionOp[] = DOCUMENT_VERSION_OPS.filter((op) => {
  const rows = transitionsForOp(op)
  return rows.length > 0 && rows.every((row) => row.actor === 'either')
})


export const MAX_REVIEW_COMMENT_LENGTH = 4000

export const reviewCommentSchema = z.string().trim().min(1).max(MAX_REVIEW_COMMENT_LENGTH)

export const forkDraftRequestSchema = z.object({}).strict()

export const replaceContentRequestSchema = z
  .object({
    content: z.string().max(2_000_000),
    ifMatch: z.string().min(1),
  })
  .strict()

export const MAX_SUBMIT_ORDER_LENGTH = 500

export const submitOrderMessageSchema = z.string().trim().min(1).max(MAX_SUBMIT_ORDER_LENGTH)

export const submitDueAtSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      if (!/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(value)) return false
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) return false
      const datePart = value.slice(0, 10)
      const [year, month, day] = datePart.split('-').map(Number)
      if (value.length === 10 || value[10] === 'T' || value[10] === ' ') {
        const utc = new Date(Date.UTC(year, (month ?? 1) - 1, day))
        return (
          utc.getUTCFullYear() === year &&
          utc.getUTCMonth() === (month ?? 1) - 1 &&
          utc.getUTCDate() === day
        )
      }
      return true
    },
    { message: 'Invalid date' },
  )

export const submitRequestSchema = z
  .object({
    reviewerUserIds: z.array(z.string().min(1)).max(20).default([]),
    orderMessage: submitOrderMessageSchema.optional(),
    dueAt: submitDueAtSchema.optional(),
  })
  .strict()

export const approveRequestSchema = z
  .object({
    comment: reviewCommentSchema.optional(),
    ifMatch: z.string().min(1).optional(),
  })
  .strict()

export const refuseRequestSchema = z
  .object({
    comment: reviewCommentSchema,
    delegateRevision: z.boolean().optional(),
    ifMatch: z.string().min(1).optional(),
  })
  .strict()

export const archiveRequestSchema = z.object({}).strict()

export const internalDocumentVersionOpSchema = z.enum(['create', 'update', 'submit'])

export const internalDocumentVersionRequestSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('create'),
      projectId: z.guid(),
      ref: z.string().min(1).max(200),
      title: z.string().trim().min(1).max(200),
      content: z.string().max(2_000_000),
    })
    .strict(),
  z
    .object({
      op: z.literal('update'),
      documentId: z.guid(),
      versionId: z.guid(),
      content: z.string().max(2_000_000),
      ifMatch: z.string().min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('submit'),
      documentId: z.guid(),
      versionId: z.guid(),
      reviewerUserIds: z.array(z.string().min(1)).max(20).default([]),
      reviewer: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
])

export type InternalDocumentVersionRequest = z.infer<typeof internalDocumentVersionRequestSchema>

export const documentVersionViewSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  versionNumber: z.number().int(),
  state: z.enum(DOCUMENT_VERSION_STATES),
  contentType: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  contentHash: z.string().nullable(),
  submittedBy: z.string().nullable(),
  submittedAt: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  publishedBy: z.string().nullable(),
  publishedAt: z.string().nullable(),
  reviewComment: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  bytesReadable: z.boolean().optional(),
  mailOrigins: z.array(mailOriginViewSchema).optional(),
})

export type DocumentVersionView = z.infer<typeof documentVersionViewSchema>

export const documentVersionListResponseSchema = z.object({
  documentId: z.string(),
  lifecycle: z.enum(DOCUMENT_LIFECYCLES),
  publishedVersionId: z.string().nullable(),
  versions: z.array(documentVersionViewSchema),
  reviewerUserIds: z.array(z.string()).optional(),
  people: z.array(z.object({ userId: z.string(), name: z.string() })).optional(),
})

export type DocumentVersionListResponse = z.infer<typeof documentVersionListResponseSchema>

export const documentVersionResponseSchema = z.object({ version: documentVersionViewSchema })

export type DocumentVersionResponse = z.infer<typeof documentVersionResponseSchema>

export const documentVersionDiffResponseSchema = z.object({
  from: z.object({ version: documentVersionViewSchema, content: z.string() }),
  to: z.object({ version: documentVersionViewSchema, content: z.string() }),
})

export type DocumentVersionDiffResponse = z.infer<typeof documentVersionDiffResponseSchema>

export const documentArchiveResponseSchema = z.object({
  documentId: z.string(),
  lifecycle: z.enum(DOCUMENT_LIFECYCLES),
})

export type DocumentArchiveResponse = z.infer<typeof documentArchiveResponseSchema>

export const DOCUMENT_LIFECYCLE_WIRE_SCHEMAS = {
  internalDocumentVersionRequest: internalDocumentVersionRequestSchema,
  replaceContentRequest: replaceContentRequestSchema,
  submitRequest: submitRequestSchema,
  documentVersionView: documentVersionViewSchema,
  documentVersionListResponse: documentVersionListResponseSchema,
  documentVersionResponse: documentVersionResponseSchema,
} as const
