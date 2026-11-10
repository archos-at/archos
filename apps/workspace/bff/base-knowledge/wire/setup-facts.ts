/**
 * The wire of the two setup records (design §3.7, ADR-0169): what a country
 * asks when a project is set up there, held as rulesets beside its decision
 * tables, so a country's setup is data a release changes rather than
 * TypeScript options a deploy changes.
 *
 * - `fact_definitions.v1`: the facts a country's setup knows, with their type
 *   and the codes a fact may take; the subdivisions a site is placed in (the
 *   Bundesländer, the Länder, the cantons); the derivations it runs, each with
 *   the Fundstelle its evidence cites.
 * - `fact_sources.v1`: where a fact is found when nobody has it yet: the
 *   document to request, why, the law behind it, what differs per subdivision
 *   or municipality, and when the request applies at all.
 *
 * Pure zod: the store, the setup code and the routes read one shape. No text
 * from these records reaches a prompt (design §3.7, "no free text from records
 * reaches a prompt"); it reaches a person, in the setup's own views.
 */

import { z } from 'zod'
import { FACT_TYPES, SETUP_DETERMINANTS } from './vocab'

const factKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'a snake_case fact key')
const token = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'a snake_case token')
/** ISO 3166-1 or -2, or `<CC>:<scheme>:<code>`; the same form a ruleset's territories take. */
const territoryId = z
  .string()
  .regex(/^(?:[A-Z]{2}(?:-[A-Z0-9]{1,3})?|[A-Z]{2}:[a-z][a-z0-9_]{0,15}:[A-Za-z0-9_-]{1,40})$/)
const label = z.string().trim().min(1).max(200)
const prose = z.string().trim().min(1).max(1000)

/** One fact a country's setup knows: the type a decision table reads it as, and for a code, the codes it may take. */
export const factDefinitionSchema = z
  .object({
    key: factKey,
    label,
    type: z.enum(FACT_TYPES),
    unit: z.string().min(1).max(40).optional().describe('UCUM, e.g. m or m2.'),
    codes: z
      .array(token)
      .min(1)
      .max(100)
      .optional()
      .describe('For a code: the tokens it may take. Any other token reads as unknown, never as a value.'),
    existingKey: factKey
      .optional()
      .describe('The key the Bestand holds this fact under today: a classification runs once on these, once on the planned values.'),
  })
  .strict()
export type FactDefinition = z.infer<typeof factDefinitionSchema>

/**
 * A subdivision a site is placed in, by the token the profile stores and the
 * territory it is. A city-state (Wien, Berlin) names itself as its municipality,
 * so its own law applies without a geocoder saying so.
 */
export const subdivisionSchema = z
  .object({ token, territoryId, label, municipality: label.optional() })
  .strict()
export type Subdivision = z.infer<typeof subdivisionSchema>

/**
 * A derivation the country runs on its classification ruleset: the rule it
 * writes, the Fundstelle its evidence names, and what each of the table's codes
 * means for the profile: a class number, the high-rise code that has no class,
 * the code for a structure that is no building at all. A code the table can
 * answer but this list does not name is no class (fail closed).
 */
export const derivationDefinitionSchema = z
  .object({
    rule: token,
    citation: z.string().trim().min(1).max(300),
    values: z.record(z.string().min(1).max(80), z.number().int().min(1).max(9)),
    highRise: z.string().min(1).max(80).optional(),
    notApplicable: z.string().min(1).max(80).optional(),
  })
  .strict()
export type DerivationDefinition = z.infer<typeof derivationDefinitionSchema>

