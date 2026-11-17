import { z } from 'zod'
import { geocodeResultSchema } from '@/lib/geocoding/types'
import { SETUP_DETERMINANTS, type SetupDeterminant } from '@/lib/base-knowledge/wire/vocab'
import { projectLawSchema } from '@/lib/base-knowledge/wire/project-law'
import {
  DERIVATION_RULES,
  derivationInputSchema,
  MAX_EVIDENCE_QUOTE_LENGTH,
  MAX_PROFILE_ALTERNATIVES,
  MAX_PROFILE_EVIDENCE,
  profileAlternativeSchema,
  profileEvidenceSchema,
} from '@/lib/project-profile/evidence-schema'
import type { ProjectIntakeQuestionType } from '@/lib/project-profile/intake-types'
import { ProjectPrimitiveValueSchema } from '@/lib/project-profile/types'
import { isMonth, type Month } from '@/lib/projects/month'
import { PROJECT_OUTCOMES } from '@/lib/projects/project-status'

export {
  DERIVATION_RULES,
  MAX_DERIVATION_INPUTS,
  MAX_EVIDENCE_QUOTE_LENGTH,
  MAX_PROFILE_ALTERNATIVES,
  MAX_PROFILE_EVIDENCE,
  PROFILE_EVIDENCE_KINDS,
  derivationEvidenceSchema,
  derivationInputSchema,
  documentEvidenceSchema,
  geocoderEvidenceSchema,
  personEvidenceSchema,
  profileAlternativeSchema,
  profileEvidenceSchema,
} from '@/lib/project-profile/evidence-schema'
export type {
  DerivationEvidence,
  DerivationInput,
  DerivationRule,
  DocumentEvidence,
  ProfileAlternative,
  ProfileEvidence,
  ProfileEvidenceKind,
} from '@/lib/project-profile/evidence-schema'

export const INTAKE_STATUSES = ['waiting', 'reading', 'ready', 'failed', 'completed'] as const
export type IntakeStatus = (typeof INTAKE_STATUSES)[number]

export const INTAKE_MODES = ['active', 'closing'] as const
export type IntakeMode = (typeof INTAKE_MODES)[number]

export const INTAKE_NEED_TYPES = [
  'single_select',
  'multi_select',
  'boolean',
  'number',
  'text',
  'textarea',
  'number_tri',
  'yes_no_open',
] as const satisfies readonly ProjectIntakeQuestionType[]
export type IntakeNeedType = (typeof INTAKE_NEED_TYPES)[number]

export const NEED_STATES = ['open', 'suggested', 'confirmed'] as const
export type NeedState = (typeof NEED_STATES)[number]

export const SUGGESTION_STATES = ['suggested', 'confirmed', 'contested'] as const
export type SuggestionState = (typeof SUGGESTION_STATES)[number]

export const INTAKE_DECISION_ACTIONS = ['confirm', 'dismiss', 'answer', 'unknown'] as const

export const RECORD_OUTCOMES = ['suggested', 'corroborated', 'contradiction', 'refused'] as const

export const RECORD_REFUSAL_REASONS = ['vocabulary', 'unknown-key', 'dismissed', 'unreadable-file'] as const
export type RecordRefusalReason = (typeof RECORD_REFUSAL_REASONS)[number]

export const WITHDRAW_OUTCOMES = ['withdrawn', 'refused'] as const

export const WITHDRAW_REFUSAL_REASONS = ['nothing-suggested', 'confirmed', 'not-this-reading'] as const
export type WithdrawRefusalReason = (typeof WITHDRAW_REFUSAL_REASONS)[number]

export const STALE_READING_REASON = 'stale-reading'

export const MAX_INTAKE_DESCRIPTION_LENGTH = 500
export const MAX_INTAKE_SUMMARY_LENGTH = 2000
export const MAX_RECORD_VALUES = 20
export const MAX_INTAKE_DECISIONS = 60
export const MAX_UNREAD_FILES = 200
export const MAX_DOCUMENTS_READ = 500
export const MAX_INTAKE_NEEDS = 500

const key = z.string().min(1).max(200)
const jobId = z.string().min(1).max(128)
const instant = z.string().datetime({ offset: true })
const count = z.number().int().min(0)
const alternativeIndex = z.number().int().min(0).max(MAX_PROFILE_ALTERNATIVES - 1)

