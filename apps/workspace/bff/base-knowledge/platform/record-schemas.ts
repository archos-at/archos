/**
 * What `platform-knowledge-schema-get` answers: the JSON Schema of each record
 * type `records-propose` takes, a citation's, the batch size and the kit's
 * checks. The decision table (`decision_table.v1`, ADR-0166) is written once
 * under `$defs` and referenced wherever a record carries one (a ruleset's body,
 * an edition's `transition` and its scope, `appliesWhen`, ADR-0178), and a
 * record's citations reference the one citation schema the answer carries
 * beside the types (`#/citation`). Any other sub-schema the types repeat is
 * written once under `$defs` too (`shared_<n>`), so the whole set fits one tool
 * result on the door (`MAX_RESULT_CHARS`). Pure.
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

/** Every node under `root` that is no record type itself and holds no reference, by its JSON. */
function nodeCounts(root: unknown, top = true, counts = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(root)) for (const item of root) nodeCounts(item, false, counts)
  else if (root && typeof root === 'object') {
    const text = JSON.stringify(root)
    if (!top && !text.includes('"$ref"')) counts.set(text, (counts.get(text) ?? 0) + 1)
    for (const value of Object.values(root)) nodeCounts(value, false, counts)
  }
  return counts
}

const replaced = (node: unknown, text: string, ref: string): unknown => {
  if (Array.isArray(node)) return node.map((item) => replaced(item, text, ref))
  if (!node || typeof node !== 'object') return node
  if (JSON.stringify(node) === text) return { $ref: ref }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, replaced(value, text, ref)]))
}

/**
 * A sub-schema the record types repeat (a label, a territory id, an optional
 * date) written once under `$defs` as `shared_<n>`, most characters saved
 * first, while writing it once saves any: the set stays one tool result as
 * the types grow. Pure and deterministic.
 */
function sharedDefinitions(recordTypes: Record<string, unknown>): { recordTypes: Record<string, unknown>; defs: Record<string, unknown> } {
  const defs: Record<string, unknown> = {}
  let types = recordTypes
  for (;;) {
    const ref = `#/$defs/shared_${Object.keys(defs).length + 1}`
    const saved = (text: string, count: number) => count * (text.length - JSON.stringify({ $ref: ref }).length) - text.length
    const best = [...nodeCounts(types)].filter(([text, count]) => count > 1 && saved(text, count) > 0).sort((a, b) => saved(b[0], b[1]) - saved(a[0], a[1]) || a[0].localeCompare(b[0]))[0]
    if (!best) return { recordTypes: types, defs }
    defs[ref.slice('#/$defs/'.length)] = JSON.parse(best[0])
    types = replaced(types, best[0], ref) as Record<string, unknown>
  }
}

/** The schemas for `types`, the citation's, the decision table once if any of them carries one, the batch size and the checks. */
export function recordSchemas(types: readonly ProposedRecordType[]) {
  const generated = Object.fromEntries(
    types.map((name) => {
      const variant = proposedRecordSchema.options.find((option) => option.shape.type.value === name)
      return [name, variant ? z.toJSONSchema(variant, { ...OPTIONS, override: referenceTables }) : null]
    }),
  )
  const referenced = JSON.stringify(generated).includes(DECISION_TABLE_REF)
  const { recordTypes, defs } = sharedDefinitions(generated)
  return {
    recordTypes,
    citation: z.toJSONSchema(citationSchema, OPTIONS),
    ...(referenced || Object.keys(defs).length > 0
      ? { $defs: { ...(referenced ? { [DECISION_TABLE]: z.toJSONSchema(decisionTableSchema, OPTIONS) } : {}), ...defs } }
      : {}),
    maxBatch: MAX_PROPOSED_RECORDS,
    checks: KIT_CHECKS.map((code) => ({ code, type: `${KIT_PROBLEM_TYPE_BASE}${code.toLowerCase()}`, hint: KIT_HINTS[code] })),
  }
}
