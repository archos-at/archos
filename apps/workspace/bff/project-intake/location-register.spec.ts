/**
 * @vitest-environment node
 *
 * The location register: from Bundesland, Gemeinde, Vorhaben and mode, which
 * documents step 4 asks for, why, and when a request is settled. Read with the
 * real intake definition, so the register's keys are the wizard's.
 */
import { describe, expect, it } from 'vitest'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import factSourcesSeed from '@/lib/base-knowledge/rulesets/seeds/at-setup-fact-sources.json'
import factDefinitionsSeed from '@/lib/base-knowledge/rulesets/seeds/at-setup-fact-definitions.json'
import { rulesetValuesSchema } from '@/lib/base-knowledge/wire/ruleset'
import { locationRegisterFor, type LocationRegisterInput } from './location-register'
import { THREE_COUNTRIES } from './setup-countries.fixtures'
import { computeNeeds } from './needs'
import { flattenIntakeQuestions } from '@/lib/project-profile/intake-conditions'
import { FEDERAL_STATE_TOKENS } from '@/lib/project-profile/intake-conditions'
import { locationRegisterViewSchema, type IntakeMode } from './types'

const at = '2026-10-20T08:00:00.000Z'

function profileWith(
  facts: Record<string, ProjectPrimitiveValue>,
  suggestions: Record<string, ProjectPrimitiveValue> = {},
  unknowns: string[] = []
): ProjectProfile {
  const profile = emptyProjectProfile()
  for (const [key, value] of Object.entries(facts)) {
    profile.facts[key] = { value, confidence: 'confirmed', source: 'onboarding', updatedAt: at }
  }
  for (const [key, value] of Object.entries(suggestions)) {
    profile.assumptions[key] = { value, status: 'unconfirmed', reason: 'gelesen', source: 'agent_suggested', updatedAt: at }
  }
  profile.unknowns.push(...unknowns)
  return profile
}

function register(
  profile: ProjectProfile,
  options: { mode?: IntakeMode; location?: LocationRegisterInput['location'] } = {}
) {
  const mode = options.mode ?? 'active'
  const needs = computeNeeds(profile, projectIntakeDefinitionV1, { mode, dismissed: [] })
  const view = locationRegisterFor({ profile, location: options.location ?? null, mode, needs })
  // Every answer is what the wire carries.
  expect(locationRegisterViewSchema.parse(view)).toEqual(view)
  return view
}

const determinants = (view: ReturnType<typeof register>) => view.documentRequests.map((request) => request.determinant)
const request = (view: ReturnType<typeof register>, determinant: string) =>
  view.documentRequests.find((entry) => entry.determinant === determinant)

const AT_NEW_BUILD = { country: 'at', work_type: ['new_build'] }

/** Austria's register: the determinant entries of its shipped `fact_sources` record. */
const AT_SOURCES = (() => {
  const values = rulesetValuesSchema.parse(factSourcesSeed)
  if (values.body.kind !== 'fact_sources') throw new Error('a fact_sources record')
  return values.body.payload.entries
})()
const LOCATION_ENTRIES = AT_SOURCES.filter((entry) => entry.determinant)

/** The Länder Austria's fact definitions list, by territory. */
const AT_LANDS = new Map(
  (factDefinitionsSeed.body.payload.subdivisions?.options ?? []).map((option) => [option.territoryId, option.token])
)

