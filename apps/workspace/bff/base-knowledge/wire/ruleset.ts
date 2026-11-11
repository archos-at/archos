/**
 * The wire of a ruleset (ADR-0166): a base knowledge record whose payload is a
 * decision table, so a country rule that today is code (which building class,
 * which authority, which reference date) is data one evaluator runs.
 *
 * `decision_table.v1` is a DMN decision table with hit policy FIRST whose
 * conditions are JsonLogic (jsonlogic.com) restricted to a closed subset
 * (`rulesets/expression.ts` holds the operators and checks them). Pure zod,
 * so the routes, the agent operations and a later review UI read one shape.
 */

import { z } from 'zod'
import { checkExpression, readFact } from '@/lib/base-knowledge/rulesets/expression'
import { advicePolicySchema, terminologySchema } from './advice'
import { factDefinitionsSchema, factSourcesSchema } from './setup-facts'
import { DECISION_TABLE_PURPOSES, FACT_TYPES, RULESET_PURPOSES } from './vocab'

/** A fact key as the project profile stores it: English snake case (`storeys_above_ground`). */
export const factKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'a snake_case fact key')

/**
 * A territory id as design §3.2 writes them: ISO 3166-1 or -2 (`AT`, `DE-BE`),
 * `EU`, or `<CC>:<scheme>:<code>` (`AT:gkz:90001`). Ids are opaque and never
 * parsed; the territory records themselves are another record type.
 */
export const rulesetTerritoryIdSchema = z
  .string()
  .regex(
    /^(?:[A-Z]{2}(?:-[A-Z0-9]{1,3})?|[A-Z]{2}:[a-z][a-z0-9_]{0,15}:[A-Za-z0-9_-]{1,40})$/,
    'a territory id such as AT-9 or AT:gkz:90001'
  )

const isoDate = z.iso.date()

export const decisionInputSchema = z
  .object({
    key: factKeySchema,
    type: z
      .enum(FACT_TYPES)
      .describe('date is an ISO date, compared as text; codes is a list of tokens.'),
  })
  .strict()

/** Where a row comes from: the provision it encodes, so an answer cites it. */
export const provisionSchema = z
  .object({
    citation: z.string().trim().min(1).max(300),
    wording: z.enum(['verbatim', 'paraphrase']).optional(),
  })
  .strict()
export type Provision = z.infer<typeof provisionSchema>

export const authorityBodySchema = z
  .object({
    authorityId: z.string().min(1).max(120),
    role: z.enum(['decides', 'consents', 'checks']),
  })
  .strict()

const outputSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('code'), codes: z.array(z.string().min(1).max(80)).min(1).max(200) })
    .strict(),
  z.object({ type: z.literal('boolean') }).strict(),
  z.object({ type: z.literal('event'), events: z.array(factKeySchema).min(1).max(50) }).strict(),
  z.object({ type: z.literal('bodies') }).strict(),
  z
    .object({
      type: z.literal('quantity'),
      unit: z.string().min(1).max(40).describe('UCUM, e.g. m2.'),
    })
    .strict(),
])
export type DecisionOutput = z.infer<typeof outputSchema>

const rowSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    when: z.unknown().describe('A JsonLogic condition over the inputs.'),
    then: z.unknown(),
    provision: provisionSchema.optional(),
  })
  .strict()

const factsSchema = z.record(factKeySchema, z.unknown())

const exampleSchema = z
  .object({
    facts: factsSchema,
    expect: z.union([
      z.object({ then: z.unknown() }).strict(),
      z.object({ undeterminedBy: z.array(factKeySchema) }).strict(),
    ]),
  })
  .strict()

/**
 * An example's facts must be declared inputs of their declared types: an
 * undeclared key would test nothing, and a mistyped one would fail as an
 * evaluation error rather than as the author's mistake.
 */
function exampleIssues(
  examples: readonly z.infer<typeof exampleSchema>[],
  declared: ReadonlyMap<string, (typeof FACT_TYPES)[number]>
): { path: (string | number)[]; message: string }[] {
  return examples.flatMap((example, index) =>
    Object.entries(example.facts).flatMap(([key, value]) => {
      const path = ['examples', index, 'facts', key]
      const type = declared.get(key)
      if (!type) return [{ path, message: `${key} is not a declared input` }]
      try {
        readFact(key, type, value)
        return []
      } catch (error) {
        return [{ path, message: (error as Error).message }]
      }
    })
  )
}

