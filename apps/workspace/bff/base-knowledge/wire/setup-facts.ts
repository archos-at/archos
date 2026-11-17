import safeRegex from 'safe-regex2'
import { z } from 'zod'
import { FACT_TYPES, SETUP_DETERMINANTS } from './vocab'

const factKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'a snake_case fact key')
const token = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'a snake_case token')
const territoryId = z
  .string()
  .regex(/^(?:[A-Z]{2}(?:-[A-Z0-9]{1,3})?|[A-Z]{2}:[a-z][a-z0-9_]{0,15}:[A-Za-z0-9_-]{1,40})$/)
const label = z.string().trim().min(1).max(200)
const prose = z.string().trim().min(1).max(1000)

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

export const subdivisionSchema = z
  .object({ token, territoryId, label, municipality: label.optional() })
  .strict()
export type Subdivision = z.infer<typeof subdivisionSchema>

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

export function compileRecordPattern(pattern: string): RegExp | null {
  if (pattern.length < 3 || pattern.length > 200 || !pattern.startsWith('^') || !pattern.endsWith('$')) return null
  try {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- validated just below: anchored, at most 200 characters, safe-regex2
    const compiled = new RegExp(pattern)
    return safeRegex(compiled) ? compiled : null
  } catch {
    return null
  }
}

const patternSchema = z
  .string()
  .min(3)
  .max(200)
  .refine((pattern) => pattern.startsWith('^') && pattern.endsWith('$'), 'anchored: starts with ^ and ends with $')
  .refine((pattern) => compileRecordPattern(pattern) !== null, 'a regular expression that compiles and is safe to run (no nested repetition)')

export const addressRegisterSchema = z
  .object({
    id: z.string().regex(/^[a-z]{2}-[a-z0-9-]{1,40}$/, '`<country>-<publisher>` in lower case, e.g. at-bev'),
    publisher: label.describe('Who publishes it, for a person reading where an address was confirmed.'),
    municipalityTerritory: z
      .string()
      .regex(/^[A-Z]{2}:[a-z][a-z0-9_]{0,15}:\{code\}$/, 'a territory id template ending with {code}, e.g. AT:gkz:{code}')
      .describe('The territory id of a municipality by its official code in a register row.'),
    postcodePattern: patternSchema.describe('A postcode of this country’s shape: a filter on the register’s rows.'),
    crossBorderPostcodePattern: patternSchema
      .optional()
      .describe('A neighbour’s postcodes this country’s addresses are written with: not a filter, and not evidence of the neighbour.'),
    stateFromCode: z
      .object({
        pattern: patternSchema.describe('Matched against the municipality code; the first group is {1}.'),
        territory: z.string().regex(/^[A-Z]{2}-\{1\}$/, 'a state territory template such as AT-{1}'),
      })
      .strict()
      .optional()
      .describe('The state (Land) a municipality lies in, from its code alone; absent when the code names none.'),
    downloadUrl: z
      .url()
      .max(500)
      .refine((url) => url.includes('{yyyymmdd}'), 'names the reference date as {yyyymmdd}')
      .describe('The bulk file the importer reads: an official download, never a query.'),
  })
  .strict()
export type AddressRegisterRecord = z.infer<typeof addressRegisterSchema>

export const factDefinitionsSchema = z
  .object({
    addressRegister: addressRegisterSchema.optional(),
    subdivisions: z
      .object({
        factKey,
        label,
        options: z.array(subdivisionSchema).min(1).max(60),
        outside: z.object({ token, label }).strict().optional(),
        assumedWhenUnstated: token.optional(),
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
      const assumed = payload.subdivisions.assumedWhenUnstated
      if (assumed && !payload.subdivisions.options.some((option) => option.token === assumed))
        context.addIssue({ code: 'custom', path: ['subdivisions', 'assumedWhenUnstated'], message: `${assumed} is not a subdivision` })
    }
    payload.facts.forEach((fact, index) => {
      if (fact.codes && fact.type !== 'code' && fact.type !== 'codes')
        context.addIssue({ code: 'custom', path: ['facts', index, 'codes'], message: 'only a code or codes fact has codes' })
    })
  })
export type FactDefinitions = z.infer<typeof factDefinitionsSchema>
export type FactDefinitionsInput = z.input<typeof factDefinitionsSchema>

export const factSourceCitationSchema = z
  .object({
    title: z.string().min(1).max(300),
    reference: z.string().min(1).max(300).optional(),
    needsReview: z.boolean(),
  })
  .strict()
export type FactSourceCitation = z.infer<typeof factSourceCitationSchema>

export const appliesWhenSchema = z
  .object({
    projectTypes: z.array(token).min(1).max(20).optional(),
    uses: z.array(token).min(1).max(40).optional(),
    existing: z.literal(true).optional(),
  })
  .strict()

export const factSourceVariantSchema = z
  .object({
    document: label.optional(),
    reason: prose.optional(),
    sources: z.array(factSourceCitationSchema).min(1).max(6),
  })
  .strict()

export const municipalityAdditionSchema = z
  .object({
    territoryId,
    municipality: label,
    addition: prose,
    sources: z.array(factSourceCitationSchema).min(1).max(3),
  })
  .strict()

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
