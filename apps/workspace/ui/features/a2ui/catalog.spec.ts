/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { CARD_PREVIEW_FIXTURES } from '@/features/cards/preview-fixtures'
import { cardComponentApi, cardTypeOf, catalogCardSchemas } from './catalog'

describe('a card schema as A2UI reads it', () => {
  const [type, fixture] = Object.entries(CARD_PREVIEW_FIXTURES)[0]
  const schema = catalogCardSchemas().find((candidate) => cardTypeOf(candidate) === type)
  if (!schema) throw new Error(`no catalog schema for the preview fixture '${type}'`)
  const api = cardComponentApi(schema)

  it('accepts what the card schema accepts', () => {
    const { type: _type, ...props } = fixture as Record<string, unknown>
    expect(api.schema.safeParse(props).success).toBe(true)
  })

  it('refuses with the card schema’s own issues, on the Zod 3 error A2UI formats', () => {
    const result = api.schema.safeParse({})
    expect(result.success).toBe(false)
    if (result.success) return
    const own = (schema as z.ZodObject).omit({ type: true }).safeParse({})
    expect(own.success).toBe(false)
    expect(result.error.errors.map((issue) => issue.message)).toEqual(own.error?.issues.map((issue) => issue.message))
  })
})
