// @disk-inputs: tests/fixtures/setup-parity.json
/**
 * @vitest-environment node
 *
 * Zero diffs on Austrian profiles (ADR-0169). `tests/fixtures/setup-parity.json`
 * was written by develop's code, before the setup read its facts from records:
 * for 400 generated profiles, the needs, the derivations, the location
 * register and the profile a derivation writes, each as a hash. This tree must
 * give the same four readings for every profile placed in Austria.
 *
 * Profiles nothing places, and those placed abroad, are listed by name with
 * what changed on purpose (fail closed: no Austrian register for a project in
 * no country). The list is exact, so a new difference fails here too.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parityCases, parityRow } from './setup-parity.fixtures'

type Row = ReturnType<typeof parityRow>

const FIXTURE: Row[] = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/setup-parity.json'), 'utf8'))
const ROWS = parityCases().map(parityRow)
const READINGS = ['needs', 'derivations', 'register', 'derived'] as const

/** The readings of one row that differ from develop's. */
function differences(index: number): string[] {
  return READINGS.filter((reading) => ROWS[index][reading] !== FIXTURE[index][reading])
}

/**
 * What a project outside Austria reads differently, on purpose. Develop kept a
 * confirmed building class input on the needs list (as `confirmed`, so a
 * reading could corroborate it) for every project, the OIB's inputs being the
 * only ones; now a project keeps the inputs of the classification its site
 * selects, and outside Austria that is none. `needs.spec.ts` pins the cause.
 */
const KNOWN_ABROAD_CHANGES = ['needs']

/** The same for a project nothing places. */
const KNOWN_UNPLACED_CHANGES = ['needs']

describe('the setup on records, against develop', () => {
  it('runs on the same 400 profiles develop ran on', () => {
    expect(ROWS.map(({ name, placement }) => ({ name, placement }))).toEqual(
      FIXTURE.map(({ name, placement }) => ({ name, placement }))
    )
  })

  it('reads every profile placed in Austria exactly as develop did', () => {
    const austrian = ROWS.flatMap((row, index) => (row.placement === 'austria' ? [index] : []))
    expect(austrian.length).toBeGreaterThan(100)
    const changed = austrian.flatMap((index) => differences(index).map((reading) => `${ROWS[index].name}: ${reading}`))
    expect(changed).toEqual([])
  })

  it.each([
    ['unplaced', KNOWN_UNPLACED_CHANGES],
    ['abroad', KNOWN_ABROAD_CHANGES],
  ] as const)('changes for a project %s only what is listed, on purpose', (placement, known) => {
    const changed = new Set(ROWS.flatMap((row, index) => (row.placement === placement ? differences(index) : [])))
    expect([...changed].sort()).toEqual(known)
  })
})
