// @disk-inputs: tests/fixtures/run-envelope.schema.json
/**
 * @vitest-environment node
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RUN_ENVELOPE_WIRE_SCHEMAS, runEnvelopeJsonSchema } from './run-envelope-schema'

const FIXTURE = join(process.cwd(), 'tests/fixtures/run-envelope.schema.json')

describe('run envelope JSON Schema', () => {
  it('matches the committed fixture the Python worker loads', () => {
    const generated = `${JSON.stringify(runEnvelopeJsonSchema(), null, 2)}\n`
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(FIXTURE, generated, 'utf8')
    expect(
      readFileSync(FIXTURE, 'utf8'),
      'The wire schemas changed. Re-run with UPDATE_FIXTURES=1 and commit the fixture in the same change.'
    ).toBe(generated)
  })

  it('exports every schema the contract map names, and only those', () => {
    expect(Object.keys(runEnvelopeJsonSchema().$defs as object).sort()).toEqual(
      Object.keys(RUN_ENVELOPE_WIRE_SCHEMAS).sort()
    )
  })
})
