/**
 * @vitest-environment node
 *
 * `classification-evaluate` (ADR-0169): the existing-versus-planned delta on
 * the site's own classification, and the document for each open input. E34 is
 * the case the design names: a Viennese GK 3 Bestand gains two storeys while
 * its escape level is unknown.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/projects/repository', () => ({ findProjectProfileInOrg: vi.fn() }))
vi.mock('@/lib/base-knowledge/context/service', () => ({ knowledgeContextForTurn: vi.fn(), contextForPage: vi.fn() }))

import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ForbiddenError } from '@/lib/api/errors'
import { requireProjectAccess } from '@/lib/authz/projects'
import { knowledgeContextForTurn } from '@/lib/base-knowledge/context/service'
import type { GateState, KnowledgeContext } from '@/lib/base-knowledge/context/wire'
import { findProjectProfileInOrg, type ProjectProfileState } from '@/lib/projects/repository'
import { evaluateClassification, evaluateProjectClassification } from './classification'
import { classificationEvaluationSchema } from './classification-wire'
import { THREE_COUNTRIES, placedProfile } from './setup-countries.fixtures'

const ON = '2026-11-10'

const evaluate = (facts: Record<string, ProjectPrimitiveValue>, request = {}) => {
  const result = evaluateClassification(placedProfile(facts), projectIntakeDefinitionV1, { on: ON, ...request }, THREE_COUNTRIES)
  // Every answer is what the wire carries.
  expect(classificationEvaluationSchema.parse(result)).toEqual(result)
  return result
}

/** A Viennese Mehrparteienhaus as a Bestand: three storeys, escape level 6.5 m, GK 3. */
const VIENNA_BESTAND = {
  country: 'at',
  federal_state: 'vienna',
  'building_type@bldg1': 'building',
  'construction_status@bldg1': 'existing',
  'building_position@bldg1': 'attached',
  'access_three_sides@bldg1': false,
  'gfa_above_ground@bldg1': 1500,
  'use_units@bldg1': 12,
  'units_over_400@bldg1': false,
  'uses@bldg1': ['residential'],
  'existing_storeys_above_ground@bldg1': 3,
  'existing_escape_level_m@bldg1': 6.5,
  'existing_gfa_above_ground@bldg1': 900,
}

describe('classification-evaluate', () => {
  it('E34: GK 3 today, two storeys more with the escape level unknown, and the section that settles it', () => {
    const result = evaluate({ ...VIENNA_BESTAND, 'storeys_above_ground@bldg1': 5 })
    expect(result.status).toBe('evaluated')
    expect(result.site.chain).toEqual(['AT-9', 'AT'])
    expect(result.classification).toMatchObject({ rulesetId: 'shipped:at-oib-2023-building-class' })
    expect(result.existing).toMatchObject({ value: 3, missing: [] })
    expect(result.planned).toMatchObject({ value: null, missing: ['escape_level_m'] })
    // Five storeys: GK 5 below 22 m, a high-rise above; never GK 3 again.
    expect(result.planned?.possible).toEqual([
      { value: null, highRise: true, applicable: true },
      { value: 5, highRise: false, applicable: true },
    ])
    expect(result.shift).toEqual({
      changed: null,
      differingInputs: ['storeys_above_ground', 'escape_level_m', 'gfa_above_ground'],
    })
    expect(result.requests).toEqual([
      expect.objectContaining({ factKeys: ['escape_level_m'], document: 'Schnitt aus dem Einreichplan' }),
    ])
  })

  it('names the shift once both sides are decided', () => {
    const result = evaluate({
      ...VIENNA_BESTAND,
      'storeys_above_ground@bldg1': 4,
      'escape_level_m@bldg1': 10.5,
    })
    expect([result.existing?.value, result.planned?.value]).toEqual([3, 4])
    expect(result.shift?.changed).toBe(true)
    expect(result.requests).toEqual([])
  })

  it('tries a variant without writing it', () => {
    const result = evaluate({ ...VIENNA_BESTAND, 'storeys_above_ground@bldg1': 5 }, { planned: { escape_level_m: 13 } })
    expect(result.planned).toMatchObject({ value: 5, missing: [] })
  })

  it('classifies a new building on the planned values alone', () => {
    const result = evaluate({ country: 'at', 'building_type@bldg1': 'building' })
    expect(result.existing).toBeNull()
    expect(result.shift).toBeNull()
  })

  it('classifies a German project by Germany’s record, and requests Germany’s documents', () => {
    const result = evaluate({ country: 'de', federal_state: 'bavaria', 'building_type@bldg1': 'building' })
    expect(result.classification?.rulesetId).toBe('test:de-classification')
    expect(result.planned).toMatchObject({ missing: ['storeys_above_ground'] })
    expect(result.requests.map((request) => request.document)).toEqual(['Schnitt (DE)'])
  })

  it('fails closed: no record, no class; no site, no class', () => {
    expect(evaluate({ country: 'ch', 'building_type@bldg1': 'building' })).toMatchObject({
      status: 'no_classification',
      planned: null,
      requests: [],
    })
    expect(evaluate({ 'building_type@bldg1': 'building' })).toMatchObject({ status: 'site_unknown', planned: null })
  })
})

describe('evaluateProjectClassification, the route’s service', () => {
  const session = { organizationId: 'org-1', userId: 'user-1' } as Partial<AuthorizedSession> as AuthorizedSession
  const gateAt = (state: GateState, reason: 'no_site' | 'no_territory' | null = null) =>
    vi.mocked(knowledgeContextForTurn).mockResolvedValue({ gate: { state, reason, leaves: [] } } as Partial<KnowledgeContext> as KnowledgeContext)
  beforeEach(() => {
    gateAt('core')
    vi.mocked(findProjectProfileInOrg).mockResolvedValue({
      profile: placedProfile({ country: 'at', 'building_type@bldg1': 'building' }),
    } as Partial<ProjectProfileState> as ProjectProfileState)
  })

  it('answers anyone who may view the project, from the stored profile', async () => {
    vi.mocked(findProjectProfileInOrg).mockResolvedValue({
      profile: placedProfile({ country: 'at', 'building_type@bldg1': 'building' }),
    } as Partial<ProjectProfileState> as ProjectProfileState)
    const result = await evaluateProjectClassification(session, 'p-1', {})
    expect(requireProjectAccess).toHaveBeenCalledWith(session, 'p-1', 'project:view')
    expect(result.status).toBe('evaluated')
    expect(result.gate).toBeNull()
  })

  it.each([
    ['not_entitled', null],
    ['knowledge_unavailable', null],
    ['none', null],
    ['organization_unplaced', null],
    ['site_unknown', 'no_territory'],
  ] as const)('names no class where the turn’s gate is %s, and says so with the gate', async (state, reason) => {
    gateAt(state, reason)
    const result = await evaluateProjectClassification(session, 'p-1', {})
    expect(classificationEvaluationSchema.parse(result)).toEqual(result)
    expect(result).toMatchObject({ status: 'undetermined', gate: { state, reason }, classification: null, planned: null, existing: null, requests: [] })
  })

  it('evaluates under open coverage, as the turn reads uncurated law', async () => {
    gateAt('open')
    expect((await evaluateProjectClassification(session, 'p-1', {})).status).toBe('evaluated')
  })

  it('refuses before it reads the profile', async () => {
    vi.mocked(findProjectProfileInOrg).mockClear()
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new ForbiddenError())
    await expect(evaluateProjectClassification(session, 'p-1', {})).rejects.toBeInstanceOf(ForbiddenError)
    expect(findProjectProfileInOrg).not.toHaveBeenCalled()
  })
})
