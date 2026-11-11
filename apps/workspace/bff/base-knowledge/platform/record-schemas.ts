/**
 * What `platform-knowledge-schema-get` answers: the JSON Schema of each record
 * type `records-propose` takes, a citation's, the batch size and the kit's
 * checks. The decision table (`decision_table.v1`, ADR-0166) is written once
 * under `$defs` and referenced wherever a record carries one (a ruleset's body,
 * an edition's `transition` and its scope, `appliesWhen`, ADR-0178), and a
 * record's citations reference the one citation schema the answer carries
 * beside the types (`#/citation`). An ISO date, whose pattern zod writes out at
 * 250 characters, is written once under `$defs` too. So the whole set fits one
 * tool result on the door (`MAX_RESULT_CHARS`). Pure.
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

/** An ISO date as zod writes it: a 250-character pattern, the same in every record type. */
const isIsoDate = (schema: JsonSchema) => schema.type === 'string' && schema.format === 'date'

/** A node that is a decision table or an ISO date becomes a reference to the one written under `$defs`. */
function referenceTables(context: { zodSchema: unknown; jsonSchema: JsonSchema }): void {
  if (isIsoDate(context.jsonSchema)) {
    const { description } = context.jsonSchema
    for (const key of Object.keys(context.jsonSchema)) delete context.jsonSchema[key]
    Object.assign(context.jsonSchema, { $ref: DATE_REF }, description ? { description } : {})
    return
  }
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
  const written = JSON.stringify(recordTypes)
  const $defs: Record<string, JsonSchema> = {}
  if (written.includes(DECISION_TABLE_REF)) $defs[DECISION_TABLE] = z.toJSONSchema(decisionTableSchema, OPTIONS)
  if (written.includes(DATE_REF)) $defs[DATE] = z.toJSONSchema(z.iso.date(), OPTIONS)
  return {
    recordTypes,
    citation: z.toJSONSchema(citationSchema, OPTIONS),
    ...(Object.keys($defs).length > 0 ? { $defs } : {}),
    maxBatch: MAX_PROPOSED_RECORDS,
    checks: KIT_CHECKS.map((code) => ({ code, type: `${KIT_PROBLEM_TYPE_BASE}${code.toLowerCase()}`, hint: KIT_HINTS[code] })),
  }
}
