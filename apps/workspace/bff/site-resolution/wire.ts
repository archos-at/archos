/**
 * The site resolution contract (ADR-0172, ADR-0055): `GET /api/sites/resolve`
 * answers `siteResolutionSchema`, `POST /api/projects/[id]/site` takes
 * `projectSiteSetBodySchema`. No `server-only`: the browser imports it.
 *
 * Fail closed: a site is `verified` only when exactly one address of an
 * official register in the cell matches. Anything else is `unverified`, with
 * the reason and the register's candidates, and nothing is guessed.
 */

import { z } from 'zod'

export const SITE_RESOLVE_MAX_CANDIDATES = 8

export const siteResolveQuerySchema = z.object({
  q: z.string().trim().min(3).max(200).describe('The address as typed.'),
})
export type SiteResolveQuery = z.infer<typeof siteResolveQuerySchema>

/** One body competent for the site, as the competence ruleset names it. */
export const competentBodySchema = z.object({
  authorityId: z.string(),
  /** The authority record's name, or null when no record this office sees carries that id. */
  name: z.string().nullable(),
  role: z.enum(['decides', 'consents', 'checks']),
})

/**
 * The competent authority (ADR-0166): `decided` by a competence ruleset in
 * force, or `undetermined` with the evaluator's reason. Never a default:
 * `no_rule` means no ruleset covers the site's chain yet.
 */
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
    reason: z.enum(['no_rule', 'unknown_inputs', 'no_row_applies', 'ambiguous_rules', 'rules_unreadable']),
    unknownInputs: z.array(z.string()).optional(),
  }),
])
export type SiteAuthority = z.infer<typeof siteAuthoritySchema>

const territorySchema = z.object({ territoryId: z.string(), name: z.string() })

/** An address of an official register, placed in the territory tree. */
export const registerSiteSchema = z.object({
  /** `<register>:<the register's own id>`, e.g. `at-bev:5734380`: what `project-site-set` takes back. */
  addressId: z.string(),
  /** One display line: "Herrengasse 16, 8010 Graz". */
  label: z.string(),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2),
  state: territorySchema.extend({
    /** The intake's `federal_state` token (`styria`), or null outside Austria. */
    federalState: z.string().nullable(),
  }).nullable(),
  municipality: territorySchema.extend({ code: z.string() }),
  locality: z.string().nullable(),
  postcode: z.string(),
  /** Leaf first: municipality, state, country. What the rulesets select by. */
  chain: z.array(z.string()).min(1),
  register: z.object({
    id: z.string(),
    referenceDate: z.string(),
    attribution: z.string(),
  }),
  authority: siteAuthoritySchema,
})
export type RegisterSite = z.infer<typeof registerSiteSchema>

/**
 * Why a typed address stays unverified:
 * - `incomplete`: the line names no street and house number, or no place: a street and
 *   number, with or without a four-digit postcode (Switzerland and Liechtenstein have them
 *   too), could be in a country this cell has no register for;
 * - `no_register`: the cell hosts no register for the stated country, or none is imported yet;
 * - `no_register_hit`: the register holds no such address;
 * - `ambiguous`: several addresses of one municipality match;
 * - `multi_leaf`: matches lie in several municipalities (design 5.2);
 * - `conflict`: the postcode names an address, and the place another municipality.
 */
export const UNVERIFIED_REASONS = ['incomplete', 'no_register', 'no_register_hit', 'ambiguous', 'multi_leaf', 'conflict'] as const

export const siteResolutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('verified'), typed: z.string(), site: registerSiteSchema }),
  z.object({
    status: z.literal('unverified'),
    typed: z.string(),
    reason: z.enum(UNVERIFIED_REASONS),
    /** The country the line states (ISO alpha-2), when it states one. */
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
