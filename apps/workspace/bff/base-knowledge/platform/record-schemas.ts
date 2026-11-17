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

function isDecisionTable(schema: unknown): boolean {
  for (let node = schema as { _zod?: { parent?: unknown } } | undefined; node; node = node._zod?.parent as typeof node) {
    if (node === decisionTableSchema) return true
  }
  return false
}

function referenceTables(context: { zodSchema: unknown; jsonSchema: JsonSchema }): void {
  if (context.jsonSchema.format === 'date') delete context.jsonSchema.pattern
  if (context.zodSchema === citationSchema) {
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
