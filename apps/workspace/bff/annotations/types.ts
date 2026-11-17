import { z } from 'zod'
import { MAX_MENTIONS_PER_MESSAGE } from '@/lib/limits/catalog'

export const ANNOTATION_KINDS = ['hint', 'question', 'defect'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

export const ANNOTATION_SHAPES = ['point', 'region'] as const
export type AnnotationShape = (typeof ANNOTATION_SHAPES)[number]

export const ANNOTATION_AUTHORS = ['person', 'piloti'] as const
export type AnnotationAuthor = (typeof ANNOTATION_AUTHORS)[number]

export const ANNOTATION_STATUSES = ['proposed', 'open', 'resolved', 'dismissed'] as const
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number]

export const AGENT_WAKE_TRIGGERS = ['thread_mention', 'thread_reply', 'assigned'] as const
export type AgentWakeTrigger = (typeof AGENT_WAKE_TRIGGERS)[number]

export const AGENT_WAKE_STATUSES = [
  'queued',
  'started',
  'answered',
  'stopped',
  'suppressed',
  'refused',
  'failed',
] as const
export type AgentWakeStatus = (typeof AGENT_WAKE_STATUSES)[number]

export const WAKE_OUTCOMES = ['none', 'off', 'queued', 'suppressed'] as const
export type WakeOutcome = (typeof WAKE_OUTCOMES)[number]

export const MAX_ANNOTATION_BODY = 2000
export const MAX_ANNOTATION_BASIS = 300

export const MAX_ANNOTATIONS_PER_DOCUMENT = 500
export const MAX_REPLIES_PER_ANNOTATION = 200
export const MAX_PROPOSALS_PER_CALL = 20

const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'not a calendar day')

const unit = z.number().finite().min(0).max(1)

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max))

const placeFields = {
  page: z.number().int().min(1).max(100_000),
  shape: z.enum(ANNOTATION_SHAPES),
  x: unit,
  y: unit,
  w: unit.nullable().optional(),
  h: unit.nullable().optional(),
}

type PlaceInput = {
  shape: AnnotationShape
  x: number
  y: number
  w?: number | null
  h?: number | null
}

export function placeProblem(place: PlaceInput): string | null {
  if (place.shape === 'point') return place.w != null || place.h != null ? 'a point has no size' : null
  if (!place.w || !place.h) return 'a region needs a size'
  if (place.x + place.w > 1.000001 || place.y + place.h > 1.000001) return 'a region stays on its page'
  return null
}

const checkPlace = (value: PlaceInput, context: z.RefinementCtx) => {
  const problem = placeProblem(value)
  if (problem) context.addIssue({ code: 'custom', message: problem })
}

export const markMentionSchema = z
  .object({ targetId: z.string().min(1).max(128), display: z.string().min(1).max(200) })
  .strict()
export type MarkMention = z.infer<typeof markMentionSchema>

export const markMentionsSchema = z.array(markMentionSchema).max(MAX_MENTIONS_PER_MESSAGE)

const content = {
  kind: z.enum(ANNOTATION_KINDS),
  body: text(MAX_ANNOTATION_BODY),
  basis: text(MAX_ANNOTATION_BASIS).nullable().optional(),
  assigneeUserId: z.string().min(1).max(128).nullable().optional(),
  dueOn: calendarDay.nullable().optional(),
}

export const createAnnotationRequestSchema = z
  .object({ ...placeFields, ...content, mentions: markMentionsSchema.optional() })
  .strict()
  .superRefine(checkPlace)
export type CreateAnnotationRequest = z.input<typeof createAnnotationRequestSchema>

export const updateAnnotationRequestSchema = z
  .object({
    kind: content.kind.optional(),
    body: content.body.optional(),
    mentions: markMentionsSchema.optional(),
    basis: content.basis,
    status: z.enum(['open', 'resolved', 'dismissed']).optional(),
    assigneeUserId: content.assigneeUserId,
    dueOn: content.dueOn,
    expectedStatus: z.enum(ANNOTATION_STATUSES).optional(),
    delegateToPiloti: z.boolean().optional(),
    carryToCurrent: z.literal(true).optional(),
  })
  .strict()
  .refine(({ expectedStatus: _, ...changes }) => Object.keys(changes).length > 0, 'nothing to change')
  .refine(({ mentions, body }) => mentions === undefined || body !== undefined, 'mentions go with a body')
  .refine(
    ({ carryToCurrent, expectedStatus: _, ...changes }) => !carryToCurrent || Object.keys(changes).length === 0,
    'carrying a mark to the current Fassung changes nothing else'
  )
export type UpdateAnnotationRequest = z.input<typeof updateAnnotationRequestSchema>

