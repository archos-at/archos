import { z } from 'zod'
import { PERMIT_RECORD_KINDS, PERMIT_REQUIREMENT_KINDS } from '@/lib/db/schema/permit-records'
import { DISCIPLINE_TAGS, DOCUMENT_TYPE_TAGS } from '@/lib/documents/tag-vocabulary'
import { experienceVocabulary } from '@/lib/project-experience/vocabulary'
import { normalizeProfileBaseKey, normalizeProfileToken } from '@/lib/project-profile/legacy-names'
import { PROJECT_STATUSES, type ProjectStatus } from '@/lib/projects/project-status'

export const CROSS_PROJECT_PAGE_PROJECTS = 40
export const CROSS_PROJECT_MAX_NAMED = 20
export const CROSS_PROJECT_MAX_HITS = 20
export const CROSS_PROJECT_MAX_LISTED = 30
export const CROSS_PROJECT_MAX_PERMITS = 8
export const CROSS_PROJECT_MAX_PERMIT_REQUIREMENTS = 6

export { PROJECT_STATUSES, type ProjectStatus }

export const CROSS_PROJECT_SCOPES = ['similar', 'closed', 'all', 'named'] as const
export type CrossProjectScope = (typeof CROSS_PROJECT_SCOPES)[number]

export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), {
    message: 'Not a calendar day',
  })

function factTokens(key: 'federal_state' | 'construction_method' | 'uses' | 'work_type'): [string, ...string[]] {
  const tokens = experienceVocabulary()[key].options.map((option) => option.token)
  const kept = key === 'federal_state' ? tokens.filter((token) => token !== 'outside_austria') : tokens
  const [first, ...rest] = kept
  if (first === undefined) throw new Error(`The intake definition has no tokens for ${key}`)
  return [first, ...rest]
}

export const CROSS_PROJECT_FACT_FEDERAL_STATES = factTokens('federal_state')
export const CROSS_PROJECT_FACT_CONSTRUCTION_METHODS = factTokens('construction_method')
export const CROSS_PROJECT_FACT_USES = factTokens('uses')
export const CROSS_PROJECT_FACT_WORK_TYPES = factTokens('work_type')

function renameLegacyFactFilter(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, values]) => {
      const renamed = normalizeProfileBaseKey(key)
      return [
        renamed,
        Array.isArray(values)
          ? values.map((item) => (typeof item === 'string' ? normalizeProfileToken(renamed, item) : item))
          : values,
      ]
    })
  )
}

export const crossProjectFactsSchema = z.preprocess(
  renameLegacyFactFilter,
  z
  .object({
    federal_state: z.array(z.enum(CROSS_PROJECT_FACT_FEDERAL_STATES)).min(1).max(CROSS_PROJECT_FACT_FEDERAL_STATES.length),
    building_class: z.array(z.number().int().min(1).max(5)).min(1).max(5),
    construction_method: z.array(z.enum(CROSS_PROJECT_FACT_CONSTRUCTION_METHODS)).min(1).max(CROSS_PROJECT_FACT_CONSTRUCTION_METHODS.length),
    uses: z.array(z.enum(CROSS_PROJECT_FACT_USES)).min(1).max(CROSS_PROJECT_FACT_USES.length),
    work_type: z.array(z.enum(CROSS_PROJECT_FACT_WORK_TYPES)).min(1).max(CROSS_PROJECT_FACT_WORK_TYPES.length),
  })
  .partial()
  .strict()
)
export type CrossProjectFacts = z.infer<typeof crossProjectFactsSchema>

const answerMessageId = z.guid().nullish()

export const crossProjectSearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(500),
  scope: z.enum(CROSS_PROJECT_SCOPES).default('similar'),
  projectIds: z.array(z.guid()).max(CROSS_PROJECT_MAX_NAMED).default([]),
  documentTypes: z.array(z.enum(DOCUMENT_TYPE_TAGS)).max(DOCUMENT_TYPE_TAGS.length).default([]),
  disciplines: z.array(z.enum(DISCIPLINE_TAGS)).max(DISCIPLINE_TAGS.length).default([]),
  from: isoDay.optional(),
  to: isoDay.optional(),
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(CROSS_PROJECT_MAX_HITS).default(10),
  answerMessageId,
  openFoldersOnly: z.boolean().default(false),
  order: z.array(z.guid()).max(CROSS_PROJECT_MAX_NAMED).default([]),
  projectFacts: crossProjectFactsSchema.optional(),
})
export type CrossProjectSearchRequest = z.infer<typeof crossProjectSearchRequestSchema>

