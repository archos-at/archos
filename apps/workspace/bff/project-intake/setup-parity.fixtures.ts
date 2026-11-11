/**
 * The profiles the setup parity harness runs on (ADR-0169), and what it reads
 * off each. The same generator ran on develop before setup facts became
 * records and wrote `tests/fixtures/setup-parity.json`; `setup-parity.spec.ts`
 * runs it on this tree and compares. Seeded, so both runs see the same
 * profiles: a change here regenerates the fixture from develop's code, never
 * from this tree's.
 */

import { createHash } from 'node:crypto'
import fc from 'fast-check'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import { deriveAll, withDerivedClass } from './derivation-view'
import { locationRegisterFor } from './location-register'
import { computeNeeds } from './needs'
import type { IntakeMode } from './types'
import { AT_SETUP_RECORDS } from './at-setup.fixtures'

const AT = '2026-11-10T00:00:00.000Z'

/** How a profile is placed: the parity holds for every placement in Austria; the others are listed with their reason. */
export type Placement = 'austria' | 'unplaced' | 'abroad' | 'contradictory'

export interface ParityCase {
  name: string
  placement: Placement
  profile: ProjectProfile
  location: { federalState: string | null; municipality: string | null } | null
  mode: IntakeMode
}

const maybe = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined, freq: 3 })

const LANDS = ['vienna', 'lower_austria', 'upper_austria', 'styria', 'carinthia', 'salzburg', 'tyrol', 'vorarlberg', 'burgenland']

const buildingInputs = fc.record({
  building_type: maybe(fc.constantFrom('building', 'small', 'other')),
  building_position: maybe(fc.constantFrom('freestanding', 'attached', 'terraced')),
  access_three_sides: maybe(fc.constantFrom<ProjectPrimitiveValue>(true, false)),
  storeys_above_ground: maybe(fc.constantFrom(1, 3, 4, 5, 9)),
  escape_level_m: maybe(fc.constantFrom(2, 7, 7.01, 11, 11.01, 22, 22.01, 40)),
  gfa_above_ground: maybe(fc.constantFrom(90, 400, 400.5, 800, 800.5, 3000)),
  use_units: maybe(fc.constantFrom(1, 2, 3, 20)),
  units_over_400: maybe(fc.boolean()),
  uses: maybe(fc.constantFrom<string[]>(['residential'], ['residential', 'garage'], ['office'])),
  construction_status: maybe(fc.constantFrom('new_build', 'existing')),
})

const site = fc.record({
  country: maybe(fc.constantFrom('at', 'de', 'ch', 'other')),
  federal_state: maybe(fc.constantFrom(...LANDS, 'outside_austria')),
  // Facts or suggestions: a typed address and a reading place a project as unverified.
  siteAsSuggestion: fc.boolean(),
  location: fc.option(
    fc.record({
      federalState: fc.option(fc.constantFrom(...LANDS), { nil: null }),
      municipality: fc.option(fc.constantFrom('Graz', 'Salzburg', 'Linz', 'Wien'), { nil: null }),
    }),
    { nil: null }
  ),
})

const project = fc.record({
  work_type: maybe(fc.constantFrom<string[]>(['new_build'], ['conversion'], ['refurbishment'], ['demolition'])),
  plot_area: maybe(fc.constantFrom(450, 1200)),
  zoning: maybe(fc.constantFrom('residential', 'mixed')),
  inputsAsSuggestion: fc.boolean(),
  mode: fc.constantFrom<IntakeMode>('active', 'closing'),
})


function placementOf(country: string | undefined, federalState: string | undefined): Placement {
  // Austria, and a Land „außerhalb Österreichs": develop's register read it as abroad, its derivation as Austria.
  if (country === 'at' && federalState === 'outside_austria') return 'contradictory'
  if (country === 'at') return 'austria'
  if (country !== undefined) return 'abroad'
  if (federalState === 'outside_austria') return 'abroad'
  return federalState === undefined ? 'unplaced' : 'austria'
}

/** The generated cases, in a fixed order: the same 400 on every run. */
export function parityCases(): ParityCase[] {
  const sample = fc.sample(fc.tuple(site, project, buildingInputs), { seed: 20261110, numRuns: 400 })
  return sample.map(([where, what, building], index) => {
    const profile = emptyProjectProfile()
    const put = (key: string, value: ProjectPrimitiveValue | undefined, suggested: boolean) => {
      if (value === undefined) return
      if (suggested)
        profile.assumptions[key] = { value, status: 'unconfirmed', reason: 'Gelesen', source: 'agent_suggested', updatedAt: AT }
      else profile.facts[key] = { value, confidence: 'confirmed', source: 'onboarding', updatedAt: AT }
    }
    put('country', where.country, where.siteAsSuggestion)
    put('federal_state', where.federal_state, where.siteAsSuggestion)
    put('work_type', what.work_type, false)
    put('plot_area', what.plot_area, false)
    put('zoning', what.zoning, what.inputsAsSuggestion)
    for (const [key, value] of Object.entries(building)) put(`${key}@bldg1`, value, what.inputsAsSuggestion)
    return {
      name: `case ${index}`,
      placement: placementOf(where.country, where.federal_state),
      profile,
      location: where.location,
      mode: what.mode,
    }
  })
}

/** What the setup reads off one case: the views a person sees and the profile a derivation writes. */
export function setupReadings(parityCase: ParityCase) {
  const { profile, location, mode } = parityCase
  const definition = projectIntakeDefinitionV1
  const needs = computeNeeds(profile, definition, { mode, dismissed: [], records: AT_SETUP_RECORDS })
  return {
    needs,
    derivations: deriveAll(profile, definition, { records: AT_SETUP_RECORDS }),
    register: locationRegisterFor({ profile, location, mode, needs, records: AT_SETUP_RECORDS }),
    derived: withDerivedClass(profile, definition, 'bldg1', AT, { records: AT_SETUP_RECORDS }),
  }
}

/** JSON with sorted keys: two readings that are deep-equal hash the same, whatever order their keys were built in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** One case as the fixture holds it: each reading as a short hash of its canonical JSON. */
export function parityRow(parityCase: ParityCase) {
  const readings = setupReadings(parityCase)
  const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16)
  return {
    name: parityCase.name,
    placement: parityCase.placement,
    needs: hash(readings.needs),
    derivations: hash(readings.derivations),
    register: hash(readings.register),
    derived: hash(readings.derived),
  }
}