export const createReplyRequestSchema = z
  .object({
    body: text(MAX_ANNOTATION_BODY),
    addressesPiloti: z.boolean().optional(),
    mentions: markMentionsSchema.optional(),
  })
  .strict()
export type CreateReplyRequest = z.input<typeof createReplyRequestSchema>

export const updateReplyRequestSchema = z
  .object({
    body: text(MAX_ANNOTATION_BODY),
    mentions: markMentionsSchema.optional(),
  })
  .strict()
export type UpdateReplyRequest = z.input<typeof updateReplyRequestSchema>

export const annotationReplyViewSchema = z.object({
  id: z.string(),
  annotationId: z.string(),
  authorKind: z.enum(ANNOTATION_AUTHORS),
  body: z.string(),
  createdBy: z.string(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  addressesPiloti: z.boolean().default(false),
  wokenBy: z.enum(AGENT_WAKE_TRIGGERS).nullable().optional(),
  mentions: z.array(markMentionSchema).optional(),
  editedAt: z.string().nullable().optional(),
})
export type AnnotationReplyView = z.infer<typeof annotationReplyViewSchema>

export const AGENT_WORK_STATES = ['queued', 'working', 'failed', 'held'] as const
export type AgentWorkState = (typeof AGENT_WORK_STATES)[number]

export const agentWorkViewSchema = z.object({
  state: z.enum(AGENT_WORK_STATES),
  trigger: z.enum(AGENT_WAKE_TRIGGERS),
  forUserId: z.string(),
  forName: z.string().nullable(),
  reasonKind: z.enum(['budget', 'busy', 'access', 'error']).nullable(),
  since: z.string(),
})
export type AgentWorkView = z.infer<typeof agentWorkViewSchema>

export const carryLinkViewSchema = z.object({
  annotationId: z.string(),
  documentId: z.string(),
  number: z.number().int(),
  documentName: z.string(),
})
export type CarryLinkView = z.infer<typeof carryLinkViewSchema>

export const carryTargetViewSchema = carryLinkViewSchema.pick({ documentId: true, documentName: true })
export type CarryTargetView = z.infer<typeof carryTargetViewSchema>

export const annotationDeleteRefusalSchema = z.enum(['discussed', 'carried'])
export type AnnotationDeleteRefusal = z.infer<typeof annotationDeleteRefusalSchema>

export const annotationViewSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  number: z.number().int(),
  page: z.number().int(),
  shape: z.enum(ANNOTATION_SHAPES),
  x: z.number(),
  y: z.number(),
  w: z.number().nullable(),
  h: z.number().nullable(),
  kind: z.enum(ANNOTATION_KINDS),
  body: z.string(),
  mentions: z.array(markMentionSchema).optional(),
  basis: z.string().nullable(),
  authorKind: z.enum(ANNOTATION_AUTHORS),
  status: z.enum(ANNOTATION_STATUSES),
  assigneeUserId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  dueOn: z.string().nullable(),
  revisionNumber: z.number().int().nullable(),
  onCurrentRevision: z.boolean(),
  createdBy: z.string(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  acceptedBy: z.string().nullable(),
  acceptedByName: z.string().nullable(),
  closedBy: z.string().nullable(),
  closedByName: z.string().nullable(),
  closedAt: z.string().nullable(),
  delegatedBy: z.string().nullable().default(null),
  delegatedByName: z.string().nullable().default(null),
  delegatedAt: z.string().nullable().default(null),
  replies: z.array(annotationReplyViewSchema),
  pilotiWork: agentWorkViewSchema.nullable().optional(),
  carriedFrom: carryLinkViewSchema.nullable().optional(),
  carriedTo: carryLinkViewSchema.nullable().optional(),
  carryTarget: carryTargetViewSchema.nullable().optional(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  deleteRefused: annotationDeleteRefusalSchema.nullable().optional(),
})
export type AnnotationView = z.infer<typeof annotationViewSchema>

export const annotationListResponseSchema = z.object({
  annotations: z.array(annotationViewSchema),
  canAnnotate: z.boolean(),
  pilotiWakes: z.boolean().default(false),
})
export type AnnotationListResponse = z.infer<typeof annotationListResponseSchema>

export const annotationResponseSchema = z.object({
  annotation: annotationViewSchema,
  wake: z.enum(WAKE_OUTCOMES).optional(),
})
export type AnnotationResponse = z.infer<typeof annotationResponseSchema>

export const replyResponseSchema = z.object({
  annotation: annotationViewSchema,
  replyId: z.string().optional(),
  wake: z.enum(WAKE_OUTCOMES).default('none'),
})
export type ReplyResponse = z.infer<typeof replyResponseSchema>

export const documentThreadRequestSchema = z.object({ title: z.string().trim().max(200).optional() }).strict()

export const documentThreadResponseSchema = z.object({ conversationId: z.string().min(1) })

export const REPLY_TAKEN_UP_REASON = 'piloti-took-it-up'
export const REPLY_MARK_CLOSED_REASON = 'mark-closed'

export const replyIsForAgent = (
  mark: { authorKind: AnnotationAuthor; kind: AnnotationKind },
  reply: { authorKind: AnnotationAuthor; addressesPiloti: boolean }
): boolean =>
  reply.authorKind === 'person' && (reply.addressesPiloti || (mark.authorKind === 'piloti' && mark.kind === 'question'))

export const agentRepliedSince = (
  replies: ReadonlyArray<{ authorKind: AnnotationAuthor; createdAt: Date | string }>,
  reply: { createdAt: Date | string }
): boolean => {
  const at = new Date(reply.createdAt).getTime()
  return replies.some((other) => other.authorKind === 'piloti' && new Date(other.createdAt).getTime() > at)
}

export const LIVE_ANNOTATION_STATUSES = ['open', 'proposed'] as const satisfies readonly AnnotationStatus[]

export const isLive = (annotation: Pick<AnnotationView, 'status'>): boolean =>
  (LIVE_ANNOTATION_STATUSES as readonly AnnotationStatus[]).includes(annotation.status)

export function isForReader(
  annotation: Pick<AnnotationView, 'status' | 'assigneeUserId'>,
  readerUserId: string | null
): boolean {
  return readerUserId !== null && annotation.status !== 'proposed' && annotation.assigneeUserId === readerUserId
}

export function isGhostMark(
  annotation: Pick<AnnotationView, 'documentId' | 'onCurrentRevision' | 'status'>,
  documentId: string
): boolean {
  return annotation.documentId === documentId && !annotation.onCurrentRevision && annotation.status === 'open'
}

export interface MarkTally {
  open: number
  proposed: number
  forYou: number
}

export function compareAnnotations(a: AnnotationView, b: AnnotationView): number {
  if (isLive(a) !== isLive(b)) return isLive(a) ? -1 : 1
  if (a.page !== b.page) return a.page - b.page
  return a.number - b.number
}

export function isOverdue(annotation: Pick<AnnotationView, 'status' | 'dueOn'>, today: string): boolean {
  return annotation.status === 'open' && annotation.dueOn !== null && annotation.dueOn < today
}

const POINT_BOX = 0.08

export function regionAround(place: { page: number; x: number; y: number; w?: number | null; h?: number | null }): {
  page: number
  x: number
  y: number
  w: number
  h: number
} {
  if (place.w && place.h) return { page: place.page, x: place.x, y: place.y, w: place.w, h: place.h }
  const round = (value: number) => Math.round(value * 10_000) / 10_000
  const start = (value: number) => round(Math.min(1 - POINT_BOX, Math.max(0, value - POINT_BOX / 2)))
  return { page: place.page, x: start(place.x), y: start(place.y), w: POINT_BOX, h: POINT_BOX }
}

export function annotationBox(annotation: Pick<AnnotationView, 'x' | 'y' | 'w' | 'h'>): [number, number, number, number] {
  return [annotation.x, annotation.y, annotation.x + (annotation.w ?? 0), annotation.y + (annotation.h ?? 0)]
}

export const annotationProposalSchema = z
  .object({
    ...placeFields,
    kind: content.kind,
    body: content.body,
    basis: content.basis,
  })
  .strict()
  .superRefine(checkPlace)
export type AnnotationProposal = z.input<typeof annotationProposalSchema>

export const MAX_POINT_LABEL = 80
export const MAX_HIGHLIGHT_LABEL = 120

const internalOpBase = {
  answerMessageId: z.guid().optional(),
  documentId: z.guid().optional(),
}

export const MAX_ASSIGNEE_QUERY = 200

export const internalAnnotationRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('list'), ...internalOpBase }).strict(),
  z
    .object({
      op: z.literal('propose'),
      ...internalOpBase,
      proposals: z.array(annotationProposalSchema).min(1).max(MAX_PROPOSALS_PER_CALL),
    })
    .strict(),
  z
    .object({
      op: z.literal('create'),
      ...internalOpBase,
      marks: z.array(annotationProposalSchema).min(1).max(MAX_PROPOSALS_PER_CALL),
    })
    .strict(),
  z
    .object({
      op: z.literal('update'),
      ...internalOpBase,
      annotationId: z.guid(),
      status: z.enum(['open', 'resolved', 'dismissed']).optional(),
      assignee: z.string().trim().min(1).max(MAX_ASSIGNEE_QUERY).nullable().optional(),
      dueOn: content.dueOn,
      kind: content.kind.optional(),
      body: content.body.optional(),
      expectedStatus: z.enum(ANNOTATION_STATUSES).optional(),
      note: content.body,
    })
    .strict(),
  z
    .object({
      op: z.literal('delete'),
      ...internalOpBase,
      annotationId: z.guid(),
    })
    .strict(),
  z
    .object({
      op: z.literal('reply'),
      ...internalOpBase,
      annotationId: z.guid(),
      body: content.body,
    })
    .strict(),
  z.object({ op: z.literal('room'), ...internalOpBase }).strict(),
  z
    .object({
      op: z.literal('point'),
      ...internalOpBase,
      page: z.number().int().min(1),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      label: z.string().trim().min(1).max(MAX_POINT_LABEL).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('highlight'),
      ...internalOpBase,
      page: z.number().int().min(1),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().gt(0).max(1),
      h: z.number().gt(0).max(1),
      label: z.string().trim().min(1).max(MAX_HIGHLIGHT_LABEL),
    })
    .strict(),
  z
    .object({
      op: z.literal('look'),
      ...internalOpBase,
      page: z.number().int().min(1),
      x: z.number().min(0).max(1).optional(),
      y: z.number().min(0).max(1).optional(),
      w: z.number().gt(0).max(1).optional(),
      h: z.number().gt(0).max(1).optional(),
    })
    .strict(),
  z.object({ op: z.literal('leave'), ...internalOpBase }).strict(),
])
export type InternalAnnotationRequest = z.input<typeof internalAnnotationRequestSchema>