const monthSchema = z.string().refine((value): value is Month => isMonth(value), 'A month, YYYY-MM.')

export const closingIntentSchema = z
  .object({
    outcome: z.enum(PROJECT_OUTCOMES),
    startedOn: monthSchema.nullish(),
    endedOn: monthSchema,
  })
  .strict()
export type ClosingIntent = z.infer<typeof closingIntentSchema>

export const documentReadSchema = z.object({
  documentId: z.guid(),
  contentHash: z.string().min(1).max(128),
})
export type DocumentRead = z.infer<typeof documentReadSchema>

export const dismissedValueSchema = z.object({
  key,
  value: ProjectPrimitiveValueSchema,
})
export type DismissedValue = z.infer<typeof dismissedValueSchema>

export const intakeCountsSchema = z.object({
  documentsRead: count,
  suggested: count,
  contradictions: count,
  decisiveOpen: count,
})
export type IntakeCounts = z.infer<typeof intakeCountsSchema>

export const needOptionSchema = z.object({
  token: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
})
export type NeedOption = z.infer<typeof needOptionSchema>

export const needSchema = z.object({
  key,
  baseKey: key,
  buildingId: z.string().min(1).max(32).nullable(),
  label: z.string().min(1).max(300),
  type: z.enum(INTAKE_NEED_TYPES),
  options: z.array(needOptionSchema).max(100).optional(),
  unit: z.string().max(20).optional(),
  why: z.string().max(1000).optional(),
  foundIn: z.array(z.string().min(1).max(100)).max(20),
  decisive: z.boolean(),
  state: z.enum(NEED_STATES),
})
export type Need = z.infer<typeof needSchema>

export const suggestionSchema = z.object({
  key,
  baseKey: key,
  buildingId: z.string().min(1).max(32).nullable(),
  label: z.string().min(1).max(300),
  value: ProjectPrimitiveValueSchema,
  display: z.string().max(1000),
  state: z.enum(SUGGESTION_STATES),
  evidence: z.array(profileEvidenceSchema).max(MAX_PROFILE_EVIDENCE),
  alternatives: z.array(profileAlternativeSchema).max(MAX_PROFILE_ALTERNATIVES),
  decisive: z.boolean(),
})
export type Suggestion = z.infer<typeof suggestionSchema>

export const derivationViewSchema = z.object({
  buildingId: z.string().min(1).max(32),
  rule: z.enum(DERIVATION_RULES),
  citation: z.string().min(1).max(300),
  value: z.number().int().min(1).max(5).nullable(),
  highRise: z.boolean(),
  inputs: z.array(derivationInputSchema).max(20),
  missing: z.array(key).max(20),
})
export type DerivationView = z.infer<typeof derivationViewSchema>

export const derivationReviewSchema = derivationViewSchema.extend({ suggestion: suggestionSchema.nullable() })
export type DerivationReview = z.infer<typeof derivationReviewSchema>

export const suggestionGroupSchema = z.object({
  stage: z.string().min(1).max(8),
  title: z.string().min(1).max(200),
  items: z.array(suggestionSchema),
})
export type SuggestionGroup = z.infer<typeof suggestionGroupSchema>

export const LOCATION_DETERMINANTS = SETUP_DETERMINANTS
export type LocationDeterminant = SetupDeterminant

export const registerSourceSchema = z.object({
  title: z.string().min(1).max(300),
  reference: z.string().min(1).max(300).optional(),
  needsReview: z.boolean(),
})
export type RegisterSource = z.infer<typeof registerSourceSchema>

export const documentRequestSchema = z.object({
  determinant: z.enum(LOCATION_DETERMINANTS),
  label: z.string().min(1).max(200),
  document: z.string().min(1).max(200),
  reason: z.string().min(1).max(1000),
  keys: z.array(key).min(1).max(20),
  needs: z.array(needSchema).max(20),
  satisfied: z.boolean(),
  sources: z.array(registerSourceSchema).max(6),
})
export type DocumentRequest = z.infer<typeof documentRequestSchema>

