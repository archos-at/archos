/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { modeKeyFor } from './intake-building-keys'
import { answersFromProfile, buildIntakeProfile } from './intake-profile'
import { ProjectProfileSchema } from './types'
import { definition } from './intake-definition.fixtures'
import type { Answers } from './intake-definition.fixtures'

describe('buildIntakeProfile', () => {
  it('writes confirmed facts through the shared patch engine', () => {
    const answers: Answers = {
      A2_country: 'at',
      A2_land: 'tyrol',
      A2_adr: 'Innrain 1, 6020 Innsbruck',
      A5: ['new_build'],
    }

    const profile = buildIntakeProfile(answers, definition)

    expect(() => ProjectProfileSchema.parse(profile)).not.toThrow()
    expect(profile.facts.federal_state?.value).toBe('tyrol')
    expect(profile.facts.federal_state?.source).toBe('onboarding')
    expect(profile.facts.federal_state?.confidence).toBe('confirmed')
    expect(profile.facts.site_address?.value).toBe('Innrain 1, 6020 Innsbruck')
    expect(profile.facts.work_type?.value).toEqual(['new_build'])
  })

  it('seeds project_name from the created project instead of asking again', () => {
    const profile = buildIntakeProfile({}, definition, { projectName: '  Haus am See ' })

    expect(profile.facts.project_name?.value).toBe('Haus am See')
    expect(profile.facts.project_name?.source).toBe('onboarding')
    expect(profile.facts.project_name?.confidence).toBe('confirmed')
  })

  it('lets an explicit A1 answer override the seeded project name', () => {
    const profile = buildIntakeProfile({ A1: 'Renamed Project' }, definition, {
      projectName: 'Seed',
    })
    expect(profile.facts.project_name?.value).toBe('Renamed Project')
  })

  it('captures the federal state as a confirmed fact (jurisdiction is a hard fact)', () => {
    const profile = buildIntakeProfile({ A2_country: 'at', A2_land: 'tyrol' }, definition)

    expect(profile.facts.federal_state?.value).toBe('tyrol')
    expect(profile.facts.federal_state?.confidence).toBe('confirmed')
    expect(profile.unknowns).not.toContain('federal_state')
    expect(profile.unknowns).not.toContain('site_details')
  })

  it('records the missing federal state as an unknown', () => {
    const profile = buildIntakeProfile({ A2_country: 'at', A5: ['new_build'] }, definition)
    expect(profile.unknowns).toContain('federal_state')
  })

  it('asks for a free-text location only outside Austria', () => {
    const profile = buildIntakeProfile({ A2_country: 'de' }, definition)
    expect(profile.unknowns).toContain('site_details')

    const withDetails = buildIntakeProfile(
      { A2_country: 'de', site_details: 'Bayern, Deutschland' },
      definition
    )
    expect(withDetails.facts.site_details?.value).toBe('Bayern, Deutschland')
    expect(withDetails.facts.federal_state?.value).toBe('outside_austria')
  })

  it('maps the number_tri answer modes onto facts / assumptions / unknowns', () => {
    const base: Answers = { 'C1@bldg1': 'building' }

    const confirmed = buildIntakeProfile(
      { ...base, 'C3@bldg1': 3, [modeKeyFor('C3@bldg1')]: 'value' },
      definition
    )
    expect(confirmed.facts['storeys_above_ground@bldg1']?.value).toBe(3)

    const estimated = buildIntakeProfile(
      { ...base, 'C3@bldg1': 4, [modeKeyFor('C3@bldg1')]: 'estimated' },
      definition
    )
    expect(estimated.facts['storeys_above_ground@bldg1']).toBeUndefined()
    expect(estimated.assumptions['storeys_above_ground@bldg1']?.value).toBe(4)
    expect(estimated.assumptions['storeys_above_ground@bldg1']?.status).toBe('unconfirmed')

    const open = buildIntakeProfile({ ...base, [modeKeyFor('C3@bldg1')]: 'open' }, definition)
    expect(open.unknowns).toContain('storeys_above_ground@bldg1')
  })

  it('derives federal_state=outside_austria when country is de', () => {
    const profile = buildIntakeProfile({ A2_country: 'de' }, definition)
    expect(profile.facts.federal_state?.value).toBe('outside_austria')
  })

  it('derives country=at from an AT bundesland for legacy profiles', () => {
    const profile = buildIntakeProfile(
      { A2_country: 'at', A2_land: 'vienna', A2_adr: 'Test', A5: ['new_build'] },
      definition,
      { projectName: 'Test' }
    )
    expect(profile.facts.country?.value).toBe('at')
    expect(profile.facts.federal_state?.value).toBe('vienna')
  })

  it('leaves bundesland unset when country is de and standort_details provided', () => {
    const profile = buildIntakeProfile(
      { A2_country: 'de', site_details: 'Bayern, Deutschland' },
      definition,
      { projectName: 'Test' }
    )
    expect(profile.facts.federal_state?.value).toBe('outside_austria')
    expect(profile.facts.site_details?.value).toBe('Bayern, Deutschland')
  })

  it('maps yes_no_open onto a boolean fact or an unknown', () => {
    const yes = buildIntakeProfile({ B8: 'yes' }, definition)
    expect(yes.facts.build_to_plot_boundary?.value).toBe(true)

    const no = buildIntakeProfile({ B8: 'no' }, definition)
    expect(no.facts.build_to_plot_boundary?.value).toBe(false)

    const open = buildIntakeProfile({ B8: 'open' }, definition)
    expect(open.facts.build_to_plot_boundary).toBeUndefined()
    expect(open.unknowns).toContain('build_to_plot_boundary')
  })

  it('expands the building scope over every building and the zone scope over selected uses', () => {
    const buildings = [
      { id: 'bldg1', name: 'Haupthaus' },
      { id: 'bldg2', name: 'Nebengebäude' },
    ]
    const answers: Answers = {
      'C1@bldg1': 'building',
      'C3@bldg1': 5,
      [modeKeyFor('C3@bldg1')]: 'value',
      'C1@bldg2': 'building',
      'D0@bldg1': ['residential'],
      'D_we@bldg1@residential': 12,
      [modeKeyFor('D_we@bldg1@residential')]: 'value',
    }

    const profile = buildIntakeProfile(answers, definition, { buildings })

    expect(profile.facts['storeys_above_ground@bldg1']?.value).toBe(5)
    expect(profile.facts['building_name@bldg1']?.value).toBe('Haupthaus')
    expect(profile.facts['building_name@bldg2']?.value).toBe('Nebengebäude')
    expect(profile.facts['dwelling_units@bldg1@residential']?.value).toBe(12)
  })
})

describe('answersFromProfile', () => {
  it('round-trips a built profile back into wizard answers and the building list', () => {
    const buildings = [{ id: 'bldg1', name: 'Haupthaus' }]
    const answers: Answers = {
      A2_country: 'at',
      A2_land: 'vienna',
      A5: ['new_build', 'conversion'],
      'C1@bldg1': 'building',
      'C5@bldg1': 9,
      [modeKeyFor('C5@bldg1')]: 'estimated',
      B8: 'yes',
    }

    const profile = buildIntakeProfile(answers, definition, { buildings })
    const restored = answersFromProfile(profile, definition)

    expect(restored.answers.A2_land).toBe('vienna')
    expect(restored.answers.A5).toEqual(['new_build', 'conversion'])
    expect(restored.answers['C1@bldg1']).toBe('building')
    expect(restored.answers['C5@bldg1']).toBe(9)
    expect(restored.answers[modeKeyFor('C5@bldg1')]).toBe('estimated')
    expect(restored.answers.B8).toBe('yes')
    expect(restored.buildings).toEqual([{ id: 'bldg1', name: 'Haupthaus' }])
  })
})