export const internalAnnotationSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  page: z.number().int(),
  shape: z.enum(ANNOTATION_SHAPES),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  kind: z.enum(ANNOTATION_KINDS),
  status: z.enum(ANNOTATION_STATUSES),
  authorKind: z.enum(ANNOTATION_AUTHORS),
  body: z.string(),
  basis: z.string().nullable(),
  assigneeName: z.string().nullable(),
  dueOn: z.string().nullable(),
  onCurrentRevision: z.boolean(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  replies: z.array(
    z.object({
      authorKind: z.enum(ANNOTATION_AUTHORS),
      body: z.string(),
      createdByName: z.string().nullable(),
    })
  ),
})
export type InternalAnnotation = z.infer<typeof internalAnnotationSchema>

export const internalAnnotationListResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  annotations: z.array(internalAnnotationSchema),
})

const internalSetMarkSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  page: z.number().int(),
  shape: z.enum(ANNOTATION_SHAPES),
  x: z.number(),
  y: z.number(),
  w: z.number().nullable(),
  h: z.number().nullable(),
  kind: z.enum(ANNOTATION_KINDS),
  body: z.string(),
})

export const internalAnnotationProposeResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  proposed: z.array(internalSetMarkSchema),
})

export const internalAnnotationCreateResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  created: z.array(internalSetMarkSchema),
})

