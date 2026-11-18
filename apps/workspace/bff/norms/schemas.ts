import { z } from 'zod'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'

export const NORM_RANKS = [
  'federal_law',
  'state_law',
  'ordinance',
  'authority_info',
  'external_standard',
] as const
export type NormRank = (typeof NORM_RANKS)[number]

export const LEGACY_NORM_RANK: Readonly<Record<string, NormRank>> = {
  bundesgesetz: 'federal_law',
  landesgesetz: 'state_law',
  verordnung: 'ordinance',
  behoerdliche_info: 'authority_info',
  norm_extern: 'external_standard',
}

export const normRankSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && Object.hasOwn(LEGACY_NORM_RANK, value) ? LEGACY_NORM_RANK[value] : value,
  z.enum(NORM_RANKS)
)

export const LAW_RANKS = ['federal_law', 'state_law', 'ordinance'] as const
export type LawRank = (typeof LAW_RANKS)[number]

export function isLawRank(rank: NormRank): rank is LawRank {
  return (LAW_RANKS as readonly string[]).includes(rank)
}

const renameLegacyStatuteNumber = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || !('gesetzesnummer' in value)) return value
  const { gesetzesnummer, ...rest } = value as Record<string, unknown>
  return 'statute_number' in rest ? rest : { ...rest, statute_number: gesetzesnummer }
}

export const normVerifySeedSchema = z.preprocess(
  renameLegacyStatuteNumber,
  z.object({
    title_query: z.string().default(''),
    expect: z.string().optional(),
    exclude: z.array(z.string()).default([]),
    statute_number: z.string().optional(),
  })
)
export type NormVerifySeed = z.infer<typeof normVerifySeedSchema>

const renameLegacyNormEntry = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || !('bundesland' in value)) return value
  const { bundesland, ...rest } = value as Record<string, unknown>
  return 'federal_state' in rest ? rest : { ...rest, federal_state: bundesland }
}

export const normEntrySchema = z.preprocess(renameLegacyNormEntry, z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  short: z.string().min(1),
  rank: normRankSchema,
  federal_state: z.string().default(''),
  topics: z.array(z.string()).default([]),
  relevance: z.string().default(''),
  application: z.string().default(''),
  document_number: z.string().default(''),
  source_url: z.string().default(''),
  citation_url: z.string().default(''),
  full_law_url: z.string().default(''),
  aliases: z.array(z.string()).default([]),
  binding_note: z.string().nullish(),
  review_note: z.string().nullish(),
  verify: normVerifySeedSchema.nullish(),
  verified_at: z.string().default(''),
}))
export type NormEntry = z.infer<typeof normEntrySchema>

function renameLegacyStateKeys(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([token, name]) => [normalizeProfileToken('federal_state', token), name])
  )
}

export const normsFileSchema = z.object({
  version: z.literal(1),
  corpus_collection: z.string().default('oib_knowledge'),
  language: z.string().default(''),
  states: z.preprocess(renameLegacyStateKeys, z.record(z.string(), z.string().nullable()).default({})),
  corpus_note: z.string().default(''),
  doctrine: z.string().default(''),
  parcel_tags: z.array(z.string()).default([]),
  entries: z.array(normEntrySchema),
})
export type NormsFile = z.infer<typeof normsFileSchema>

export const normRegistryEnvelopeSchema = z.object({
  version: z.number(),
  registry: normsFileSchema,
})
export type NormRegistryEnvelope = z.infer<typeof normRegistryEnvelopeSchema>

export const putNormRegistryBodySchema = normRegistryEnvelopeSchema
export type PutNormRegistryBody = z.infer<typeof putNormRegistryBodySchema>

export const verifyNormRequestSchema = z.preprocess(
  renameLegacyStatuteNumber,
  z.object({
    title_query: z.string().min(1),
    application: z.string().min(1),
    federal_state: z.string().optional(),
    expect: z.string().optional(),
    exclude: z.array(z.string()).optional(),
    statute_number: z.string().optional(),
  })
)
export type VerifyNormRequest = z.infer<typeof verifyNormRequestSchema>

export const verifyCandidateSchema = z.object({
  title: z.string(),
  document_number: z.string(),
  citation_url: z.string(),
  full_law_url: z.string(),
})
export type VerifyCandidate = z.infer<typeof verifyCandidateSchema>

export const verifyNormResponseSchema = z.object({
  candidates: z.array(verifyCandidateSchema),
  verified_at: z.string(),
})
export type VerifyNormResponse = z.infer<typeof verifyNormResponseSchema>
