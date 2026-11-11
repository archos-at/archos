/**
 * What `platform-knowledge-schema-get` answers: the JSON Schema of each record
 * type `records-propose` takes, a citation's, the batch size and the kit's
 * checks. The decision table (`decision_table.v1`, ADR-0166) is written once
 * under `$defs` and referenced wherever a record carries one (a ruleset's body,
 * an edition's `transition` and its scope, `appliesWhen`, ADR-0178), and a
 * record's citations reference the one citation schema the answer carries
 * beside the types (`#/citation`), so the whole set fits one tool result on
 * the door (`MAX_RESULT_CHARS`). Pure.
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
const OPTIONS = { io: 'input', unrepresentable: 'any' } as const

type JsonSchema = Record<string, unknown>

/** Whether `schema` is the decision table, or a refinement of it (an edition's `transition` and `appliesWhen`). */
function isDecisionTable(schema: unknown): boolean {
  for (let node = schema as { _zod?: { parent?: unknown } } | undefined; node; node = node._zod?.parent as typeof node) {
    if (node === decisionTableSchema) return true
  }
  return false
}

/** A node that is a decision table becomes a reference to the one written under `$defs`. */
function referenceTables(context: { zodSchema: unknown; jsonSchema: JsonSchema }): void {
  // `format: date` says it; the route's zod schema still enforces the day, so zod's leap-year regex is ~250 characters of noise.
  if (context.jsonSchema.format === 'date') delete context.jsonSchema.pattern
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
  const referenced = JSON.stringify(recordTypes).includes(DECISION_TABLE_REF)
  return {
    recordTypes,
    citation: z.toJSONSchema(citationSchema, OPTIONS),
    ...(referenced ? { $defs: { [DECISION_TABLE]: z.toJSONSchema(decisionTableSchema, OPTIONS) } } : {}),
    maxBatch: MAX_PROPOSED_RECORDS,
    checks: KIT_CHECKS.map((code) => ({ code, type: `${KIT_PROBLEM_TYPE_BASE}${code.toLowerCase()}`, hint: KIT_HINTS[code] })),
  }
}
