import { z } from 'zod'

export const SITE_RESOLVE_MAX_CANDIDATES = 8

export const siteResolveQuerySchema = z.object({
  q: z.string().trim().min(3).max(200).describe('The address as typed.'),
})
export type SiteResolveQuery = z.infer<typeof siteResolveQuerySchema>

export const competentBodySchema = z.object({
  authorityId: z.string(),
  name: z.string().nullable(),
  role: z.enum(['decides', 'consents', 'checks']),
})

export const siteAuthoritySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('decided'),
    bodies: z.array(competentBodySchema).min(1),
    rulesetId: z.string(),
    territoryId: z.string(),
    citation: z.string().nullable(),
  }),
  z.object({
    status: z.literal('undetermined'),
    reason: z.enum(['no_territory', 'no_rule', 'unknown_inputs', 'no_row_applies', 'ambiguous_rules', 'rules_unreadable']),
    unknownInputs: z.array(z.string()).optional(),
  }),
])
export type SiteAuthority = z.infer<typeof siteAuthoritySchema>

const territorySchema = z.object({ territoryId: z.string(), name: z.string() })

export const registerSiteSchema = z.object({
  addressId: z.string(),
  label: z.string(),
  country: z.string().length(2),
  state: territorySchema.extend({
    federalState: z.string().nullable(),
  }).nullable(),
  municipality: territorySchema.extend({ code: z.string() }),
  locality: z.string().nullable(),
  postcode: z.string(),
  chain: z.array(z.string()),
  register: z.object({
    id: z.string(),
    referenceDate: z.string(),
    attribution: z.string(),
  }),
  authority: siteAuthoritySchema,
})
export type RegisterSite = z.infer<typeof registerSiteSchema>

export const UNVERIFIED_REASONS = ['incomplete', 'no_register', 'no_register_hit', 'ambiguous', 'multi_leaf', 'conflict'] as const

export const siteResolutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('verified'), typed: z.string(), site: registerSiteSchema }),
  z.object({
    status: z.literal('unverified'),
    typed: z.string(),
    reason: z.enum(UNVERIFIED_REASONS),
    statedCountry: z.string().nullable(),
    candidates: z.array(registerSiteSchema).max(SITE_RESOLVE_MAX_CANDIDATES),
  }),
])
export type SiteResolution = z.infer<typeof siteResolutionSchema>

export const projectSiteSetBodySchema = z
  .object({
    addressId: z
      .string()
      .regex(/^[a-z]{2}-[a-z0-9-]{2,30}:[A-Za-z0-9._-]{1,64}$/)
      .optional()
      .describe('From site-resolve.'),
    typed: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .optional()
      .describe('The address as typed.'),
  })
  .strict()
export type ProjectSiteSetBody = z.infer<typeof projectSiteSetBodySchema>

export const projectSiteSetResponseSchema = z.object({
  resolution: siteResolutionSchema,
  profileVersion: z.number().int(),
})
export type ProjectSiteSetResponse = z.infer<typeof projectSiteSetResponseSchema>