/** Whether `value` is a value the output declares. */
export function isOutputValue(output: DecisionOutput, value: unknown): boolean {
  switch (output.type) {
    case 'code':
      return typeof value === 'string' && output.codes.includes(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'event':
      return typeof value === 'string' && output.events.includes(value)
    case 'quantity':
      return typeof value === 'number' && Number.isFinite(value)
    case 'bodies':
      return z
        .object({ bodies: z.array(authorityBodySchema).min(1).max(20) })
        .strict()
        .safeParse(value).success
  }
}

export const decisionTableSchema = z
  .object({
    inputs: z.array(decisionInputSchema).min(1).max(64),
    output: outputSchema,
    rows: z.array(rowSchema).max(500),
    otherwise: z.union([
      z.object({ then: z.unknown() }).strict(),
      z.object({ undetermined: z.literal(true) }).strict(),
    ]),
    examples: z.array(exampleSchema).max(200).default([]),
  })
  .strict()
  .superRefine((table, context) => {
    const declared = new Map(table.inputs.map((input) => [input.key, input.type]))
    if (declared.size !== table.inputs.length)
      context.addIssue({ code: 'custom', path: ['inputs'], message: 'an input is declared twice' })
    const rowIds = new Set<string>()
    table.rows.forEach((row, index) => {
      if (rowIds.has(row.id))
        context.addIssue({
          code: 'custom',
          path: ['rows', index, 'id'],
          message: `row id ${row.id} repeats`,
        })
      rowIds.add(row.id)
      for (const problem of checkExpression(row.when, declared)) {
        context.addIssue({ code: 'custom', path: ['rows', index, 'when'], message: problem })
      }
      if (!isOutputValue(table.output, row.then)) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index, 'then'],
          message: `not a ${table.output.type} the output declares`,
        })
      }
    })
    if ('then' in table.otherwise && !isOutputValue(table.output, table.otherwise.then)) {
      context.addIssue({
        code: 'custom',
        path: ['otherwise', 'then'],
        message: `not a ${table.output.type} the output declares`,
      })
    }
    for (const issue of exampleIssues(table.examples, declared))
      context.addIssue({ code: 'custom', ...issue })
  })
export type DecisionTable = z.infer<typeof decisionTableSchema>
export type DecisionTableInput = z.input<typeof decisionTableSchema>

/**
 * A ruleset's values. Either it carries a table, or it says the node defers to
 * its parent (`inherits: 'parent'`); a node with neither has no rule, and its
 * answer is `undetermined: no_rule`, never a code default (design §3.6).
 */
export const rulesetValuesSchema = z
  .object({
    purpose: z.enum(RULESET_PURPOSES),
    territoryIds: z.array(rulesetTerritoryIdSchema).min(1).max(50),
    workIds: z.array(z.string().min(1).max(120)).max(50).default([]),
    validFrom: isoDate,
    validTo: isoDate
      .nullable()
      .default(null)
      .describe('Exclusive: the first day it no longer applies.'),
    basisEditionId: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .default(null)
      .describe('The edition the table encodes.'),
    body: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('table'),
          payloadSchema: z.literal('decision_table.v1'),
          payload: decisionTableSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('fact_definitions'),
          payloadSchema: z.literal('fact_definitions.v1'),
          payload: factDefinitionsSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('fact_sources'),
          payloadSchema: z.literal('fact_sources.v1'),
          payload: factSourcesSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('advice_policy'),
          payloadSchema: z.literal('advice_policy.v1'),
          payload: advicePolicySchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('terminology'),
          payloadSchema: z.literal('terminology.v1'),
          payload: terminologySchema,
        })
        .strict(),
      z.object({ kind: z.literal('inherits'), inherits: z.literal('parent') }).strict(),
    ]),
  })
  .strict()
  .superRefine((values, context) => {
    if (values.validTo !== null && values.validTo <= values.validFrom) {
      context.addIssue({ code: 'custom', path: ['validTo'], message: 'validTo is after validFrom' })
    }
    const tablePurpose = (DECISION_TABLE_PURPOSES as readonly string[]).includes(values.purpose)
    if (values.body.kind === 'table' && !tablePurpose) {
      context.addIssue({
        code: 'custom',
        path: ['body'],
        message: `${values.purpose} has no decision table schema yet`,
      })
    }
    // Every body but a table or a deferral serves the purpose of its own name, and no other.
    const recordKind = values.body.kind !== 'table' && values.body.kind !== 'inherits'
    if (recordKind && values.body.kind !== values.purpose) {
      context.addIssue({
        code: 'custom',
        path: ['body', 'kind'],
        message: `a ${values.body.kind} body serves the purpose ${values.body.kind}, not ${values.purpose}`,
      })
    }
  })
export type RulesetValues = z.infer<typeof rulesetValuesSchema>
export type RulesetValuesInput = z.input<typeof rulesetValuesSchema>
