/**
 * @vitest-environment node
 *
 * Where a project's knowledge context withholds law (an office not entitled to
 * Austria, an unreadable context, an unplaced site), `classification-evaluate`
 * answers undetermined, and so does every other door to the Gebäudeklasse
 * (ADR-0169's amendment): the intake's derivations, the class a reading
 * writes into the profile, and the profile a person reads. A class a document
 * stated or a person confirmed is the office's own, and stays.
 */

import { describe, expect, it } from 'vitest'
import { projectIntakeDefinitionV1 as definition } from '@/lib/project-profile/intake-definition'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import type { ProjectIntakeRow } from '@/lib/db/schema/project-intakes'
import { buildingClassKey, deriveAll, profileAsTheLawShows, withDerivedClass, withoutDerivedClasses } from './derivation-view'
import { planRecord, planRederive, type ScreenedValue } from './record'
import { buildIntakeView } from './view'
import { AT_SETUP_RECORDS } from './at-setup.fixtures'

const NOW = '2026-11-10T09:00:00.000Z'
const CLASS = buildingClassKey('bldg1')

/** A Viennese block of flats with every input the OIB's derivation reads, confirmed. */
function vienna(): ProjectProfile {
  const profile = emptyProjectProfile()
  const confirmed = (key: string, value: ProjectPrimitiveValue) => {
    profile.facts[key] = { value, confidence: 'confirmed', source: 'onboarding', updatedAt: NOW }
  }
  confirmed('country', 'at')
  confirmed('federal_state', 'vienna')
  const building: Record<string, ProjectPrimitiveValue> = {
    building_type: 'building',
    building_position: 'freestanding',
    access_three_sides: true,
    storeys_above_ground: 3,
    escape_level_m: 7,
    gfa_above_ground: 800,
    use_units: 3,
    units_over_400: false,
    uses: ['residential'],
  }
  for (const [key, value] of Object.entries(building)) confirmed(`${key}@bldg1`, value)
  return profile
}

const records = AT_SETUP_RECORDS
const derived = () => withDerivedClass(vienna(), definition, 'bldg1', NOW, { records }).profile

describe('a class while the knowledge context withholds law', () => {
  it('is derived and written where law is named, so the cases below test something', () => {
    expect(deriveAll(vienna(), definition, { records })[0]?.value).not.toBeNull()
    expect(derived().assumptions[CLASS]?.value).toBeDefined()
  })

  it('is neither derived nor written, and a derived one already written goes', () => {
    expect(deriveAll(vienna(), definition, { lawWithheld: true, records })).toEqual([])
    expect(withDerivedClass(vienna(), definition, 'bldg1', NOW, { lawWithheld: true, records }).profile.assumptions[CLASS]).toBeUndefined()
    expect(withDerivedClass(derived(), definition, 'bldg1', NOW, { lawWithheld: true, records }).profile.assumptions[CLASS]).toBeUndefined()
  })

  it('is not shown on the profile a person reads, but a class a document stated stays', () => {
    expect(withoutDerivedClasses(derived(), definition).assumptions[CLASS]).toBeUndefined()
    const stated = vienna()
    stated.assumptions[CLASS] = { value: 4, status: 'unconfirmed', reason: 'Plankopf', source: 'agent_suggested', updatedAt: NOW, evidence: [{ kind: 'document', fileName: 'Einreichplan.pdf', page: 1, quote: 'Gebäudeklasse 4' }] }
    expect(withoutDerivedClasses(stated, definition).assumptions[CLASS]?.value).toBe(4)
  })

  it('is not in the intake the review shows', () => {
    const row = { projectId: 'p1', status: 'read', mode: 'active', documentsRead: [] } as unknown as ProjectIntakeRow
    const input = { row, profile: derived(), definition, needs: [], records, unreadDocuments: 0, canDecide: true, canComplete: false }
    const named = buildIntakeView({ ...input, applicableLaw: { gate: 'core', uses: [], factLabels: {} } })
    expect(named.derivations[0]?.value).not.toBeNull()
    const withheld = buildIntakeView({ ...input, applicableLaw: { gate: 'not_entitled', uses: [], factLabels: {} } })
    expect(withheld.derivations).toEqual([])
    expect(JSON.stringify(withheld)).not.toContain(CLASS)
  })
})

describe('a stored derived class while law is withheld', () => {
  const evidence = { kind: 'document' as const, fileName: 'Einreichplan.pdf', page: 2, quote: '4 Geschosse' }
  const storeys: ScreenedValue = { key: 'storeys_above_ground@bldg1', value: 4, evidence, reason: 'Schnitt' }
  const context = (lawWithheld: boolean) => ({
    now: NOW,
    readingId: 'job-1',
    needs: { mode: 'active' as const, dismissed: [], records },
    records,
    lawWithheld,
  })

  it('stays when a reading writes intake values, as while the setup is unpublished', () => {
    const plan = planRecord(derived(), definition, [{ key: storeys.key, screened: storeys, refusal: null }], context(true))
    expect(plan.profile.assumptions[CLASS]).toEqual(derived().assumptions[CLASS])
    expect(plan.changedKeys).not.toContain(CLASS)
  })

  it('is derived again where law is named (the off case)', () => {
    const plan = planRecord(derived(), definition, [{ key: storeys.key, screened: storeys, refusal: null }], context(false))
    expect(plan.results[0]?.outcome).toBe('contradiction')
    expect(plan.profile.assumptions[CLASS]?.value).toBeDefined()
  })

  it('is hidden, not deleted, by the one rule the page, the profile route and the prompt view share', () => {
    const stored = derived()
    expect(profileAsTheLawShows(stored, definition, 'core')).toBe(stored)
    expect(profileAsTheLawShows(stored, definition, null)).toBe(stored)
    for (const gate of ['none', 'site_unknown', 'knowledge_unavailable', 'not_entitled'] as const)
      expect(profileAsTheLawShows(stored, definition, gate).assumptions[CLASS]).toBeUndefined()
    expect(stored.assumptions[CLASS]).toBeDefined()
  })
})

describe('the one-time derivation after a release (planRederive)', () => {
  it('derives every building with no new value, and moves nothing a second time', () => {
    const first = planRederive(vienna(), definition, { now: NOW, records, lawWithheld: false })
    expect(first.changedKeys).toEqual([CLASS])
    expect(first.profile.assumptions[CLASS]?.value).toBeDefined()
    const second = planRederive(first.profile, definition, { now: NOW, records, lawWithheld: false })
    expect(second.changedKeys).toEqual([])
    expect(second.profile).toBe(first.profile)
  })

  it('changes nothing while law is withheld or no records are released', () => {
    const stored = derived()
    expect(planRederive(stored, definition, { now: NOW, records, lawWithheld: true })).toEqual({ profile: stored, changedKeys: [] })
    expect(planRederive(vienna(), definition, { now: NOW, records: [], lawWithheld: false }).changedKeys).toEqual([])
  })
})
