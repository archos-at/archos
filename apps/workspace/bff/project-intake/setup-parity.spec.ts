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

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { AUSTRIA_RELEASED, parityCases, parityRow } from './setup-parity.fixtures'

type Row = ReturnType<typeof parityRow>

const FIXTURE: Row[] = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/setup-parity.json'), 'utf8'))
const ROWS = parityCases().map((parityCase) => parityRow(parityCase))
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

/**
 * A project nothing places: the same, and its register. Develop listed
 * Austria's documents for a project in no country; the register now reads the
 * records of the country the site selects, and an unplaced site selects none,
 * so it asks for the site and requests no document.
 */
const KNOWN_UNPLACED_CHANGES = ['needs', 'register']

/**
 * `country=at` beside the Land „außerhalb Österreichs": develop's register read
 * it as abroad and its derivation as Austria. It is now read one way, as in no
 * country the records name, so no class is derived either (fail closed).
 */
const KNOWN_CONTRADICTORY_CHANGES = ['derivations', 'needs']

/**
 * develop's intake definition, serialised: the wizard's Bundesland options are
 * now read from Austria's `fact_definitions` record, and every byte of the
 * definition the wizard and the server read must stay what it was.
 */
const DEVELOP_DEFINITION_SHA256 = '2b5ee035811897218af4cfc63d9aff2d36b45456b39183321f34b54bbe69b5fa'

describe('the setup on records, against develop', () => {
  it('builds the intake definition byte for byte as develop did', () => {
    const sha = createHash('sha256').update(JSON.stringify(projectIntakeDefinitionV1)).digest('hex')
    expect(sha).toBe(DEVELOP_DEFINITION_SHA256)
  })

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
    ['contradictory', KNOWN_CONTRADICTORY_CHANGES],
  ] as const)('changes for a project %s only what is listed, on purpose', (placement, known) => {
    const changed = new Set(ROWS.flatMap((row, index) => (row.placement === placement ? differences(index) : [])))
    expect([...changed].sort()).toEqual(known)
  })

  it('reads every profile the same once Austria’s pack is released as from the build’s records', () => {
    expect(AUSTRIA_RELEASED.some((record) => record.id.startsWith('shipped:'))).toBe(false)
    const released = parityCases().map((parityCase) => parityRow(parityCase, AUSTRIA_RELEASED))
    expect(released).toEqual(ROWS)
  })
})
