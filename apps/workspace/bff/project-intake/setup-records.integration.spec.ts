/**
 * @vitest-environment node
 *
 * The readers read released records (country-as-data, step 3), against a REAL
 * Postgres through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/project-intake/setup-records.integration.spec.ts
 *
 * The three countries of `setup-countries.fixtures.ts` (Austria's pack as an
 * operator proposes it, a synthetic Germany and Switzerland) are stored and
 * read back from the database, not injected as an array: each project receives
 * its own country's subdivisions, class and requests (ADR-0169), the A6 class
 * of the dev acceptance comes from the stored ruleset, and a synthetic country
 * `XA` is published as a platform change request and read only by an office
 * entitled to it. Where nothing is published, every reader says so and invents
 * nothing.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { publishedRequest } from '@/lib/base-knowledge/platform/testing/lifecycle'
import { proposedRecordSchema } from '@/lib/base-knowledge/platform/wire'
import { rulesetValuesSchema, type RulesetValues } from '@/lib/base-knowledge/wire/ruleset'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { AT_SETUP_RECORDS } from './at-setup.fixtures'
import { deriveAll } from './derivation-view'
import { locationRegisterFor } from './location-register'
import { computeNeeds } from './needs'
import { GERMAN_RECORDS, SWISS_RECORDS, placedProfile } from './setup-countries.fixtures'
import { hasSetupRecords, setupScopeOf, subdivisionTerritories } from './setup-scope'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/knowledge/service', () => ({
  reingestKnowledgeBaseDocuments: async () => ({ status: 'pending', queued: [], unknown: [], message: '' }),
  getKnowledgeBaseStatus: async () => ({ files: [] }),
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
/** An office of the three countries: its own records, read as the office reads any record. */
const ORG = `org_setup_${RUN}`
/** An office with nothing published for it. */
const EMPTY = `org_setup_${RUN}_empty`
/** Home XA: entitled to the platform's synthetic country. */
const XA_OFFICE = `org_setup_${RUN}_xa`
const USER = 'user_setup'
const ON = '2026-11-10'

/** Austria's classification and Germany's, as the fixtures hold them, retargeted to the synthetic country. */
function syntheticCountry(): RulesetValues[] {
  return GERMAN_RECORDS.map(({ values }) => {
    const territoryIds = ['XA']
    if (values.body.kind !== 'fact_definitions' || !values.body.payload.subdivisions) return { ...values, territoryIds }
    const options = [{ token: 'xanadu_north', territoryId: 'XA-N', label: 'Xanadu Nord' }]
    const subdivisions = { ...values.body.payload.subdivisions, options }
    return rulesetValuesSchema.parse({ ...values, territoryIds, body: { ...values.body, payload: { ...values.body.payload, subdivisions } } })
  })
}

