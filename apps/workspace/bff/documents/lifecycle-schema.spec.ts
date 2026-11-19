// @disk-inputs: tests/fixtures/document-lifecycle.schema.json
/**
 * @vitest-environment node
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { documentLifecycleJsonSchema, toJsonSchema } from './lifecycle-schema'
import {
  DOCUMENT_LIFECYCLE_WIRE_SCHEMAS,
  internalDocumentVersionRequestSchema,
} from './lifecycle-types'

const FIXTURE = join(process.cwd(), 'tests/fixtures/document-lifecycle.schema.json')

describe('document lifecycle JSON Schema', () => {
  it('matches the committed fixture the Python tier loads', () => {
    const generated = `${JSON.stringify(documentLifecycleJsonSchema(), null, 2)}\n`
    if (process.env.UPDATE_FIXTURES === '1') {
      writeFileSync(FIXTURE, generated, 'utf8')
    }
    expect(
      readFileSync(FIXTURE, 'utf8'),
      'The wire schemas changed. Re-run with UPDATE_FIXTURES=1 and commit the fixture ' +
        'in the same change, so the Python tool and this tier cannot disagree.',
    ).toBe(generated)
  })

  it('exports every schema the contract map names, and only those', () => {
    const schema = documentLifecycleJsonSchema()
    expect(Object.keys(schema.$defs as object).sort()).toEqual(
      Object.keys(DOCUMENT_LIFECYCLE_WIRE_SCHEMAS).sort(),
    )
  })

  it('describes the internal request as a closed discriminated union', () => {
    const node = toJsonSchema(internalDocumentVersionRequestSchema)
    expect(node.discriminator).toEqual({ propertyName: 'op' })
    const options = node.oneOf as Array<{ properties: { op: { const: string } } }>
    expect(options.map((option) => option.properties.op.const).sort()).toEqual([
      'create',
      'create_file',
      'revise_file',
      'status',
      'submit',
      'update',
      'update_file',
    ])
  })

  it('refuses to describe a shape it does not understand, rather than emitting {}', () => {
    expect(() => toJsonSchema(z.map(z.string(), z.string()))).toThrow(/cannot describe/)
  })
})
