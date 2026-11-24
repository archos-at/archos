// @disk-inputs: tests/fixtures/run-envelope.schema.json
/**
 * @vitest-environment node
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expectGenerated } from '@/test-utils/generated-file'
import { RUN_ENVELOPE_WIRE_SCHEMAS, runEnvelopeJsonSchema } from './run-envelope-schema'

const FIXTURE = join(process.cwd(), 'tests/fixtures/run-envelope.schema.json')

describe('run envelope JSON Schema', () => {
  it('matches the committed fixture the Python worker loads', () => {
    const generated = `${JSON.stringify(runEnvelopeJsonSchema(), null, 2)}\n`
    expectGenerated(FIXTURE, generated)
  })

  it('exports every schema the contract map names, and only those', () => {
    expect(Object.keys(runEnvelopeJsonSchema().$defs as object).sort()).toEqual(
      Object.keys(RUN_ENVELOPE_WIRE_SCHEMAS).sort()
    )
  })
})