describe('the register as data', () => {
  it('settles only keys a wizard question writes', () => {
    const written = new Set(
      flattenIntakeQuestions(projectIntakeDefinitionV1).map((question) => /^\/facts\/([^/]+)/.exec(question.writesTo ?? '')?.[1])
    )
    for (const entry of AT_SOURCES) for (const key of entry.factKeys) expect(written).toContain(key)
  })

  it('cites a source for every entry and every Bundesland variant, and names only real Bundesländer', () => {
    for (const entry of AT_SOURCES) {
      expect(entry.sources.length).toBeGreaterThan(0)
      for (const [territoryId, variant] of Object.entries(entry.variants)) {
        expect(FEDERAL_STATE_TOKENS).toContain(AT_LANDS.get(territoryId))
        expect(variant.sources.length).toBeGreaterThan(0)
      }
      for (const local of entry.additions) expect(AT_LANDS.has(local.territoryId)).toBe(true)
    }
  })

  it('has a Widmung source for each of the nine Bundesländer', () => {
    const zoning = LOCATION_ENTRIES.find((entry) => entry.determinant === 'zoning')
    expect(Object.keys(zoning?.variants ?? {}).map((territoryId) => AT_LANDS.get(territoryId)).sort()).toEqual(
      FEDERAL_STATE_TOKENS.filter((token) => token !== 'outside_austria').sort()
    )
  })
})

