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
import { PROPOSED_RECORD_TYPES, proposedRecordSchema, reviewBodySchema } from './wire'

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

describe('a work’s identifiers at its source', () => {
  const work = (identifiers: Record<string, string>) => proposedRecordSchema.safeParse({ type: 'work', key: 'bo-wien', kind: 'statute', title: 'Bauordnung für Wien', territoryIds: ['AT-9'], identifiers, citations: [] })

  it('takes a law number under the scheme its source record declares, and an ELI that ends at a path segment', () => {
    expect(work({ 'ris_gesetzesnummer': '20000006', eli: 'https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11/' }).success).toBe(true)
  })

  it('takes a scheme no code names: a country’s identifier is a record, not a release', () => {
    const parsed = work({ 'xa_gazette_number': '42' })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ identifiers: { 'xa_gazette_number': '42' } })
  })

  it('refuses a malformed scheme, the designation as a scheme, an empty value and more than eight schemes', () => {
    expect(work({ 'Gesetzesnummer': '20000006' }).success).toBe(false)
    expect(work({ '1st_number': '1' }).success).toBe(false)
    expect(work({ 'law-number': '1' }).success).toBe(false)
    expect(work({ designation: 'BO für Wien' }).success).toBe(false)
    expect(work({ 'xa_gazette_number': ' ' }).success).toBe(false)
    expect(work(Object.fromEntries(Array.from({ length: 9 }, (_, n) => [`scheme_${n}`, String(n)]))).success).toBe(false)
  })

  it('refuses an ELI that does not end with "/": …/1930/11 would also name …/1930/110', () => {
    expect(work({ eli: 'https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11' }).success).toBe(false)
    expect(work({ eli: 'not a url/' }).success).toBe(false)
  })
})

const REVISION = '00000000-0000-4000-8000-000000000001'

describe('reviewBodySchema', () => {
  it('takes one decision per claim', () => {
    expect(reviewBodySchema.safeParse({ decisions: [{ revisionId: REVISION, claimPath: 'name', decision: 'accepted' }] }).success).toBe(true)
  })

  it('refuses two decisions on one claim in one body', () => {
    const result = reviewBodySchema.safeParse({
      decisions: [
        { revisionId: REVISION, claimPath: 'name', decision: 'accepted' },
        { revisionId: REVISION, claimPath: 'name', decision: 'rejected' },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/one decision per review/)
  })
})
