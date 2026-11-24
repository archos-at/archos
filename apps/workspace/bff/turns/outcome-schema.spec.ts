// @disk-inputs: tests/fixtures/turn-outcome.schema.json
/**
 * @vitest-environment node
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expectGenerated } from '@/test-utils/generated-file'
import { TURN_OUTCOME_WIRE_SCHEMAS, turnOutcomeJsonSchema } from './outcome-schema'

const FIXTURE = join(process.cwd(), 'tests/fixtures/turn-outcome.schema.json')

describe('turn outcome JSON Schema', () => {
  it('matches the committed fixture the chat socket loads', () => {
    const generated = `${JSON.stringify(turnOutcomeJsonSchema(), null, 2)}\n`
    expectGenerated(FIXTURE, generated)
  })

  it('exports every schema the contract map names, and only those', () => {
    expect(Object.keys(turnOutcomeJsonSchema().$defs as object).sort()).toEqual(
      Object.keys(TURN_OUTCOME_WIRE_SCHEMAS).sort()
    )
  })
})