describe.skipIf(!url)('the setup readers against Postgres', () => {
  let readSetupRecords: typeof import('./setup-records').readSetupRecords
  let insertOfficeRuleset: typeof import('@/lib/base-knowledge/store/rulesets').insertOfficeRuleset
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    readSetupRecords = (await import('./setup-records')).readSetupRecords
    insertOfficeRuleset = (await import('@/lib/base-knowledge/store/rulesets')).insertOfficeRuleset
    for (const [organizationId, home] of [
      [ORG, 'AT'],
      [EMPTY, 'AT'],
      [XA_OFFICE, 'XA'],
    ] as const)
      await withTenant({ organizationId }, () =>
        db.execute(sql`INSERT INTO organizations (workos_organization_id, home_country) VALUES (${organizationId}, ${home})`)
      )
    for (const record of [...AT_SETUP_RECORDS, ...GERMAN_RECORDS, ...SWISS_RECORDS])
      await insertOfficeRuleset(ORG, record.values, { createdBy: USER, provenance: { proposedBy: 'person' }, inForce: true })
    const records = syntheticCountry().map((values, index) =>
      proposedRecordSchema.parse({ type: 'ruleset', key: `xa-setup-${index}-${RUN}`, values })
    )
    await publishedRequest({ title: 'XA setup', countryId: 'XA', records }, { author: 'user_setup_author', expert: 'user_setup_expert' })
  })

  afterAll(async () => {
    await withTenant({ organizationId: ORG }, () =>
      db.execute(sql`DELETE FROM knowledge_records WHERE organization_id = ${ORG} AND type = 'ruleset'`)
    )
    await withPlatformAccess('setup records spec cleanup', async () => {
      await db.execute(sql`DELETE FROM organizations WHERE workos_organization_id IN (${ORG}, ${EMPTY}, ${XA_OFFICE})`)
    })
  })

  const scopeOf = async (facts: Parameters<typeof placedProfile>[0], organizationId = ORG) =>
    setupScopeOf(placedProfile(facts), { records: await readSetupRecords(organizationId), on: ON })

  it('reads every country’s records back from the database as written', async () => {
    const read = await readSetupRecords(ORG)
    expect(read.map((record) => record.values.purpose).sort()).toEqual(
      [...AT_SETUP_RECORDS, ...GERMAN_RECORDS, ...SWISS_RECORDS].map((record) => record.values.purpose).sort()
    )
    // Not the array the specs inject: a stored record has the database's id.
    expect(read.every((record) => !record.id.startsWith('test:') && !record.id.startsWith('ruleset:'))).toBe(true)
    expect(subdivisionTerritories(read, ON)).toMatchObject({ vienna: 'AT-9', bavaria: 'DE-BY', zurich: 'CH-ZH' })
  })

  it('places each project in its own country and offers its own subdivisions, requests and class', async () => {
    expect((await scopeOf({ country: 'at', federal_state: 'vienna' })).chain).toEqual(['AT-9', 'AT'])
    expect((await scopeOf({ country: 'de', federal_state: 'bavaria' })).chain).toEqual(['DE-BY', 'DE'])
    expect((await scopeOf({ country: 'ch', federal_state: 'zurich' })).chain).toEqual(['CH-ZH', 'CH'])
    const records = await readSetupRecords(ORG)
    const building = { 'building_type@bldg1': 'building', 'storeys_above_ground@bldg1': 3 }
    const [german] = deriveAll(placedProfile({ country: 'de', ...building }), projectIntakeDefinitionV1, { records })
    expect(german).toMatchObject({ value: 3, citation: 'Synthetic MBO building class for a spec', missing: [] })
    expect(deriveAll(placedProfile({ country: 'ch', ...building }), projectIntakeDefinitionV1, { records })).toEqual([])
    const profile = placedProfile({ country: 'de', work_type: ['new_build'] })
    const needs = computeNeeds(profile, projectIntakeDefinitionV1, { mode: 'active', dismissed: [], records })
    const register = locationRegisterFor({ profile, location: null, mode: 'active', needs, records })
    expect(register.documentRequests.map((request) => request.document)).toContain('Auszug aus dem Bebauungsplan')
  })

  it('A6: Kellermanngasse’s class comes from the published classification ruleset, with its citation', async () => {
    const records = await readSetupRecords(ORG)
    const building = {
      'building_type@bldg1': 'building',
      'storeys_above_ground@bldg1': 3,
      'gfa_above_ground@bldg1': 300,
      'escape_level_m@bldg1': 6,
    }
    const profile = placedProfile({ country: 'at', federal_state: 'vienna', ...building })
    const fromDatabase = deriveAll(profile, projectIntakeDefinitionV1, { records })
    expect(fromDatabase[0]).toMatchObject({ citation: expect.stringMatching(/^OIB-Richtlinien/) })
    // The same project reads no class while Austria's records are not published for the office.
    expect(deriveAll(profile, projectIntakeDefinitionV1, { records: await readSetupRecords(EMPTY) })).toEqual([])
  })

  it('reads nothing where nothing is published, and says so rather than inventing Austria', async () => {
    const records = await readSetupRecords(EMPTY)
    expect(records).toEqual([])
    expect(hasSetupRecords(records, 'AT', ON)).toBe(false)
    expect((await scopeOf({ country: 'at', federal_state: 'vienna' }, EMPTY)).chain).toEqual(['AT'])
  })

  it('reads a released platform record only for an office entitled to its country', async () => {
    const entitled = await readSetupRecords(XA_OFFICE)
    expect(hasSetupRecords(entitled, 'XA', ON)).toBe(true)
    expect(subdivisionTerritories(entitled, ON)).toMatchObject({ xanadu_north: 'XA-N' })
    // Positive control above; another office (home AT) does not read XA's records.
    const other = await readSetupRecords(EMPTY)
    expect(hasSetupRecords(other, 'XA', ON)).toBe(false)
    const chain = (await scopeOf({ country: 'xa', federal_state: 'xanadu_north' }, XA_OFFICE)).chain
    expect(chain).toEqual(['XA-N', 'XA'])
  })
})