describe('locationRegisterFor', () => {
  it('asks for the site and the Vorhaben when a typed address left them open, and requests no document yet', () => {
    const view = register(profileWith({ site_address: 'Hauptplatz 1, Irgendwo' }))
    expect(view.federalState).toBeNull()
    expect(view.questions.map((need) => need.key)).toEqual(['federal_state', 'work_type'])
    // No country, no country's documents: Austria's would be a guess (ADR-0169).
    expect(view.documentRequests).toEqual([])
  })

  it('asks for the words that hold everywhere in Austria while the Bundesland is open', () => {
    const view = register(profileWith({ country: 'at' }))
    expect(request(view, 'zoning')).toMatchObject({ document: 'Auszug aus Flächenwidmungs- und Bebauungsplan' })
  })

  it('lists only a German project’s own documents, with its Land’s variant', () => {
    const profile = profileWith({ country: 'de', federal_state: 'bavaria', work_type: ['new_build'] })
    const needs = computeNeeds(profile, projectIntakeDefinitionV1, { mode: 'active', dismissed: [] })
    const view = locationRegisterFor({ profile, location: null, mode: 'active', needs, records: THREE_COUNTRIES })
    expect(locationRegisterViewSchema.parse(view)).toEqual(view)
    expect(view.federalState).toBe('bavaria')
    // The record's entry without a determinant (the storeys) is asked only when a decision waits for it.
    expect(view.documentRequests.map((entry) => entry.document)).toEqual(['Bebauungsplan der Gemeinde (BY)'])
    // Without Germany's record, nothing: no Austrian document stands in.
    expect(register(profile).documentRequests).toEqual([])
  })

  it('takes the Bundesland from the geocoder when the profile has none', () => {
    const view = register(profileWith({ country: 'at' }), { location: { federalState: 'vienna', municipality: 'Wien' } })
    expect(view).toMatchObject({ federalState: 'vienna', municipality: 'Wien' })
  })

  it('does not ask for a Bundesland a reading already suggested', () => {
    const view = register(profileWith(AT_NEW_BUILD, { federal_state: 'tyrol' }))
    expect(view.federalState).toBe('tyrol')
    expect(view.questions).toEqual([])
  })

  it('asks Wien for its Plandokument, with the Bauordnung as source', () => {
    const view = register(profileWith({ ...AT_NEW_BUILD, federal_state: 'vienna' }))
    expect(view.municipality).toBe('Wien')
    const zoning = request(view, 'zoning')
    expect(zoning?.document).toBe('Plandokument (Flächenwidmungs- und Bebauungsplan)')
    expect(zoning?.reason).toContain('Plandokument')
    expect(zoning?.sources[0]?.title).toBe('Bauordnung für Wien (BO für Wien)')
    expect(zoning?.keys).toEqual(['zoning', 'development_plan'])
  })

  it('cites the Land’s Raumordnungsgesetz outside Wien, and adds the Altstadt law in Graz', () => {
    const leoben = register(profileWith({ ...AT_NEW_BUILD, federal_state: 'styria' }), {
      location: { federalState: 'styria', municipality: 'Leoben' },
    })
    expect(request(leoben, 'zoning')?.sources.map((source) => source.title)).toEqual([
      'Steiermärkisches Raumordnungsgesetz 2010 (StROG)',
    ])
    const graz = register(profileWith({ ...AT_NEW_BUILD, federal_state: 'styria' }), {
      location: { federalState: 'styria', municipality: 'Graz' },
    })
    expect(request(graz, 'zoning')?.reason).toContain('Grazer Altstadterhaltungsgesetz')
    expect(request(graz, 'zoning')?.sources.map((source) => source.title)).toContain(
      'Grazer Altstadterhaltungsgesetz 2008 (GAEG 2008)'
    )
  })

  it('asks a Neubau for the Grundbuch, Widmung, Gefahrenzonen and, until the Nutzungen are known, Lärm', () => {
    const view = register(profileWith({ ...AT_NEW_BUILD, federal_state: 'tyrol' }))
    expect(determinants(view)).toEqual(['plot', 'zoning', 'hazards', 'noise'])
    expect(request(view, 'plot')).toMatchObject({
      document: 'Grundbuchauszug',
      keys: ['plot_register_number', 'plot_area'],
      satisfied: false,
    })
    expect(request(view, 'plot')?.needs.map((need) => need.key)).toEqual(['plot_register_number', 'plot_area'])
  })

  it('leaves Lärm out for a use the outside noise does not concern', () => {
    const view = register(profileWith({ ...AT_NEW_BUILD, federal_state: 'tyrol', 'building_type@bldg1': 'building', 'uses@bldg1': ['garage'] }))
    expect(determinants(view)).not.toContain('noise')
  })

  it('asks a Sanierung of a Bestand about Denkmalschutz per Bauwerk, not about Widmung or Gefahrenzonen', () => {
    const view = register(
      profileWith({
        country: 'at',
        federal_state: 'salzburg',
        work_type: ['refurbishment'],
        'building_type@bldg1': 'building',
        'construction_status@bldg1': 'existing',
        'uses@bldg1': ['residential'],
      })
    )
    expect(determinants(view)).toEqual(['plot', 'heritage', 'noise'])
    expect(request(view, 'heritage')).toMatchObject({ keys: ['heritage_protection@bldg1'], satisfied: false })
    expect(request(view, 'heritage')?.needs.map((need) => need.key)).toEqual(['heritage_protection@bldg1'])
  })

  it('asks no Denkmalschutz of a Neubau', () => {
    const view = register(profileWith({ ...AT_NEW_BUILD, federal_state: 'vienna', 'construction_status@bldg1': 'new_build' }))
    expect(determinants(view)).not.toContain('heritage')
  })

  it('settles a request when each key holds a value, a suggestion or „nicht bekannt"', () => {
    const view = register(
      profileWith(
        { ...AT_NEW_BUILD, federal_state: 'vienna', zoning: 'residential', plot_register_number: 'EZ 1234, KG Hernals' },
        { development_plan: 'yes', hazard_zones: ['none'] },
        ['plot_area']
      )
    )
    expect(request(view, 'plot')).toMatchObject({ satisfied: true, needs: [] })
    expect(request(view, 'zoning')?.satisfied).toBe(true)
    expect(request(view, 'hazards')?.satisfied).toBe(true)
    expect(request(view, 'noise')?.satisfied).toBe(false)
  })

  it('asks a past project only for its Bundesland, and for no document', () => {
    const open = register(profileWith({}), { mode: 'closing' })
    expect(open.questions.map((need) => need.key)).toEqual(['federal_state'])
    expect(open.documentRequests).toEqual([])
  })

  it('has nothing to say about a project outside Austria', () => {
    expect(register(profileWith({ country: 'de', work_type: ['new_build'] }))).toEqual({
      federalState: null,
      municipality: null,
      questions: [],
      documentRequests: [],
    })
    expect(register(profileWith({ federal_state: 'outside_austria' })).documentRequests).toEqual([])
  })
})