export const factDefinitionsSchema = z
  .object({
    /** The profile key that names the subdivision (`federal_state`), its options, and the one that places a site outside. */
    subdivisions: z
      .object({
        factKey,
        label,
        options: z.array(subdivisionSchema).min(1).max(60),
        outside: z.object({ token, label }).strict().optional(),
      })
      .strict()
      .optional(),
    facts: z.array(factDefinitionSchema).max(200).default([]),
    procedureTypes: z.array(z.object({ token, label }).strict()).max(40).default([]),
    derivations: z.array(derivationDefinitionSchema).max(20).default([]),
  })
  .strict()
  .superRefine((payload, context) => {
    const once = (values: readonly string[], path: (string | number)[]) => {
      const seen = new Set<string>()
      values.forEach((value, index) => {
        if (seen.has(value)) context.addIssue({ code: 'custom', path: [...path, index], message: `${value} repeats` })
        seen.add(value)
      })
    }
    once(payload.facts.map((fact) => fact.key), ['facts'])
    once(payload.derivations.map((derivation) => derivation.rule), ['derivations'])
    if (payload.subdivisions) {
      once(payload.subdivisions.options.map((option) => option.token), ['subdivisions', 'options'])
      if (payload.subdivisions.options.some((option) => option.token === payload.subdivisions?.outside?.token))
        context.addIssue({ code: 'custom', path: ['subdivisions', 'outside'], message: 'the outside token is also a subdivision' })
    }
    payload.facts.forEach((fact, index) => {
      if (fact.codes && fact.type !== 'code' && fact.type !== 'codes')
        context.addIssue({ code: 'custom', path: ['facts', index, 'codes'], message: 'only a code or codes fact has codes' })
    })
  })
export type FactDefinitions = z.infer<typeof factDefinitionsSchema>
export type FactDefinitionsInput = z.input<typeof factDefinitionsSchema>

/**
 * Where a fact's law comes from. `needsReview`: the source names the law but
 * nobody has checked the cited section against its current text; the request
 * stays conservative (it asks rather than concludes).
 */
export const factSourceCitationSchema = z
  .object({
    title: z.string().min(1).max(300),
    reference: z.string().min(1).max(300).optional(),
    needsReview: z.boolean(),
  })
  .strict()
export type FactSourceCitation = z.infer<typeof factSourceCitationSchema>

/** When a request applies. Each clause means „includes any of"; an input not known yet counts as applying. */
export const appliesWhenSchema = z
  .object({
    projectTypes: z.array(token).min(1).max(20).optional(),
    uses: z.array(token).min(1).max(40).optional(),
    /** Only for a Bauwerk that is a Bestand; its keys are then per such Bauwerk. */
    existing: z.literal(true).optional(),
  })
  .strict()

/** What differs in one subdivision: the document's name there, the reason there, the law there. */
export const factSourceVariantSchema = z
  .object({
    document: label.optional(),
    reason: prose.optional(),
    sources: z.array(factSourceCitationSchema).min(1).max(6),
  })
  .strict()

/** A municipality with law of its own on top of its subdivision's: a sentence added to the reason. */
export const municipalityAdditionSchema = z
  .object({
    territoryId,
    /** The municipality's name as the geocoder gives it („Graz"). */
    municipality: label,
    addition: prose,
    sources: z.array(factSourceCitationSchema).min(1).max(3),
  })
  .strict()

/**
 * One request: the facts it settles, the document that holds them, and why.
 * With a `determinant` it is a location determinant the setup's register lists
 * on its own; without, it is asked only when a decision waits for its facts.
 */
export const factSourceSchema = z
  .object({
    id: token,
    determinant: z.enum(SETUP_DETERMINANTS).optional(),
    label,
    factKeys: z.array(factKey).min(1).max(20),
    appliesWhen: appliesWhenSchema.default({}),
    request: z.object({ document: label, reason: prose }).strict(),
    sources: z.array(factSourceCitationSchema).min(1).max(6),
    variants: z.record(territoryId, factSourceVariantSchema).default({}),
    additions: z.array(municipalityAdditionSchema).max(50).default([]),
  })
  .strict()
export type FactSource = z.infer<typeof factSourceSchema>

export const factSourcesSchema = z
  .object({ entries: z.array(factSourceSchema).min(1).max(100) })
  .strict()
  .superRefine((payload, context) => {
    const ids = new Set<string>()
    payload.entries.forEach((entry, index) => {
      if (ids.has(entry.id)) context.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: `${entry.id} repeats` })
      ids.add(entry.id)
    })
  })
export type FactSources = z.infer<typeof factSourcesSchema>
export type FactSourcesInput = z.input<typeof factSourcesSchema>
