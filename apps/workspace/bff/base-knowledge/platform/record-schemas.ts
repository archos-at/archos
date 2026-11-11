/**
 * What `platform-knowledge-schema-get` answers: the JSON Schema of each record
 * type `records-propose` takes, a citation's, the batch size and the kit's
 * checks. The decision table (`decision_table.v1`, ADR-0166) is written once
 * under `$defs` and referenced wherever a record carries one (a ruleset's body,
 * an edition's `transition` and its scope, `appliesWhen`, ADR-0178), and a
 * record's citations reference the one citation schema the answer carries
 * beside the types (`#/citation`). A calendar date is written once too
 * (`#/$defs/date`): its schema carries a leap-year pattern of some 260
 * characters, and thirteen fields are dates. All of that is so the whole set
 * fits one tool result on the door (`MAX_RESULT_CHARS`); past the cap the
 * result is cut and its structured content dropped. Pure.
 */

import { z } from 'zod'
import { appliesWhenTableSchema } from '../wire/applies-when'
import { decisionTableSchema } from '../wire/ruleset'
import { KIT_CHECKS, KIT_HINTS, KIT_PROBLEM_TYPE_BASE } from './validate'
import { citationSchema, MAX_PROPOSED_RECORDS, PROPOSED_RECORD_TYPES, proposedRecordSchema } from './wire'

export type ProposedRecordType = (typeof PROPOSED_RECORD_TYPES)[number]

const DECISION_TABLE = 'decision_table.v1'
const DECISION_TABLE_REF = `#/$defs/${DECISION_TABLE}`
const CITATION_REF = '#/citation'
const DATE = 'date'
const DATE_REF = `#/$defs/${DATE}`
const OPTIONS = { io: 'input', unrepresentable: 'any' } as const

type JsonSchema = Record<string, unknown>

/** Whether `schema` is the decision table, or a refinement of it (an edition's `transition` and `appliesWhen`). */
function isDecisionTable(schema: unknown): boolean {
  for (let node = schema as { _zod?: { parent?: unknown } } | undefined; node; node = node._zod?.parent as typeof node) {
    if (node === decisionTableSchema) return true
  }
  return false
}

/**
 * A calendar date (`z.iso.date()`) becomes a reference to the one under `$defs`. What the field says of its own
 * (a description, a default) stays beside the reference, which the 2020-12 draft allows.
 */
function referenceDates(context: { jsonSchema: JsonSchema }): void {
  const { jsonSchema } = context
  if (jsonSchema.type !== 'string' || jsonSchema.format !== 'date' || typeof jsonSchema.pattern !== 'string') return
  delete jsonSchema.type
  delete jsonSchema.format
  delete jsonSchema.pattern
  jsonSchema.$ref = DATE_REF
}

/** A node that is a decision table becomes a reference to the one written under `$defs`; a date likewise. */
function referenceTables(context: { zodSchema: unknown; jsonSchema: JsonSchema }): void {
  referenceDates(context)
  if (context.zodSchema === citationSchema) {
    // Every record carries the same citation: written once, as the answer's `citation`.
    for (const key of Object.keys(context.jsonSchema)) delete context.jsonSchema[key]
    context.jsonSchema.$ref = CITATION_REF
    return
  }
  if (!isDecisionTable(context.zodSchema)) return
  for (const key of Object.keys(context.jsonSchema)) delete context.jsonSchema[key]
  context.jsonSchema.$ref = DECISION_TABLE_REF
  if (context.zodSchema === appliesWhenTableSchema) {
    context.jsonSchema.description = 'A decision_table.v1 whose output is {"type": "boolean"}: true, the building is within the edition’s scope.'
  }
}

/** The schemas for `types`, the citation's, the decision table once if any of them carries one, the batch size and the checks. */
export function recordSchemas(types: readonly ProposedRecordType[]) {
  const recordTypes = Object.fromEntries(
    types.map((name) => {
      const variant = proposedRecordSchema.options.find((option) => option.shape.type.value === name)
      return [name, variant ? z.toJSONSchema(variant, { ...OPTIONS, override: referenceTables }) : null]
    }),
  )
  const citation = z.toJSONSchema(citationSchema, { ...OPTIONS, override: referenceDates })
  const table = JSON.stringify(recordTypes).includes(DECISION_TABLE_REF)
    ? { [DECISION_TABLE]: z.toJSONSchema(decisionTableSchema, { ...OPTIONS, override: referenceDates }) }
    : {}
  const dated = JSON.stringify([recordTypes, citation, table]).includes(DATE_REF)
  const $defs = { ...table, ...(dated ? { [DATE]: z.toJSONSchema(z.iso.date(), OPTIONS) } : {}) }
  return {
    recordTypes,
    citation,
    ...(Object.keys($defs).length > 0 ? { $defs } : {}),
    maxBatch: MAX_PROPOSED_RECORDS,
    checks: KIT_CHECKS.map((code) => ({ code, type: `${KIT_PROBLEM_TYPE_BASE}${code.toLowerCase()}`, hint: KIT_HINTS[code] })),
  }
}
