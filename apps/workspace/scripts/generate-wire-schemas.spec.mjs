// @disk-inputs: ../../contracts/wire/v2.schema.json, ui/adapters/api/wire-v2.generated.ts
/**
 * The wire generator's unions, and the drift of what it wrote.
 *
 * `ui/adapters/api/wire-v2.generated.ts` is generated from
 * `contracts/wire/v2.schema.json`, itself generated from `wire_v2.py`. A stale
 * generated module type-checks perfectly, so the last test here is the gate:
 * the module in the repo must be the module this generator emits.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildWireSchemaModule,
  discriminatedUnionExpr,
  outPath,
  schemaPath,
} from './generate-wire-schemas.mjs'

describe('generate-wire-schemas', () => {
  it('emits a discriminated oneOf as z.discriminatedUnion', () => {
    const node = {
      oneOf: [{ $ref: '#/$defs/RunStarted' }, { $ref: '#/$defs/RunError' }],
      discriminator: { propertyName: 'type' },
    }
    expect(discriminatedUnionExpr(node)).toBe(
      'z.discriminatedUnion("type", [runStartedSchema, runErrorSchema])'
    )
  })

  it('joins a union nested on another key with z.union', () => {
    const node = {
      oneOf: [
        { $ref: '#/$defs/RunStarted' },
        { oneOf: [{ $ref: '#/$defs/Heartbeat' }], discriminator: { propertyName: 'name' } },
      ],
      discriminator: { propertyName: 'type' },
    }
    expect(discriminatedUnionExpr(node)).toBe(
      'z.union([z.discriminatedUnion("type", [runStartedSchema]), z.discriminatedUnion("name", [heartbeatSchema])])'
    )
  })

  it('keeps what the client sends strict, and strips unknown keys from what it receives', () => {
    const closed = (properties) => ({ type: 'object', properties, additionalProperties: false })
    const root = {
      $defs: {
        Answer: closed({ text: { type: 'string' } }),
        Result: closed({ text: { type: 'string' }, run: closed({ id: { type: 'string' } }) }),
        ClientMessage: {
          oneOf: [{ $ref: '#/$defs/Answer' }],
          discriminator: { propertyName: 'type' },
        },
      },
    }
    const generated = buildWireSchemaModule(root)
    expect(generated).toContain(
      'export const answerSchema = z.object({ "text": z.string().optional() }).strict()'
    )
    expect(generated).toContain(
      'export const resultSchema = z.object({ "text": z.string().optional(), "run": z.object({ "id": z.string().optional() }).optional() })'
    )
  })

  it('reads a value this bundle does not know as null where the field says so', async () => {
    const reason = {
      anyOf: [{ enum: ['ungrounded', 'law_unsettled'], type: 'string' }, { type: 'null' }],
      default: null,
      'x-unknown-as-null': true,
    }
    const root = { $defs: { Result: { type: 'object', properties: { reason }, additionalProperties: false } } }
    expect(buildWireSchemaModule(root)).toContain(
      '"reason": z.union([z.enum(["ungrounded","law_unsettled"]), z.null()]).default(null).catch(null)'
    )
    // The generated module: a capped reason added after this bundle was built still lets the turn settle.
    const { turnResultSchema } = await import('../ui/adapters/api/wire-v2.generated')
    const parsed = turnResultSchema.parse({
      message_id: 'm1',
      text: 'GK 5',
      answer_confidence: 'medium',
      answer_confidence_capped_reason: 'a_reason_from_a_later_release',
    })
    expect(parsed.answer_confidence_capped_reason).toBeNull()
    expect(parsed.answer_confidence).toBe('medium')
  })

  it('keeps a field the client sends strict, even when marked', () => {
    const root = {
      $defs: {
        Answer: {
          type: 'object',
          properties: { level: { enum: ['low'], type: 'string', 'x-unknown-as-null': true } },
        },
        ClientMessage: { oneOf: [{ $ref: '#/$defs/Answer' }], discriminator: { propertyName: 'type' } },
      },
    }
    expect(() => buildWireSchemaModule(root)).toThrow(/read strictly by the server/)
  })

  it('refuses a field that would generate z.any()', () => {
    const root = { $defs: { Loose: { type: 'object', properties: { x: {} } } } }
    expect(() => buildWireSchemaModule(root)).toThrow(/z\.any\(\)/)
  })

  it('wrote the module this generator emits (run `npm run generate:wire`)', () => {
    const root = JSON.parse(readFileSync(schemaPath, 'utf-8'))
    expect(readFileSync(outPath, 'utf-8')).toBe(buildWireSchemaModule(root))
  })
})
