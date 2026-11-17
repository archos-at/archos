import { z } from 'zod'
import { ProjectProfilePatchOperationSchema } from '@/lib/project-profile/types'
import { PROJECT_MEMORY_CONFIDENCES, PROJECT_MEMORY_KINDS } from '@/lib/projects/memory-vocabulary'
import { memoryTopicField } from '@/lib/memory-topics/wire'

export const PROPOSED_CHANGE_KINDS = ['file_operation', 'memory', 'project_profile', 'operation'] as const
export type ProposedChangeKind = (typeof PROPOSED_CHANGE_KINDS)[number]

export const PROPOSED_CHANGE_STATUSES = ['proposed', 'applied', 'partially_applied', 'failed', 'dismissed'] as const
export type ProposedChangeStatus = (typeof PROPOSED_CHANGE_STATUSES)[number]

export const PROPOSAL_SCOPES = ['project', 'office_shelf', 'organization'] as const
export type ProposalScope = (typeof PROPOSAL_SCOPES)[number]

export const FILE_OPERATIONS = ['move', 'rename', 'create_folder', 'assign'] as const
export type FileOperation = (typeof FILE_OPERATIONS)[number]

export const PROPOSAL_NOTICE_VARIANTS = [...FILE_OPERATIONS, 'memory', 'project_profile', 'operation'] as const
export type ProposalNoticeVariant = (typeof PROPOSAL_NOTICE_VARIANTS)[number]

export const MAX_FILE_OPERATION_ITEMS = 8

const text = (max: number) => z.string().trim().min(1).max(max)

export const fileOperationItemSchema = z
  .object({
    document: text(512).nullish(),
    source: z.preprocess(
      (value) => (value === 'project' ? 'project' : value === 'office' ? 'office' : value),
      z.enum(['project', 'office']).nullish()
    ),
    current: z.string().max(512).nullish(),
    target_folder: z.string().max(1024).nullish(),
    new_display_name: text(512).nullish(),
    folder_name: text(256).nullish(),
    parent_folder: z.string().max(1024).nullish(),
    member: text(256).nullish(),
    reason: z.string().trim().max(300).nullish(),
  })
  .strict()
export type FileOperationItem = z.infer<typeof fileOperationItemSchema>

export const FILING_BASES = ['name', 'content'] as const
export type FilingBasis = (typeof FILING_BASES)[number]

export const newFolderSchema = z
  .object({
    path: text(1024),
    description: z.string().trim().max(500).nullish(),
  })
  .strict()
export type NewFolder = z.infer<typeof newFolderSchema>

export const fileOperationPayloadSchema = z
  .object({
    operation: z.enum(FILE_OPERATIONS),
    operations: z.array(fileOperationItemSchema).min(1).max(MAX_FILE_OPERATION_ITEMS),
    note: z.string().max(500).nullish(),
    new_folder: newFolderSchema.nullish(),
    basis: z.enum(FILING_BASES).nullish(),
  })
  .strict()
export type FileOperationPayload = z.infer<typeof fileOperationPayloadSchema>

export const MEMORY_SCOPES = ['project', 'organization'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export const memoryPayloadSchema = z
  .object({
    scope: z.enum(MEMORY_SCOPES),
    kind: z.enum(PROJECT_MEMORY_KINDS),
    content: text(500),
    confidence: z.enum(PROJECT_MEMORY_CONFIDENCES),
    supersedes: z.string().trim().max(500).nullish(),
    topic: memoryTopicField.optional(),
  })
  .strict()
export type MemoryPayload = z.infer<typeof memoryPayloadSchema>

export const MAX_PROFILE_PATCH_OPERATIONS = 20

export const projectProfilePayloadSchema = z
  .object({
    title: text(200),
    rationale: z.string().trim().max(600).nullish(),
    patch: z.array(ProjectProfilePatchOperationSchema).min(1).max(MAX_PROFILE_PATCH_OPERATIONS),
  })
  .strict()
export type ProjectProfilePayload = z.infer<typeof projectProfilePayloadSchema>

export const MAX_OPERATION_SUMMARY_LENGTH = 300

export const operationInputSchema = z
  .object({
    params: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.unknown()).optional(),
    body: z.unknown().optional(),
    ifMatch: z.string().min(1).max(256).optional(),
  })
  .strict()
export type OperationProposalInput = z.infer<typeof operationInputSchema>

export const operationPayloadSchema = z
  .object({
    operation: text(80),
    input: operationInputSchema,
    summary: text(MAX_OPERATION_SUMMARY_LENGTH),
  })
  .strict()
export type OperationPayload = z.infer<typeof operationPayloadSchema>

export const OPERATION_TARGET_TYPES = [
  'project',
  'document',
  'folder',
  'conversation',
  'bim_model',
  'upload_batch',
  'proposal',
  'inbound_mail',
  'mail_thread',
] as const
export type OperationTargetType = (typeof OPERATION_TARGET_TYPES)[number]

