/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { modeKeyFor } from './intake-building-keys'
import { buildIntakeProfile, mergeIntakeProfile } from './intake-profile'
import { ProjectProfileSchema } from './types'
import type {
  ProfileAlternative,
  ProfileEvidence,
  ProjectAssumption,
  ProjectFact,
  ProjectPrimitiveValue,
  ProjectProfile,
} from './types'
import { definition } from './intake-definition.fixtures'

describe('mergeIntakeProfile', () => {
  const fact = (value: ProjectPrimitiveValue) => ({
    value,
    confidence: 'confirmed' as const,
    source: 'user_confirmed' as const,
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  const storedProfile: ProjectProfile = {
    facts: {
      federal_state: fact('vienna'),
      brandabschnitt_flaeche: fact(1200),
    },
    goals: { zieltermin: '2027-03-01' },
    unknowns: ['statik_gutachten'],
    assumptions: {
      land_designation: {
        value: 'bauland',
        status: 'unconfirmed' as const,
        reason: 'agent guess',
        source: 'agent_suggested' as const,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  }

  it('preserves agent-recorded novel facts, goals, unknowns, and assumptions', () => {
    const built = buildIntakeProfile({ A2_country: 'at', A2_land: 'tyrol' }, definition)
    const merged = mergeIntakeProfile(built, storedProfile, definition)

    expect(merged.facts.federal_state?.value).toBe('tyrol')
    expect(merged.facts.brandabschnitt_flaeche?.value).toBe(1200)
    expect(merged.goals.zieltermin).toBe('2027-03-01')
    expect(merged.unknowns).toContain('statik_gutachten')
    expect(merged.assumptions.land_designation?.value).toBe('bauland')
    expect(() => ProjectProfileSchema.parse(merged)).not.toThrow()
  })

  it('does NOT resurrect an intake answer the user just cleared', () => {
    const built = buildIntakeProfile({ A2_country: 'at' }, definition)
    const merged = mergeIntakeProfile(built, storedProfile, definition)

    expect(merged.facts.federal_state).toBeUndefined()
    expect(merged.unknowns).toContain('federal_state')
  })

  it('returns the built profile unchanged when there is no stored profile', () => {
    const built = buildIntakeProfile({ A2_country: 'at', A2_land: 'vienna' }, definition)
    expect(mergeIntakeProfile(built, null, definition)).toBe(built)
  })

  describe('what a reading left (ADR-0111)', () => {
    const NOW = '2026-01-01T00:00:00.000Z'
    const evidenceOn = (quote: string): ProfileEvidence[] => [
      { kind: 'document', fileName: 'Baubeschreibung.pdf', page: 4, quote },
    ]
    const suggestion = (
      value: ProjectPrimitiveValue,
      extra: Partial<ProjectAssumption> = {}
    ): ProjectAssumption => ({
      value,
      status: 'unconfirmed',
      reason: 'Baubeschreibung.pdf, S. 4',
      source: 'agent_suggested',
      updatedAt: NOW,
      evidence: evidenceOn('3 oberirdische Geschoße'),
      ...extra,
    })
    const alternative = (value: ProjectPrimitiveValue): ProfileAlternative => ({
      value,
      evidence: evidenceOn('laut Einreichplan'),
      recordedAt: NOW,
    })
    const previousWith = (partial: Partial<ProjectProfile>): ProjectProfile => ({
      facts: {},
      goals: {},
      unknowns: [],
      assumptions: {},
      ...partial,
    })

    it('keeps an agent suggestion under an intake key when the save does not answer that key', () => {
      const previous = previousWith({
        assumptions: {
          'storeys_above_ground@bldg1': suggestion(3),
          federal_state: suggestion('tyrol'),
        },
      })
      const built = buildIntakeProfile({ A2_country: 'at', A2_land: 'vienna' }, definition)

      const merged = mergeIntakeProfile(built, previous, definition)

      expect(merged.assumptions['storeys_above_ground@bldg1']).toEqual(
        previous.assumptions['storeys_above_ground@bldg1']
      )
      expect(merged.facts.federal_state?.value).toBe('vienna')
      expect(merged.assumptions.federal_state).toBeUndefined()
    })

    it('drops a suggestion the save estimates instead', () => {
      const previous = previousWith({ assumptions: { 'storeys_above_ground@bldg1': suggestion(3) } })
      const built = buildIntakeProfile(
        { 'C1@bldg1': 'building', 'C3@bldg1': 4, [modeKeyFor('C3@bldg1')]: 'estimated' },
        definition,
        { buildings: [{ id: 'bldg1', name: 'Bauwerk 1' }] }
      )
      expect(built.assumptions['storeys_above_ground@bldg1']?.source).toBe('onboarding_default')

      const merged = mergeIntakeProfile(built, previous, definition)

      expect(merged.assumptions['storeys_above_ground@bldg1']).toMatchObject({
        value: 4,
        source: 'onboarding_default',
      })
    })

    it('carries the evidence when the confirmed value is the suggested one', () => {
      const previous = previousWith({
        assumptions: { federal_state: suggestion('vienna', { evidence: evidenceOn('Wien') }) },
      })
      const built = buildIntakeProfile({ A2_country: 'at', A2_land: 'vienna' }, definition)

      const merged = mergeIntakeProfile(built, previous, definition)

      expect(merged.facts.federal_state?.evidence).toEqual(evidenceOn('Wien'))
    })

    it('carries the evidence of a previous fact when its value is unchanged, and drops it when the value changed', () => {
      const fact = (value: ProjectPrimitiveValue): ProjectFact => ({
        value,
        confidence: 'confirmed',
        source: 'user_confirmed',
        updatedAt: NOW,
        evidence: evidenceOn('Wien'),
      })
      const previous = previousWith({ facts: { federal_state: fact('vienna') } })

      const unchanged = mergeIntakeProfile(
        buildIntakeProfile({ A2_country: 'at', A2_land: 'vienna' }, definition),
        previous,
        definition
      )
      const changed = mergeIntakeProfile(
        buildIntakeProfile({ A2_country: 'at', A2_land: 'tyrol' }, definition),
        previous,
        definition
      )

      expect(unchanged.facts.federal_state?.evidence).toEqual(evidenceOn('Wien'))
      expect(changed.facts.federal_state?.value).toBe('tyrol')
      expect(changed.facts.federal_state?.evidence).toBeUndefined()
    })

    it('treats a multi-select as unchanged whatever the order of its options', () => {
      const previous = previousWith({
        facts: {
          work_type: {
            value: ['refurbishment', 'new_build'],
            confidence: 'confirmed',
            source: 'user_confirmed',
            updatedAt: NOW,
            evidence: evidenceOn('Neubau und Sanierung'),
          },
        },
      })
      const built = buildIntakeProfile(
        { A2_country: 'at', A5: ['new_build', 'refurbishment'] },
        definition
      )

      const merged = mergeIntakeProfile(built, previous, definition)

      expect(merged.facts.work_type?.evidence).toEqual(evidenceOn('Neubau und Sanierung'))
    })

    it('carries the alternatives of a fact, except the one that equals the new value', () => {
      const previous = previousWith({
        facts: {
          federal_state: {
            value: 'vienna',
            confidence: 'confirmed',
            source: 'user_confirmed',
            updatedAt: NOW,
            alternatives: [alternative('tyrol'), alternative('salzburg')],
          },
        },
      })
      const built = buildIntakeProfile({ A2_country: 'at', A2_land: 'tyrol' }, definition)

      const merged = mergeIntakeProfile(built, previous, definition)

      expect(merged.facts.federal_state?.alternatives?.map((entry) => entry.value)).toEqual([
        'salzburg',
      ])
    })

    it('carries the alternatives of a suggestion onto the fact the save writes for its key', () => {
      const previous = previousWith({
        assumptions: { federal_state: suggestion('vienna', { alternatives: [alternative('tyrol')] }) },
      })
      const built = buildIntakeProfile({ A2_country: 'at', A2_land: 'vienna' }, definition)

      const merged = mergeIntakeProfile(built, previous, definition)

      expect(merged.facts.federal_state?.alternatives?.map((entry) => entry.value)).toEqual(['tyrol'])
    })

    it("still retires the wizard's own onboarding_default assumptions under an intake key", () => {
      const previous = previousWith({
        assumptions: {
          'storeys_above_ground@bldg1': {
            value: 3,
            status: 'unconfirmed',
            reason: 'Während der Erhebung geschätzt',
            source: 'onboarding_default',
            updatedAt: NOW,
          },
        },
      })
      const built = buildIntakeProfile({ A2_country: 'at' }, definition)

      const merged = mergeIntakeProfile(built, previous, definition)

      expect(merged.assumptions['storeys_above_ground@bldg1']).toBeUndefined()
    })

    it('keeps the profile parseable', () => {
      const previous = previousWith({
        assumptions: {
          'storeys_above_ground@bldg1': suggestion(3, { alternatives: [alternative(4)] }),
        },
      })
      const merged = mergeIntakeProfile(
        buildIntakeProfile({ A2_country: 'at' }, definition),
        previous,
        definition
      )
      expect(() => ProjectProfileSchema.parse(merged)).not.toThrow()
    })
  })
})
