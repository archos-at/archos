// @disk-inputs: tests/fixtures/address-register/bev/*.csv
/**
 * @vitest-environment node
 *
 * Site resolution against a REAL Postgres (migration 0206, ADR-0172): the
 * importer writes the BEV fixture as a release, and the resolver reads it as
 * the restricted runtime role, under row-level security, as the route does.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/site-resolution/site-resolution.integration.spec.ts
 *
 * What S12 is measured by, each with its control:
 * - before any import, a typed address resolves `unverified: no_register`, and
 *   a German line `no_register` too (no register is hosted for it);
 * - after the import, a register hit gives country, Land, Gemeinde, and the
 *   authority a competence ruleset in force decides, named by its record;
 *   without a ruleset the authority is `undetermined: no_rule`;
 * - setting the site writes confirmed facts with the register as evidence; a
 *   line the register does not hold is kept as an assumption;
 * - the revert: a second release replaces the first, a truncated one is
 *   refused and the active release stays, and a tenant cannot write a row.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
// Project access is WorkOS FGA; the tenant boundary under it is what this spec reads through.
vi.mock('@/lib/authz/projects', async (original) => ({
  ...(await original<typeof import('@/lib/authz/projects')>()),
  requireProjectAccess: async () => undefined,
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const ORG = `org_site_${RUN}`
const USER = 'user_site'
const AUTHOR = 'user_site_author'
const EXPERT = 'user_site_expert'
const FIXTURE = join(process.cwd(), 'tests/fixtures/address-register/bev')

describe.skipIf(!url)('site resolution against Postgres', () => {
  let service: typeof import('./service')
  let importer: typeof import('./import')
  let bev: typeof import('./bev')
  let registers: typeof import('./registers')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let raw: import('postgres').Sql
  let withPlatform: import('./import').WithPlatform
  let projectId: string
  const session = { organizationId: ORG, userId: USER } as import('@/lib/auth/types').AuthorizedSession
  const now = new Date('2026-11-10T10:00:00Z')
  const authorityKey = `graz-building-${RUN}`

  /** The fixture as entries, `keep` of them: the whole archive the importer reads, or a truncated one. */
  function fixtureEntries(keep = Number.POSITIVE_INFINITY) {
    const lines = (name: string) => readFileSync(join(FIXTURE, name), 'utf8').split('\n')
    const lookups = bev.bevLookups({
      municipalityRows: bev.csvRecords(lines('GEMEINDE.csv')),
      localityRows: bev.csvRecords(lines('ORTSCHAFT.csv')),
      streetRows: bev.csvRecords(lines('STRASSE.csv')),
    })
    return [...bev.csvRecords(lines('ADRESSE.csv'))].flatMap((row) => bev.bevEntry(row, lookups) ?? []).slice(0, keep)
  }

  const importFixture = (referenceDate: string, keep?: number, extra: import('./bev').RegisterEntry[] = []) =>
    importer.importRelease(withPlatform, {
      register: registers.BEV_ADDRESS_REGISTER,
      referenceDate,
      attribution: bev.bevAttribution(referenceDate),
      sourceUrl: null,
      entries: [...fixtureEntries(keep), ...extra],
    })

  /** A `Hauptplatz 1` in each of `count` synthetic Gemeinden of Lower Austria, all sorting before Styria's. */
  const commonStreet = (count: number): import('./bev').RegisterEntry[] =>
    Array.from({ length: count }, (_, index) => ({
      addressId: `synthetic-${index}`,
      municipalityCode: String(30101 + index),
      municipalityName: `Synthetic ${index}`,
      localityName: null,
      postcode: String(2000 + index),
      streetName: 'Hauptplatz',
      houseNumber: '1',
      streetKey: 'hauptplatz',
      houseKey: '1',
      placeKeys: [`synthetic${index}`],
      easting: null,
      northing: null,
      crs: null,
    }))

  /** Austria's territories and Graz's building authority, through a change request, as every platform row is. */
  async function publishGrazAuthority(): Promise<void> {
    const store = await import('@/lib/base-knowledge/platform/store')
    const release = await import('@/lib/base-knowledge/platform/release')
    const wire = await import('@/lib/base-knowledge/platform/wire')
    const records = [
      { type: 'territory', id: 'AT', kind: 'country', name: 'Österreich' },
      { type: 'territory', id: 'AT-6', kind: 'state', name: 'Steiermark', parentIds: ['AT'] },
      { type: 'territory', id: 'AT:gkz:60101', kind: 'municipality', name: 'Graz', parentIds: ['AT-6'] },
      {
        type: 'authority',
        key: authorityKey,
        name: 'Bürgermeister der Stadt Graz, Bau- und Anlagenbehörde',
        functionCodes: ['building_permit'],
        seatTerritoryId: 'AT:gkz:60101',
        competenceTerritoryIds: ['AT:gkz:60101'],
      },
    ].map((record) => wire.proposedRecordSchema.parse(record))
    const id = await store.insertChangeRequest({ title: `Graz ${RUN}`, countryId: 'AT', createdBy: AUTHOR })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      await store.insertProposedRecords(tx, request!, records, { createdBy: AUTHOR, proposedBy: 'person' })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    const view = await store.readChangeRequest(id)
    await store.platformTransaction(async (tx) => {
      await store.insertReviewDecisions(
        tx,
        id,
        EXPERT,
        view!.revisions.flatMap((revision) =>
          revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const })),
        ),
      )
      await store.insertApproval(tx, { changeRequestId: id, approver: EXPERT, role: 'domain_expert', decisionSource: 'app' })
      await store.setChangeRequestStatus(tx, id, 'approved', 'decidedAt')
    })
    await release.publishChangeRequest(id, 'preview', { by: EXPERT, decisionSource: 'app' })
    await release.publishChangeRequest(id, 'stable', { by: EXPERT, decisionSource: 'app' })
  }

  /** The office's own competence ruleset for Styria: Graz's authority for Graz, nothing for any other Gemeinde. */
  async function grazCompetence(): Promise<void> {
    const rulesets = await import('@/lib/base-knowledge/store/rulesets')
    await rulesets.insertOfficeRuleset(
      ORG,
      {
        purpose: 'competence',
        territoryIds: ['AT-6'],
        validFrom: '2020-01-01',
        body: {
          kind: 'table',
          payloadSchema: 'decision_table.v1',
          payload: {
            inputs: [{ key: 'municipality', type: 'code' }],
            output: { type: 'bodies' },
            rows: [
              {
                id: 'graz',
                when: { '===': [{ var: 'municipality' }, 'AT:gkz:60101'] },
                then: { bodies: [{ authorityId: `authority:${authorityKey}`, role: 'decides' }] },
                provision: { citation: 'synthetic: § 95 Stmk. BauG' },
              },
            ],
            otherwise: { undetermined: true },
            examples: [],
          },
        },
      },
      { createdBy: USER, provenance: { proposedBy: 'person' }, inForce: true },
    )
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    db = (await import('@/lib/db')).getDb()
    service = await import('./service')
    importer = await import('./import')
    bev = await import('./bev')
    registers = await import('./registers')
    const postgres = (await import('postgres')).default
    raw = postgres(url!, { max: 2 })
    const scope = (await import('../../workers/platform-scope.js')).default
    withPlatform = (fn) =>
      raw.begin(async (tx) => {
        await scope.enterPlatformScope(tx)
        return fn(tx)
      }) as ReturnType<typeof fn>
    // Earlier runs on the same database leave releases behind: start from none active.
    await withPlatform((tx) => tx`DELETE FROM address_register_releases WHERE register = 'at-bev'`.then(() => undefined))
    await withTenant({ organizationId: ORG }, () =>
      db.execute(sql`INSERT INTO organizations (workos_organization_id, home_country) VALUES (${ORG}, 'AT')`),
    )
    const [created] = await withTenant({ organizationId: ORG }, async () =>
      Array.from(
        await db.execute<{ id: string }>(sql`
          INSERT INTO projects (organization_id, name, created_by, collection_name, profile)
          VALUES (${ORG}, 'Site', ${USER}, ${`coll_site_${RUN}`}, '{"facts":{},"goals":{},"unknowns":[],"assumptions":{}}'::jsonb)
          RETURNING id`),
      ),
    )
    projectId = String(created.id)
  })

  afterAll(async () => {
    await withPlatform((tx) => tx`DELETE FROM address_register_releases WHERE register = 'at-bev'`.then(() => undefined))
    await raw?.end()
  })

  it('resolves every typed address as unverified while no register is imported (fail closed)', async () => {
    const resolution = await service.resolveSite(session, 'Herrengasse 16, 8010 Graz', now)
    expect(resolution).toMatchObject({ status: 'unverified', reason: 'no_register', candidates: [] })
  })

  it('imports the fixture as the active release', async () => {
    const result = await importFixture('2025-10-01')
    expect(result.entryCount).toBe(20)
    expect(result.retiredReleaseIds).toEqual([])
  })

  it('places a register hit in the territory chain, with the authority undetermined while no ruleset covers it', async () => {
    const resolution = await service.resolveSite(session, 'Herrengasse 16, 8010 Graz', now)
    expect(resolution).toMatchObject({
      status: 'verified',
      site: {
        addressId: 'at-bev:5734380',
        label: 'Herrengasse 16, 8010 Graz',
        country: 'AT',
        state: { territoryId: 'AT-6', name: 'Steiermark', federalState: 'styria' },
        municipality: { territoryId: 'AT:gkz:60101', name: 'Graz', code: '60101' },
        chain: ['AT:gkz:60101', 'AT-6', 'AT'],
        register: { id: 'at-bev', referenceDate: '2025-10-01' },
        authority: { status: 'undetermined', reason: 'no_rule' },
      },
    })
  })

  it('names the competent authority once a ruleset decides it (positive control)', async () => {
    await publishGrazAuthority()
    await grazCompetence()
    const resolution = await service.resolveSite(session, 'Herrengasse 16, 8010 Graz', now)
    expect(resolution.status === 'verified' && resolution.site.authority).toEqual({
      status: 'decided',
      bodies: [{ authorityId: `authority:${authorityKey}`, name: 'Bürgermeister der Stadt Graz, Bau- und Anlagenbehörde', role: 'decides' }],
      rulesetId: expect.any(String),
      territoryId: 'AT-6',
      citation: 'synthetic: § 95 Stmk. BauG',
    })
    // The same ruleset decides nothing for Leoben, in the same Land.
    const leoben = await service.resolveSite(session, 'Hauptplatz 1, 8700 Leoben', now)
    expect(leoben.status === 'verified' && leoben.site.authority).toEqual({ status: 'undetermined', reason: 'no_row_applies' })
  })

  it('keeps an ambiguous line unverified, with the register candidates', async () => {
    const resolution = await service.resolveSite(session, 'Hauptplatz 1', now)
    expect(resolution).toMatchObject({ status: 'unverified', reason: 'multi_leaf' })
    expect(resolution.status === 'unverified' && resolution.candidates.map((candidate) => candidate.municipality.name).sort()).toEqual(['Graz', 'Knittelfeld', 'Leoben'])
  })

  it('never takes the postcode\'s address when the place or the postcode says otherwise', async () => {
    expect(await service.resolveSite(session, 'Herrengasse 16, 8010 Wien', now)).toMatchObject({ status: 'unverified', reason: 'conflict' })
    expect(await service.resolveSite(session, 'Herrengasse 16, 8010 Zürich', now)).toMatchObject({ status: 'unverified', reason: 'conflict' })
    // A German postcode outside the Kleinwalsertal and Jungholz is evidence of Germany: Austria's register is not searched.
    expect(await service.resolveSite(session, 'Herrengasse 16, 01010 Wien', now)).toMatchObject({ status: 'unverified', reason: 'no_register' })
    // A postcode and no place could be Switzerland's or Liechtenstein's.
    expect(await service.resolveSite(session, 'Herrengasse 16, 8010', now)).toMatchObject({ status: 'unverified', reason: 'incomplete' })
    expect(await service.resolveSite(session, 'Herrengasse 16, 1010 Wien-Innere Stadt', now)).toMatchObject({ status: 'verified', site: { municipality: { name: 'Wien' } } })
  })

  it('finds the Kleinwalsertal address typed with its German postcode (E30), and refuses Germany (no register)', async () => {
    const walser = await service.resolveSite(session, 'Walserstraße 54, 87567 Riezlern', now)
    expect(walser).toMatchObject({ status: 'verified', site: { municipality: { name: 'Mittelberg' }, state: { territoryId: 'AT-8' } } })
    const munich = await service.resolveSite(session, 'Marienplatz 8, D-80331 München', now)
    expect(munich).toMatchObject({ status: 'unverified', reason: 'no_register', statedCountry: 'DE' })
  })

  it('sets a verified site as confirmed facts, and replaces it with an unverified line as an assumption', async () => {
    const verified = await service.setProjectSite(session, projectId, { addressId: 'at-bev:5734380' }, now)
    expect(verified.resolution.status).toBe('verified')
    const read = async () =>
      withTenant({ organizationId: ORG }, async () =>
        Array.from(await db.execute<{ profile: import('@/lib/project-profile/types').ProjectProfile }>(sql`SELECT profile FROM projects WHERE id = ${projectId}::uuid`))[0].profile,
      )
    const placed = await read()
    expect(placed.facts.federal_state).toMatchObject({ value: 'styria', confidence: 'confirmed', evidence: [{ kind: 'register', addressId: 'at-bev:5734380' }] })
    expect(placed.facts.site_territory?.value).toBe('AT:gkz:60101')

    await service.setProjectSite(session, projectId, { typed: 'Herrengasse 999, 8010 Graz' }, now)
    const typed = await read()
    expect(typed.facts.federal_state).toBeUndefined()
    expect(typed.facts.site_address).toBeUndefined()
    expect(typed.assumptions.site_address).toMatchObject({ value: 'Herrengasse 999, 8010 Graz', status: 'unconfirmed' })
    expect(typed.assumptions.federal_state).toMatchObject({ value: 'styria', status: 'unconfirmed' })
  })

  it('refuses register evidence through the generic profile patch, and keeps it through it (ADR-0172)', async () => {
    await service.setProjectSite(session, projectId, { addressId: 'at-bev:5734380' }, now)
    const { patchProjectProfile } = await import('@/lib/project-profile/profile-service')
    const forged = {
      value: 'Leoben',
      confidence: 'confirmed',
      source: 'user_confirmed',
      updatedAt: now.toISOString(),
      evidence: [{ kind: 'register', addressId: 'at-bev:5925325', label: 'Hauptplatz 1, 8700 Leoben', referenceDate: '2025-10-01', resolvedAt: now.toISOString() }],
    }
    await expect(patchProjectProfile(session, projectId, [{ op: 'replace', path: '/facts/municipality', value: forged }])).rejects.toThrow(/Register evidence/)
    // An unrelated patch leaves the register's own evidence where it is.
    await expect(patchProjectProfile(session, projectId, [{ op: 'add', path: '/goals/note', value: 'x' }])).resolves.toBeTruthy()
  })

  it('refuses an address id the active release does not hold', async () => {
    await expect(service.setProjectSite(session, projectId, { addressId: 'at-bev:0' }, now)).rejects.toThrow(/No address with that id/)
  })

  it('replaces a release with the next, and refuses a truncated one, keeping the active release (revert)', async () => {
    const next = await importFixture('2026-04-01')
    expect(next.retiredReleaseIds).toHaveLength(1)
    await expect(importFixture('2026-10-01', 5)).rejects.toThrow(importer.ReleaseRefusedError)
    await expect(importFixture('2025-10-01')).rejects.toThrow(/not after the active release/)
    await expect(importer.importRelease(withPlatform, {
      register: registers.BEV_ADDRESS_REGISTER, referenceDate: '2026-10-01', attribution: 'x', sourceUrl: null, entries: fixtureEntries(), maxShrink: Number.NaN,
    })).rejects.toThrow(/maxShrink/)
    const resolution = await service.resolveSite(session, 'Herrengasse 16, 8010 Graz', now)
    expect(resolution.status === 'verified' && resolution.site.register.referenceDate).toBe('2026-04-01')
    const releases = await withPlatform((tx) => tx<{ status: string; n: number }[]>`
      SELECT r.status, count(e.address_id)::int AS n FROM address_register_releases r
      LEFT JOIN address_register_entries e ON e.release_id = r.id
      WHERE r.register = 'at-bev' GROUP BY r.id, r.status ORDER BY r.status`)
    expect(releases).toEqual([{ status: 'active', n: 20 }, { status: 'retired', n: 0 }])
  })

  it('finds a street and number common to more Gemeinden than one lookup reads, by its postcode or place', async () => {
    await importFixture('2027-04-01', undefined, commonStreet(60))
    expect(await service.resolveSite(session, 'Hauptplatz 1, 8700 Leoben', now)).toMatchObject({ status: 'verified', site: { municipality: { name: 'Leoben' } } })
    expect(await service.resolveSite(session, 'Hauptplatz 1, Knittelfeld', now)).toMatchObject({ status: 'verified', site: { municipality: { name: 'Knittelfeld' } } })
    const bare = await service.resolveSite(session, 'Hauptplatz 1', now)
    expect(bare).toMatchObject({ status: 'unverified', reason: 'multi_leaf' })
    expect(bare.status === 'unverified' && bare.candidates).toHaveLength(8)
  })

  it('places nothing from a street and number alone, even one the register holds once (invariant A1)', async () => {
    const alone = await service.resolveSite(session, 'Walserstraße 54', now)
    expect(alone).toMatchObject({ status: 'unverified', reason: 'incomplete' })
    expect(alone.status === 'unverified' && alone.candidates.map((candidate) => candidate.addressId)).toEqual(['at-bev:7370068'])
  })

  it('lets a tenant read the register but not write it', async () => {
    const write = withTenant({ organizationId: ORG }, () =>
      db.execute(sql`INSERT INTO address_register_releases (register, country_id, reference_date, attribution) VALUES ('at-bev', 'AT', '2030-01-01', 'x')`),
    )
    await expect(write).rejects.toThrow()
  })
})