export const OPERATION_TARGET_VIEW_TYPES = [...OPERATION_TARGET_TYPES, 'member'] as const
export type OperationTargetViewType = (typeof OPERATION_TARGET_VIEW_TYPES)[number]

export const operationTargetViewSchema = z.object({
  type: z.enum(OPERATION_TARGET_VIEW_TYPES),
  id: z.string(),
  name: z.string().nullable(),
})
export type OperationTargetView = z.infer<typeof operationTargetViewSchema>

export const proposedChangeResultSchema = z.object({
  label: z.string(),
  ok: z.boolean(),
  reason: z.string().optional(),
  itemId: z.string().optional(),
  scope: z.enum(MEMORY_SCOPES).optional(),
})
export type ProposedChangeResult = z.infer<typeof proposedChangeResultSchema>

const proposedChangeBaseSchema = z.object({
  id: z.guid(),
  projectId: z.string().nullable(),
  status: z.enum(PROPOSED_CHANGE_STATUSES),
  proposedByKind: z.enum(['piloti', 'person']),
  onBehalfOf: z.string(),
  onBehalfOfName: z.string().nullable(),
  originConversationId: z.string().nullable(),
  originMessageId: z.string().nullable(),
  createdAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  results: z.array(proposedChangeResultSchema).nullable(),
  canDecide: z.boolean(),
})

export const proposedChangeViewSchema = z.discriminatedUnion('kind', [
  proposedChangeBaseSchema.extend({ kind: z.literal('file_operation'), payload: fileOperationPayloadSchema }),
  proposedChangeBaseSchema.extend({ kind: z.literal('memory'), payload: memoryPayloadSchema }),
  proposedChangeBaseSchema.extend({ kind: z.literal('project_profile'), payload: projectProfilePayloadSchema }),
  proposedChangeBaseSchema.extend({
    kind: z.literal('operation'),
    payload: operationPayloadSchema,
    targets: z.array(operationTargetViewSchema).optional(),
  }),
])
export type ProposedChangeView = z.infer<typeof proposedChangeViewSchema>

export const proposalResponseSchema = z.object({ proposal: proposedChangeViewSchema })
export type ProposalResponse = z.infer<typeof proposalResponseSchema>

const internalCreateBase = {
  op: z.literal('create'),
  answerMessageId: z.guid().optional(),
  originCardIndex: z.number().int().min(0).optional(),
}

export const internalProposalRequestSchema = z.discriminatedUnion('kind', [
  z.object({ ...internalCreateBase, kind: z.literal('file_operation'), payload: fileOperationPayloadSchema }).strict(),
  z.object({ ...internalCreateBase, kind: z.literal('memory'), payload: memoryPayloadSchema }).strict(),
  z.object({ ...internalCreateBase, kind: z.literal('project_profile'), payload: projectProfilePayloadSchema }).strict(),
])
export type InternalProposalRequest = z.input<typeof internalProposalRequestSchema>

export const internalProposalResponseSchema = z.object({
  id: z.guid(),
  status: z.enum(PROPOSED_CHANGE_STATUSES),
})
export type InternalProposalResponse = z.infer<typeof internalProposalResponseSchema>

export const MAX_LISTED_PROPOSALS = 50

export const PROPOSAL_LIST_SHELVES = ['office_shelf', 'organization'] as const

export const listedProposalSchema = z.object({
  proposal: proposedChangeViewSchema,
  documents: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type ListedProposal = z.infer<typeof listedProposalSchema>

export const proposalListResponseSchema = z.object({
  proposals: z.array(listedProposalSchema),
  nextCursor: z.string().nullable().default(null),
})
export type ProposalListResponse = z.infer<typeof proposalListResponseSchema>

export const proposalListQueryShape = z.object({
  projectId: z.guid().optional().describe('The project whose open proposals to list, from project-list.'),
  shelf: z
    .preprocess((value) => (value === 'archiv' ? 'office_shelf' : value), z.enum(PROPOSAL_LIST_SHELVES).optional())
    .describe('`office_shelf` or `organization` instead of a project.'),
  kind: z.enum(PROPOSED_CHANGE_KINDS).optional().describe('Only proposals of this kind.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LISTED_PROPOSALS)
    .default(MAX_LISTED_PROPOSALS)
    .describe(`Page size (default and most ${MAX_LISTED_PROPOSALS}).`),
  cursor: z.guid().optional().describe('The previous `nextCursor`.'),
})

export const proposalListQuerySchema = proposalListQueryShape.refine(
  (query) => Boolean(query.shelf) !== Boolean(query.projectId),
  { message: 'Name a project, or a shelf without one: shelf=office_shelf (the Büroablage) or shelf=organization' }
)
export type ProposalListQuery = z.input<typeof proposalListQuerySchema>
export type ParsedProposalListQuery = z.infer<typeof proposalListQuerySchema>

export const applyProposalRequestSchema = z
  .object({ memoryScope: z.literal('project').optional() })
  .strict()
export type ApplyProposalRequest = z.infer<typeof applyProposalRequestSchema>
