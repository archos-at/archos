/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { modeKeyFor } from './intake-building-keys'
import { answersFromProfile, buildIntakeProfile } from './intake-profile'
import type { ProjectPrimitiveValue, ProjectProfile } from './types'
import { definition } from './intake-definition.fixtures'

describe('v1.0 → v1.2 legacy bridges (answersFromProfile)', () => {
  const fact = (value: ProjectPrimitiveValue) => ({
    value,
    confidence: 'confirmed' as const,
    source: 'user_confirmed' as const,
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const empty: ProjectProfile = { facts: {}, goals: {}, unknowns: [], assumptions: {} }

  it('inverts the stored ne_unter_400 into C8 instead of reusing its key', () => {
    const allSmall = answersFromProfile(
      { ...empty, facts: { 'units_under_400@bldg1': fact(true) } },
      definition
    )
    expect(allSmall.answers['C8@bldg1']).toBe('no')

    const hasLarge = answersFromProfile(
      { ...empty, facts: { 'units_under_400@bldg1': fact(false) } },
      definition
    )
    expect(hasLarge.answers['C8@bldg1']).toBe('yes')
  })

  it('keeps an openly-unknown ne_unter_400 open', () => {
    const restored = answersFromProfile({ ...empty, unknowns: ['units_under_400@bldg1'] }, definition)
    expect(restored.answers['C8@bldg1']).toBe('open')
  })

  it('C8 writes einheiten_ueber_400, never the legacy key', () => {
    const profile = buildIntakeProfile(
      {
        'C1@bldg1': 'building',
        'C3@bldg1': 3,
        [modeKeyFor('C3@bldg1')]: 'value',
        'C8@bldg1': 'yes',
      },
      definition
    )
    expect(profile.facts['units_over_400@bldg1']?.value).toBe(true)
    expect(profile.facts['units_under_400@bldg1']).toBeUndefined()
  })

  it('moves the project-scope Bestand block onto the single building', () => {
    const restored = answersFromProfile(
      { ...empty, facts: { existing_year_built: fact(1962), heritage_protection: fact(true) } },
      definition
    )
    expect(restored.answers['CB1@bldg1']).toBe(1962)
    expect(restored.answers[modeKeyFor('CB1@bldg1')]).toBe('value')
    expect(restored.answers['CB3@bldg1']).toBe('yes')
    expect(restored.answers['C2@bldg1']).toBe('existing')
  })

  it('does NOT guess which of several buildings a legacy Bestand answer describes', () => {
    const restored = answersFromProfile(
      {
        ...empty,
        facts: {
          existing_year_built: fact(1962),
          'building_name@bldg1': fact('Haupthaus'),
          'building_name@bldg2': fact('Hoftrakt'),
        },
      },
      definition
    )
    expect(restored.answers['CB1@bldg1']).toBeUndefined()
    expect(restored.answers['CB1@bldg2']).toBeUndefined()
  })

  it('folds the legacy Altlast/Baum/Schutzgebiet booleans into B4', () => {
    const restored = answersFromProfile(
      {
        ...empty,
        facts: {
          hazard_zones: fact(['flood_hq100']),
          contaminated_land: fact(true),
          protected_area: fact(true),
          tree_stock: fact(false),
        },
      },
      definition
    )
    expect(restored.answers['B4']).toEqual(['flood_hq100', 'contaminated_land', 'protected_area'])
  })

  it('condenses the three Erschließungs-booleans, refusing a partial picture', () => {
    const full = answersFromProfile(
      {
        ...empty,
        facts: { sewer: fact(true), drinking_water: fact(true), fire_brigade_access: fact(true) },
      },
      definition
    )
    expect(full.answers['B6']).toBeUndefined()

    const mixed = answersFromProfile(
      {
        ...empty,
        facts: { sewer: fact(true), drinking_water: fact(false), fire_brigade_access: fact(true) },
      },
      definition
    )
    expect(mixed.answers['B6']).toBe('partial')

    const partial = answersFromProfile({ ...empty, facts: { sewer: fact(true) } }, definition)
    expect(partial.answers['B6']).toBeUndefined()
  })

  it('maps Fernwärme booleans onto the status select, Anschlussgebiet first', () => {
    const zone = answersFromProfile(
      { ...empty, facts: { district_heating: fact(true), district_heating_zone: fact(true) } },
      definition
    )
    expect(zone.answers['B7']).toBe('connection_area')

    const available = answersFromProfile(
      { ...empty, facts: { district_heating: fact(true) } },
      definition
    )
    expect(available.answers['B7']).toBe('available')
  })

  it('maps the legacy single Bauweise token into the multi-select', () => {
    const restored = answersFromProfile(
      { ...empty, facts: { 'construction_method@bldg1': fact('massivbau') } },
      definition
    )
    expect(restored.answers['C10@bldg1']).toEqual(['masonry_solid'])
  })

  it('does not silently drop a legacy hybrid Bauweise', () => {
    const restored = answersFromProfile(
      { ...empty, facts: { 'construction_method@bldg1': fact('hybrid') } },
      definition
    )
    expect(restored.answers['C10@bldg1']).toEqual(['open'])
  })

  it('carries a legacy Zertifizierung into the fused F4', () => {
    const restored = answersFromProfile(
      {
        ...empty,
        facts: { funding: fact(['housing_subsidy']), certification: fact('klimaaktiv') },
      },
      definition
    )
    expect(restored.answers['F4']).toEqual(['housing_subsidy', 'klimaaktiv'])
  })

  it('appends the merged G-texts instead of overwriting', () => {
    const restored = answersFromProfile(
      {
        ...empty,
        facts: {
          context_description: fact('Ein Wohnhaus.'),
          context_plot: fact('Hanglage.'),
          context_other: fact('Noch etwas.'),
        },
      },
      definition
    )
    expect(restored.answers['G1']).toBe('Ein Wohnhaus.\n\nHanglage.')
    expect(restored.answers['G4']).toBe('Noch etwas.')
  })

  it('folds the four legacy Technik booleans into E2', () => {
    const restored = answersFromProfile(
      {
        ...empty,
        facts: {
          'pv@bldg1': fact(true),
          'infiltration@bldg1': fact(true),
          'cooling@bldg1': fact(false),
        },
      },
      definition
    )
    expect(restored.answers['E2@bldg1']).toEqual(['pv', 'infiltration'])
  })
})

describe('v1.0 → v1.2 bridges — the second review pass', () => {
  const fact = (value: ProjectPrimitiveValue) => ({
    value,
    confidence: 'confirmed' as const,
    source: 'user_confirmed' as const,
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const empty: ProjectProfile = { facts: {}, goals: {}, unknowns: [], assumptions: {} }

  it('keeps a legacy hybrid Bauweise instead of dropping the fact', () => {
    const restored = answersFromProfile(
      { ...empty, facts: { 'construction_method@bldg1': fact('hybrid') } },
      definition
    )

    expect(restored.answers['C10@bldg1']).toEqual(['open'])
    expect(String(restored.answers['C10_text@bldg1'])).toContain('Hybrid')
  })

  it('does not overwrite a description the user already wrote', () => {
    const restored = answersFromProfile(
      {
        ...empty,
        facts: {
          'construction_method@bldg1': fact('hybrid'),
          'construction_method_description@bldg1': fact('EG Stahlbeton, ab 1. OG Holzbau'),
        },
      },
      definition
    )
    expect(restored.answers['C10_text@bldg1']).toBe('EG Stahlbeton, ab 1. OG Holzbau')
  })

  it('appends a legacy G-text once, however often the profile is reopened', () => {
    const first = answersFromProfile(
      {
        ...empty,
        facts: {
          context_description: fact('Ein Wohnhaus.'),
          context_plot: fact('Hanglage.'),
        },
      },
      definition
    )
    expect(first.answers['G1']).toBe('Ein Wohnhaus.\n\nHanglage.')

    const reopened = answersFromProfile(
      {
        ...empty,
        facts: {
          context_description: fact('Ein Wohnhaus.\n\nHanglage.'),
          context_plot: fact('Hanglage.'),
        },
      },
      definition
    )
    expect(reopened.answers['G1']).toBe('Ein Wohnhaus.\n\nHanglage.')
  })
})
