import { z } from 'zod'
import { ProjectPrimitiveValueSchema } from './primitive-value'

export const MAX_PROFILE_EVIDENCE = 5
export const MAX_PROFILE_ALTERNATIVES = 5
export const MAX_EVIDENCE_QUOTE_LENGTH = 400
export const MAX_DERIVATION_INPUTS = 20

export const PROFILE_EVIDENCE_KINDS = ['document', 'geocoder', 'register', 'derivation', 'person'] as const
export type ProfileEvidenceKind = (typeof PROFILE_EVIDENCE_KINDS)[number]

export const DERIVATION_RULES = ['building_class', 'postal_code'] as const
export type DerivationRule = (typeof DERIVATION_RULES)[number]

const instant = z.string().datetime({ offset: true })

export const documentEvidenceSchema = z.object({
  kind: z.literal('document'),
  fileName: z.string().min(1).max(512),
  page: z.number().int().min(1).nullable(),
  quote: z.string().min(1).max(MAX_EVIDENCE_QUOTE_LENGTH),
})

export const geocoderEvidenceSchema = z.object({
  kind: z.literal('geocoder'),
  provider: z.literal('photon'),
  label: z.string().min(1).max(300),
  resolvedAt: instant,
})

export const registerEvidenceSchema = z.object({
  kind: z.literal('register'),
  addressId: z.string().min(1).max(100),
  label: z.string().min(1).max(300),
  referenceDate: z.string().max(10),
  resolvedAt: instant,
})

export const derivationInputSchema = z.object({
  key: z.string().min(1).max(200),
  value: ProjectPrimitiveValueSchema,
  suggested: z.boolean(),
})

export const derivationEvidenceSchema = z.object({
  kind: z.literal('derivation'),
  rule: z.enum(DERIVATION_RULES),
  citation: z.string().min(1).max(300),
  inputs: z.array(derivationInputSchema).max(MAX_DERIVATION_INPUTS),
})

export const personEvidenceSchema = z.object({
  kind: z.literal('person'),
  userId: z.string().min(1).max(256),
  at: instant,
})

export const profileEvidenceSchema = z.discriminatedUnion('kind', [
  documentEvidenceSchema,
  geocoderEvidenceSchema,
  registerEvidenceSchema,
  derivationEvidenceSchema,
  personEvidenceSchema,
])
export type ProfileEvidence = z.infer<typeof profileEvidenceSchema>
export type DocumentEvidence = z.infer<typeof documentEvidenceSchema>
export type DerivationEvidence = z.infer<typeof derivationEvidenceSchema>
export type DerivationInput = z.infer<typeof derivationInputSchema>

export const profileAlternativeSchema = z.object({
  value: ProjectPrimitiveValueSchema,
  evidence: z.array(profileEvidenceSchema).max(MAX_PROFILE_EVIDENCE),
  recordedAt: instant,
})
export type ProfileAlternative = z.infer<typeof profileAlternativeSchema>

export const profileEvidenceFields = {
  evidence: z.array(profileEvidenceSchema).max(MAX_PROFILE_EVIDENCE).optional().catch(undefined),
  alternatives: z.array(profileAlternativeSchema).max(MAX_PROFILE_ALTERNATIVES).optional().catch(undefined),
}
