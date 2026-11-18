import { discriminatedOptions } from '@/lib/api/zod-union'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as generated from './generated'
import { answerCardSchema, validateAnswerCards } from './schemas'
import { loadCardJsonSchema } from '@/test-utils/card-json-schema'

const cardJsonSchema = loadCardJsonSchema()

interface JsonSchemaDocument {
  $defs: Record<string, JsonSchemaNode>
  oneOf: Array<{ $ref: string }>
}
interface JsonSchemaNode {
  $ref?: string
  anyOf?: JsonSchemaNode[]
  items?: JsonSchemaNode
  type?: string
  required?: string[]
  properties?: Record<string, JsonSchemaNode>
}

const document = cardJsonSchema as unknown as JsonSchemaDocument
const defs = document.$defs
const cardDefNames = document.oneOf.map((entry) => entry.$ref.split('/').pop() as string)

const constOf = (node: JsonSchemaNode | undefined): string | undefined => {
  const literal = (node as { const?: unknown; default?: unknown } | undefined)?.const
  const fallback = (node as { default?: unknown } | undefined)?.default
  const value = literal ?? fallback
  return typeof value === 'string' ? value : undefined
}

function bottomsOutInAny(schema: z.core.$ZodType, depth = 0): boolean {
  if (depth > 8) return false
  const def = schema._zod.def
  switch (def.type) {
    case 'any':
    case 'unknown':
      return true
    case 'optional':
    case 'nullable':
    case 'default':
      return bottomsOutInAny((def as z.core.$ZodOptionalDef).innerType, depth + 1)
    case 'array':
      return bottomsOutInAny((def as z.core.$ZodArrayDef).element, depth + 1)
    case 'union':
      return (def as z.core.$ZodUnionDef).options.some((option) => bottomsOutInAny(option, depth + 1))
    default:
      return false
  }
}

function describesARef(node: JsonSchemaNode | undefined, depth = 0): boolean {
  if (!node || depth > 8) return false
  if (typeof node.$ref === 'string') return true
  if (node.items && describesARef(node.items, depth + 1)) return true
  return (node.anyOf ?? []).some((member) => describesARef(member, depth + 1))
}

const nestedFields = cardDefNames.flatMap((defName) => {
  const definition = defs[defName]
  const cardType = constOf(definition.properties?.type)
  if (!cardType) return []
  return Object.entries(definition.properties ?? {})
    .filter(([, property]) => describesARef(property))
    .map(([field]) => ({ defName, cardType, field, required: (definition.required ?? []).includes(field) }))
})

const schemaFor = (defName: string) =>
  (generated as unknown as Record<string, z.ZodObject>)[
    `${defName[0].toLowerCase()}${defName.slice(1)}Schema`
  ]

describe('nested card fields are validated, not waved through', () => {
  it('finds nested fields to check at all', () => {
    expect(nestedFields.length).toBeGreaterThan(25)
  })

  it.each(nestedFields.map((entry) => [`${entry.cardType}.${entry.field}`, entry] as const))(
    '%s is a real schema, not z.any()',
    (_label, entry) => {
      const field = schemaFor(entry.defName).shape[entry.field]
      expect(
        bottomsOutInAny(field),
        `${entry.cardType}.${entry.field} is described by a $ref in contracts/cards/schemas.json but ` +
          'the Zod mirror accepts anything for it. The generator dropped the reference — see ' +
          'scripts/generate-card-schemas.mjs.'
      ).toBe(false)
    }
  )

  it('rejects a card whose nested reference is a bare string', () => {
    const result = answerCardSchema.safeParse({
      type: 'verdict_header',
      subject: 'Erforderliche Geländerhöhe',
      verdict: '1,10 m',
      reference: 'banana',
    })
    expect(result.success).toBe(false)
  })

  it.each(nestedFields.filter((entry) => entry.required).map((entry) => [entry.cardType, entry] as const))(
    'rejects a %s that is missing its required nested field',
    (_cardType, entry) => {
      const fixture = { type: entry.cardType, ...Object.fromEntries(
        Object.keys(defs[entry.defName].properties ?? {}).map((field) => [field, undefined])
      ) }
      delete (fixture as Record<string, unknown>)[entry.field]
      const result = schemaFor(entry.defName).safeParse(fixture)
      expect(result.success).toBe(false)
      expect(
        result.success ? [] : result.error.issues.map((issue) => issue.path.join('.')),
        `${entry.cardType}.${entry.field} is required by models.py but its absence was not reported`
      ).toContain(entry.field)
    }
  )

  it('still accepts every card the gallery ships', async () => {
    const { CARD_PREVIEW_FIXTURES, PREVIEW_EXCLUDED } = await import('@/features/cards/preview-fixtures')
    const previewable = [...discriminatedOptions(answerCardSchema).keys()]
      .filter((type): type is string => typeof type === 'string')
      .filter((type) => !(type in PREVIEW_EXCLUDED))
    expect(Object.keys(CARD_PREVIEW_FIXTURES).sort()).toEqual(previewable.sort())
  })

  it('holds the position of the malformed card and keeps the rest of the answer', () => {
    const kept = validateAnswerCards([
      {
        type: 'calculation',
        title: 'Schrittmaß',
        steps: [{ label: 'a', operation: 'sum', operands: [{ label: 'b', value: 1 }] }],
        reference: 'banana',
      },
      { type: 'memory_proposal', title: 'Merken?', content: 'Alles gut.', kind: 'preference' },
    ])
    expect(kept).toHaveLength(2)
    expect(kept.map((card) => card?.type)).toEqual([undefined, 'memory_proposal'])
  })
})
