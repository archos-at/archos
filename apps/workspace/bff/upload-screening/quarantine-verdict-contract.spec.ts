// @disk-inputs: ../../tests/fixtures/quarantine_verdict_cases.json

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { quarantineVerdictOf, storedQuarantineVerdictOf, verdictSchema } from './quarantine'

interface Case {
  name: string
  verdict: unknown
  reads_as?: unknown
}

const FIXTURE_PATH = join(process.cwd(), '..', '..', 'tests', 'fixtures', 'quarantine_verdict_cases.json')
const cases = (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { cases: Case[] }).cases

describe('the quarantine verdict contract', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5)
  })

  it.each(cases.map((c) => [c.name, c] as const))('reads %s', (_name, c) => {
    const expected = c.reads_as ?? c.verdict
    expect(verdictSchema.parse(c.verdict)).toEqual(expected)
    expect(quarantineVerdictOf({ quarantine: c.verdict })).toEqual(expected)
    expect(quarantineVerdictOf({ errorMessage: `quarantined:${JSON.stringify(c.verdict)}` })).toEqual(expected)
  })

  it.each(cases.map((c) => [c.name, c] as const))('stores %s as the job wrote it', (_name, c) => {
    expect(storedQuarantineVerdictOf({ quarantine: c.verdict })).toEqual(c.verdict)
  })
})
