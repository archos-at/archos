import { z } from 'zod'
import { useApplicabilitySchema } from '../wire/project-law'
import { CONNECTING_FACTORS, COVERAGE_LEVELS, EDITION_ROLES, GATE_STATES, SITE_UNKNOWN_REASONS, TEXT_STATUSES } from '../wire/vocab'
import { MAX_SOURCE_REFS, sourceRefSchema } from '../chain/source-refs'

export const MAX_CONTEXT_USES = 500

export const MAX_ISSUER_CHARS = 200

export { GATE_STATES, type GateState } from '../wire/vocab'

export { SITE_UNKNOWN_REASONS } from '../wire/vocab'

export const SITE_CERTAINTY = ['verified', 'unverified'] as const

export const USE_LABELS = ['uncurated_source', 'check_overdue', 'unchecked_since', 'depends_on_connecting_factor'] as const

export const FRESHNESS = ['current', 'check_due', 'newer_known', 'superseded'] as const

export const leafSchema = z
  .object({
    territoryId: z.string(),
    country: z.string().regex(/^[A-Z]{2}$/),
    certainty: z.enum(SITE_CERTAINTY),
    entitled: z.boolean(),
    coverage: z.enum(COVERAGE_LEVELS).nullable(),
    municipalLaw: z.boolean().nullable(),
  })
  .strict()

export const gateSchema = z
  .object({
    state: z.enum(GATE_STATES),
    reason: z.enum(SITE_UNKNOWN_REASONS).nullable(),
    leaves: z.array(leafSchema).max(8),
  })
  .strict()


export const MAX_CONTEXT_TEXT_CHARS = 16_000

export const useRouteSchema = z
  .object({
    workId: z.string(),
    designation: z.string().nullable(),
    editionLabel: z.string().nullable(),
    provision: z.string().max(300).nullable(),
  })
  .strict()

export const contextUseSchema = z
  .object({
    workId: z.string(),
    editionId: z.string().nullable(),
    role: z.enum(EDITION_ROLES),
    qualifier: z.enum(['uncurated', 'office_maintained']).nullable(),
    via: z.enum(['territory', 'relation', 'none']),
    route: useRouteSchema.nullable(),
    roleSince: z.iso.date().nullable(),
    date: z.iso.date(),
    freshness: z.enum(FRESHNESS),
    lastCheckedAt: z.iso.date().nullable(),
    connectsBy: z.array(z.enum(CONNECTING_FACTORS)).min(1),
    labels: z.array(z.enum(USE_LABELS)).max(USE_LABELS.length),
    corpusFiles: z.array(z.string()),
    designation: z.string().nullable(),
    editionLabel: z.string().nullable(),
    issuer: z.string().max(MAX_ISSUER_CHARS).nullable(),
    sourceRefs: z.array(sourceRefSchema).max(MAX_SOURCE_REFS),
    sourceUrl: z.string().max(2000).nullable(),
    language: z.string().max(35).nullable(),
    textStatus: z.enum(TEXT_STATUSES).nullable(),
    applicability: useApplicabilitySchema.nullable(),
  })
  .strict()

export const procedureContextSchema = z
  .object({
    id: z.string(),
    procedureType: z.string().nullable(),
    filedOn: z.string().nullable(),
    decidedOn: z.string().nullable(),
    referenceDates: z.record(
      z.string(),
      z.object({ date: z.iso.date().nullable(), basis: z.enum(['undetermined', 'filed_on']) }).strict(),
    ),
  })
  .strict()

export const MAX_CONTEXT_SOURCES = 8
export const MAX_SOURCE_CONFIG_CHARS = 64_000

export const contextSourceSchema = z
  .object({
    key: z.string().min(1).max(80),
    revisionId: z.string().min(1).max(80),
    country: z.string().regex(/^[A-Z]{2}$/),
    config: z.record(z.string(), z.unknown()),
  })
  .strict()

export const knowledgeContextSchema = z
  .object({
    gate: gateSchema,
    packs: z.array(z.object({ packId: z.string(), seq: z.number().int().nonnegative() }).strict()).max(16),
    chains: z.record(z.string(), z.array(z.string()).max(16)),
    date: z.iso.date(),
    procedures: z.array(procedureContextSchema).max(4),
    uses: z.array(contextUseSchema).max(MAX_CONTEXT_USES),
    text: z.string().max(MAX_CONTEXT_TEXT_CHARS).nullable(),
    retrieval: z.object({ countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(300) }).strict(),
    updatedSinceLastAnswer: z.array(z.string()).max(16).optional(),
    undetermined: z
      .array(
        z
          .object({ workId: z.string(), reason: z.enum(['history_not_held', 'edition_dates_unknown', 'ambiguous_editions']) })
          .strict(),
      )
      .max(MAX_CONTEXT_USES)
      .optional(),
    sources: z.array(contextSourceSchema).max(MAX_CONTEXT_SOURCES).optional(),
    sourcesDropped: z.array(z.string().max(80)).max(MAX_CONTEXT_SOURCES).optional(),
  })
  .strict()

export type Leaf = z.infer<typeof leafSchema>
export type Gate = z.infer<typeof gateSchema>
export type UseRoute = z.infer<typeof useRouteSchema>
export type ContextUse = z.infer<typeof contextUseSchema>
export type ProcedureContext = z.infer<typeof procedureContextSchema>
export type KnowledgeContext = z.infer<typeof knowledgeContextSchema>
export type ContextSource = z.infer<typeof contextSourceSchema>
export type UseLabel = (typeof USE_LABELS)[number]
