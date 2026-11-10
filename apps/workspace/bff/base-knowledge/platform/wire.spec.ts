// @disk-inputs: bff/agent-api/door/platform/onboarding-guide.md
/**
 * @vitest-environment node
 *
 * What the door tells an operator's agent it may propose is what
 * `records-propose` takes: the schema-get types are the propose union's
 * discriminators, and the guide names every one. A relation, the record type a
 * country holds most of, was missing from both once (QC on staging).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROPOSED_RECORD_TYPES, proposedRecordSchema } from './wire'

const GUIDE = readFileSync(join(process.cwd(), 'bff/agent-api/door/platform/onboarding-guide.md'), 'utf8')

describe('the record types an agent is told about', () => {
  it('are exactly the types records-propose takes', () => {
    const accepted = proposedRecordSchema.options.map((option) => option.shape.type.value)
    expect([...PROPOSED_RECORD_TYPES].sort()).toEqual([...accepted].sort())
  })

  it('are each named in the guide’s propose step', () => {
    const step = GUIDE.split('\n').find((line) => line.includes('platform-knowledge-records-propose {dryRun: true')) ?? ''
    for (const type of PROPOSED_RECORD_TYPES.filter((name) => name !== 'territory')) {
      // Territories come in through the import step before it; the rest by name, in the plural.
      expect(step, type).toContain(`${type === 'authority' ? 'authorities' : `${type}s`}`)
    }
  })
})