export const locationRegisterViewSchema = z.object({
  federalState: z.string().min(1).max(64).nullable(),
  municipality: z.string().min(1).max(200).nullable(),
  questions: z.array(needSchema).max(10),
  documentRequests: z.array(documentRequestSchema).max(LOCATION_DETERMINANTS.length),
})
export type LocationRegisterView = z.infer<typeof locationRegisterViewSchema>

export const intakeViewSchema = z.object({
  projectId: z.guid(),
  status: z.enum(INTAKE_STATUSES),
  mode: z.enum(INTAKE_MODES),
  description: z.string().max(MAX_INTAKE_DESCRIPTION_LENGTH).nullable(),
  location: geocodeResultSchema.nullable(),
  closing: closingIntentSchema.nullable(),
  counts: z.object({
    documentsRead: count,
    unreadDocuments: count,
    suggested: count,
    contradictions: count,
    decisiveOpen: count,
  }),
  readingStartedAt: instant.nullable(),
  readingFinishedAt: instant.nullable(),
  summary: z.string().max(MAX_INTAKE_SUMMARY_LENGTH).nullable(),
  contradictions: z.array(suggestionSchema),
  questions: z.array(needSchema).max(MAX_INTAKE_NEEDS),
  openQuestions: z.array(needSchema).max(MAX_INTAKE_NEEDS),
  groups: z.array(suggestionGroupSchema),
  derivations: z.array(derivationReviewSchema),
  canDecide: z.boolean(),
  canComplete: z.boolean(),
  applicableLaw: projectLawSchema.optional(),
  locationRegister: locationRegisterViewSchema.optional(),
  setupPublished: z.boolean().optional(),
  readingProgress: z.object({
    documentsOpened: count,
    documentsTotal: count,
    site: z.object({
      federalState: z.string().max(200).nullable(),
      municipality: z.string().max(200).nullable(),
      address: z.string().max(500).nullable(),
      source: z.enum(['register', 'geocoder', 'document', 'person']).nullable(),
      confirmed: z.boolean(),
    }),
  }),
})
export type IntakeView = z.infer<typeof intakeViewSchema>
export type ReadingProgress = IntakeView['readingProgress']

export const intakeResponseSchema = z.object({ intake: intakeViewSchema })
export type IntakeResponse = z.infer<typeof intakeResponseSchema>

export const startIntakeRequestSchema = z
  .object({ scope: z.enum(['new', 'all']) })
  .strict()
export type StartIntakeRequest = z.infer<typeof startIntakeRequestSchema>

export const intakeDecisionSchema = z.discriminatedUnion('action', [
  z.object({ key, action: z.literal('confirm'), alternativeIndex: alternativeIndex.optional() }).strict(),
  z.object({ key, action: z.literal('dismiss'), alternativeIndex: alternativeIndex.optional() }).strict(),
  z.object({ key, action: z.literal('answer'), value: ProjectPrimitiveValueSchema }).strict(),
  z.object({ key, action: z.literal('unknown') }).strict(),
])
export type IntakeDecision = z.infer<typeof intakeDecisionSchema>

export const intakeDecisionsRequestSchema = z
  .object({ decisions: z.array(intakeDecisionSchema).min(1).max(MAX_INTAKE_DECISIONS) })
  .strict()

export const intakeDecisionResultSchema = z.object({
  key,
  ok: z.boolean(),
  reason: z.string().max(300).optional(),
})
export type IntakeDecisionResult = z.infer<typeof intakeDecisionResultSchema>

export const intakeDecisionsResponseSchema = z.object({
  results: z.array(intakeDecisionResultSchema).max(MAX_INTAKE_DECISIONS),
  intake: intakeViewSchema,
})
export type IntakeDecisionsResponse = z.infer<typeof intakeDecisionsResponseSchema>

export const recordEvidenceSchema = z
  .object({
    fileName: z.string().min(1).max(512),
    page: z.number().int().min(1).nullable(),
    quote: z.string().min(1).max(MAX_EVIDENCE_QUOTE_LENGTH),
  })
  .strict()

export const recordValueSchema = z
  .object({
    key,
    value: ProjectPrimitiveValueSchema,
    evidence: recordEvidenceSchema,
  })
  .strict()
