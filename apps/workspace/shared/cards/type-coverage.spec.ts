/**
 * @vitest-environment node
 */

import { discriminatedOptions } from '@/lib/api/zod-union'
import { describe, expect, it } from 'vitest'
import { answerCardSchema } from './schemas'
import { loadCardJsonSchema } from '@/test-utils/card-json-schema'

const cardJsonSchema = loadCardJsonSchema()

interface JsonSchemaDocument {
  discriminator: { propertyName: string; mapping: Record<string, string> }
  oneOf: Array<{ $ref: string }>
}

const document = cardJsonSchema as unknown as JsonSchemaDocument

const CATALOG_TYPES = Object.keys(document.discriminator.mapping).sort()

const UNION_TYPES = [...discriminatedOptions(answerCardSchema).keys()]
  .filter((type): type is string => typeof type === 'string')
  .sort()

const REGENERATE =
  'Run `uv run python scripts/generate_card_schema.py` (repo root) and then ' +
  '`npm run generate:cards` (apps/workspace), and commit both results.'

describe('the card union covers the canonical catalog', () => {
  it('has a discriminator mapping that names every member of the union', () => {
    expect(CATALOG_TYPES).toHaveLength(document.oneOf.length)
    expect(CATALOG_TYPES.length).toBeGreaterThan(15)
  })

  it('parses every card type contracts/cards/schemas.json declares', () => {
    const missing = CATALOG_TYPES.filter((type) => !UNION_TYPES.includes(type))
    expect(
      missing,
      `apps/workspace/shared/cards/generated.ts has no union member for card type(s) ${JSON.stringify(missing)}, ` +
        'which contracts/cards/schemas.json declares. `validateAnswerCards` leaves a hole where a card it cannot ' +
        'parse was, so every [[card:N]] marker after one of these would draw nothing instead of its card. ' +
        `The union is generated, so do not hand-edit it: ${REGENERATE}`
    ).toEqual([])
  })

  it('parses no card type the canonical catalog has dropped', () => {
    const orphaned = UNION_TYPES.filter((type) => !CATALOG_TYPES.includes(type))
    expect(
      orphaned,
      `apps/workspace/shared/cards/generated.ts still parses card type(s) ${JSON.stringify(orphaned)}, which ` +
        `contracts/cards/schemas.json no longer declares. ${REGENERATE}`
    ).toEqual([])
  })
})