const internalMarkFieldsSchema = z.object({
  status: z.enum(ANNOTATION_STATUSES).optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  dueOn: z.string().nullable().optional(),
  kind: z.enum(ANNOTATION_KINDS).optional(),
  body: z.string().optional(),
})
export type InternalMarkFields = z.infer<typeof internalMarkFieldsSchema>

export const internalAnnotationUpdateResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  annotationId: z.string(),
  number: z.number().int(),
  status: z.enum(ANNOTATION_STATUSES),
  before: internalMarkFieldsSchema,
  after: internalMarkFieldsSchema,
  noted: z.boolean(),
})

export const internalAnnotationDeleteResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  annotationId: z.string(),
  number: z.number().int(),
  body: z.string(),
})

export const internalAnnotationReplyResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  annotationId: z.string(),
  number: z.number().int(),
  replies: z.number().int(),
})

export const internalRoomResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  peers: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['person', 'piloti']),
      page: z.number().int().nullable(),
      viewport: z.object({ page: z.number().int(), y: z.number() }).nullable(),
      selectedMarkNumber: z.number().int().nullable(),
      draft: z
        .object({ page: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .nullable(),
    })
  ),
  marks: z.object({ open: z.number().int(), proposed: z.number().int() }),
})

export const internalRoomGestureResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  ok: z.literal(true),
})

export const ANNOTATION_WIRE_SCHEMAS = {
  InternalAnnotationRequest: internalAnnotationRequestSchema,
  InternalAnnotationListResponse: internalAnnotationListResponseSchema,
  InternalAnnotationProposeResponse: internalAnnotationProposeResponseSchema,
  InternalAnnotationCreateResponse: internalAnnotationCreateResponseSchema,
  InternalAnnotationUpdateResponse: internalAnnotationUpdateResponseSchema,
  InternalAnnotationDeleteResponse: internalAnnotationDeleteResponseSchema,
  InternalAnnotationReplyResponse: internalAnnotationReplyResponseSchema,
  InternalRoomResponse: internalRoomResponseSchema,
  InternalRoomGestureResponse: internalRoomGestureResponseSchema,
} as const
