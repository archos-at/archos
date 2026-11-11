/**
 * @vitest-environment node
 *
 * `platform-knowledge-schema-get` with no type answers every record type in one
 * tool result. Past the door's cap (`MAX_RESULT_CHARS`) the result is cut and
 * its structured content dropped, so an onboarding agent reads no
 * `recordTypes` at all: an edition's scope (ADR-0178) copied a second decision
 * table into the set and did exactly that. The table is written once.
 */

import { describe, expect, it } from 'vitest'
import { MAX_RESULT_CHARS } from '@/lib/agent-api/discovery'
import { recordSchemas } from './record-schemas'
import { PROPOSED_RECORD_TYPES } from './wire'

describe('recordSchemas', () => {
  const all = recordSchemas([...PROPOSED_RECORD_TYPES])

  it('fits every record type in one tool result on the door', () => {
    expect(JSON.stringify(all).length).toBeLessThanOrEqual(MAX_RESULT_CHARS)
  })

  it('writes the decision table once, and a ruleset’s body and an edition’s scope reference it', () => {
    const text = JSON.stringify(all.recordTypes)
    expect(all.$defs?.['decision_table.v1']).toMatchObject({ type: 'object', required: expect.arrayContaining(['inputs', 'rows']) })
    expect(JSON.stringify(all.recordTypes.ruleset)).toContain('"$ref":"#/$defs/decision_table.v1"')
    expect(JSON.stringify(all.recordTypes.edition)).toContain('"$ref":"#/$defs/decision_table.v1"')
    expect(text).not.toContain('"examples":{"default":[]')
  })

  it('carries no table for a type that has none', () => {
    const work = recordSchemas(['work'])
    expect(Object.keys(work.recordTypes)).toEqual(['work'])
    expect(work).not.toHaveProperty('$defs')
  })
})