export type RecordValue = z.infer<typeof recordValueSchema>

export const internalIntakeRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('needs'), jobId }).strict(),
  z
    .object({
      op: z.literal('record'),
      jobId,
      values: z.array(recordValueSchema).min(1).max(MAX_RECORD_VALUES),
    })
    .strict(),
  z
    .object({
      op: z.literal('withdraw'),
      jobId,
      keys: z.array(key).min(1).max(MAX_RECORD_VALUES),
    })
    .strict(),
  z
    .object({
      op: z.literal('progress'),
      jobId,
      filesOpened: z.array(z.string().min(1).max(512)).max(MAX_DOCUMENTS_READ),
    })
    .strict(),
  z
    .object({
      op: z.literal('finish'),
      jobId,
      summary: z.string().max(MAX_INTAKE_SUMMARY_LENGTH),
      documentsRead: z.array(z.string().min(1).max(512)).max(MAX_DOCUMENTS_READ),
      traceId: z.string().min(1).max(128).nullable(),
    })
    .strict(),
])
export type InternalIntakeRequest = z.infer<typeof internalIntakeRequestSchema>
export type InternalIntakeOp = InternalIntakeRequest['op']

export const internalIntakeNeedsResponseSchema = z.object({
  needs: z.array(needSchema).max(MAX_INTAKE_NEEDS),
  unreadFiles: z.array(z.string()).max(MAX_UNREAD_FILES),
  description: z.string().max(MAX_INTAKE_DESCRIPTION_LENGTH).nullable(),
  location: geocodeResultSchema.nullable(),
  mode: z.enum(INTAKE_MODES),
  previousSummary: z.string().max(MAX_INTAKE_SUMMARY_LENGTH).nullable(),
  setupPublished: z.boolean().optional(),
})
export type InternalIntakeNeedsResponse = z.infer<typeof internalIntakeNeedsResponseSchema>

export const recordResultSchema = z.object({
  key,
  outcome: z.enum(RECORD_OUTCOMES),
  reason: z.enum(RECORD_REFUSAL_REASONS).optional(),
})
export type RecordResult = z.infer<typeof recordResultSchema>

export const openedNeedSchema = needSchema.pick({ key: true, decisive: true })
export type OpenedNeed = z.infer<typeof openedNeedSchema>

export const internalIntakeRecordResponseSchema = z.object({
  results: z.array(recordResultSchema).max(MAX_RECORD_VALUES),
  opened: z.array(openedNeedSchema).max(MAX_INTAKE_NEEDS),
})
export type InternalIntakeRecordResponse = z.infer<typeof internalIntakeRecordResponseSchema>

export const withdrawResultSchema = z.object({
  key,
  outcome: z.enum(WITHDRAW_OUTCOMES),
  reason: z.enum(WITHDRAW_REFUSAL_REASONS).optional(),
})
export type WithdrawResult = z.infer<typeof withdrawResultSchema>

export const internalIntakeWithdrawResponseSchema = z.object({
  results: z.array(withdrawResultSchema).max(MAX_RECORD_VALUES),
})
export type InternalIntakeWithdrawResponse = z.infer<typeof internalIntakeWithdrawResponseSchema>

export const internalIntakeProgressResponseSchema = z.object({
  filesOpened: count,
})
export type InternalIntakeProgressResponse = z.infer<typeof internalIntakeProgressResponseSchema>

export const internalIntakeFinishResponseSchema = z.object({
  status: z.enum(INTAKE_STATUSES),
})
export type InternalIntakeFinishResponse = z.infer<typeof internalIntakeFinishResponseSchema>

export const INTERNAL_INTAKE_RESPONSE_SCHEMAS = {
  needs: internalIntakeNeedsResponseSchema,
  record: internalIntakeRecordResponseSchema,
  withdraw: internalIntakeWithdrawResponseSchema,
  progress: internalIntakeProgressResponseSchema,
  finish: internalIntakeFinishResponseSchema,
} as const satisfies Record<InternalIntakeOp, z.ZodType>

export type InternalIntakeResponse<Op extends InternalIntakeOp = InternalIntakeOp> = z.infer<
  (typeof INTERNAL_INTAKE_RESPONSE_SCHEMAS)[Op]
>