export const crossProjectRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(PROJECT_STATUSES),
  federal_state: z.string().nullable(),
})
export type CrossProjectRef = z.infer<typeof crossProjectRefSchema>

export const crossProjectHitSchema = z.object({
  project: crossProjectRefSchema,
  documentId: z.string(),
  filename: z.string(),
  title: z.string().nullable(),
  collection: z.string(),
  page: z.number().int().nullable(),
  snippet: z.string(),
  score: z.number(),
  tags: z.array(z.string()),
  uploadedAt: z.string(),
})
export type CrossProjectHit = z.infer<typeof crossProjectHitSchema>

export const crossProjectDecisionSchema = z.object({
  project: crossProjectRefSchema,
  collection: z.string(),
  kind: z.enum(['decision', 'constraint']),
  content: z.string(),
  origin: z.enum(['person', 'documents', 'agent']),
  confirmed: z.boolean(),
  evidence: z.array(z.object({ fileName: z.string(), page: z.string().nullable() })),
  recordedAt: z.string(),
  restricted: z.boolean(),
})
export type CrossProjectDecision = z.infer<typeof crossProjectDecisionSchema>

export const crossProjectPermitRequirementSchema = z.object({
  kind: z.enum(PERMIT_REQUIREMENT_KINDS),
  content: z.string(),
  evidence: z.string().nullable(),
  legalBasis: z.string().nullable(),
  page: z.number().int().nullable(),
})
export type CrossProjectPermitRequirement = z.infer<typeof crossProjectPermitRequirementSchema>

export const crossProjectPermitSchema = z.object({
  project: crossProjectRefSchema,
  collection: z.string(),
  fileName: z.string(),
  kind: z.enum(PERMIT_RECORD_KINDS),
  authority: z.string().nullable(),
  municipality: z.string().nullable(),
  issuedOn: isoDay.nullable(),
  reference: z.string().nullable(),
  requirements: z.array(crossProjectPermitRequirementSchema).max(CROSS_PROJECT_MAX_PERMIT_REQUIREMENTS),
  restricted: z.boolean(),
})
export type CrossProjectPermit = z.infer<typeof crossProjectPermitSchema>

export const crossProjectSearchResponseSchema = z.object({
  decisions: z.array(crossProjectDecisionSchema),
  permits: z.array(crossProjectPermitSchema).max(CROSS_PROJECT_MAX_PERMITS),
  hits: z.array(crossProjectHitSchema),
  projectsInScope: z.number().int(),
  projectsSearched: z.number().int(),
  nextOffset: z.number().int().nullable(),
})
export type CrossProjectSearchResponse = z.infer<typeof crossProjectSearchResponseSchema>

export const crossProjectListRequestSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  limit: z.number().int().min(1).max(CROSS_PROJECT_MAX_LISTED).default(10),
  projectFacts: crossProjectFactsSchema.optional(),
  answerMessageId,
})
export type CrossProjectListRequest = z.infer<typeof crossProjectListRequestSchema>

export const crossProjectListedSchema = crossProjectRefSchema.extend({
  collection: z.string(),
  address: z.string().nullable(),
  period: z.object({ start: z.string(), end: z.string().nullable() }),
  oibEdition: z.object({ value: z.string(), confirmed: z.boolean() }).nullable(),
  current: z.boolean(),
})
export type CrossProjectListed = z.infer<typeof crossProjectListedSchema>

export const crossProjectListResponseSchema = z.object({
  projects: z.array(crossProjectListedSchema),
  total: z.number().int(),
})
export type CrossProjectListResponse = z.infer<typeof crossProjectListResponseSchema>

export const crossProjectBriefRequestSchema = z.object({
  projectId: z.guid(),
  answerMessageId,
})
export type CrossProjectBriefRequest = z.infer<typeof crossProjectBriefRequestSchema>

export const crossProjectBriefResponseSchema = z.object({
  project: crossProjectListedSchema,
  summary: z.string().nullable(),
  facts: z.string(),
})
export type CrossProjectBriefResponse = z.infer<typeof crossProjectBriefResponseSchema>

export const CROSS_PROJECT_WIRE_SCHEMAS = {
  CrossProjectSearchRequest: crossProjectSearchRequestSchema,
  CrossProjectSearchResponse: crossProjectSearchResponseSchema,
  CrossProjectPermit: crossProjectPermitSchema,
  CrossProjectListRequest: crossProjectListRequestSchema,
  CrossProjectListResponse: crossProjectListResponseSchema,
  CrossProjectBriefRequest: crossProjectBriefRequestSchema,
  CrossProjectBriefResponse: crossProjectBriefResponseSchema,
} as const
