/**
 * @vitest-environment node
 *
 * The platform's base knowledge against a REAL Postgres (migration 0205,
 * ADR-0165), through the restricted runtime role for every office read:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/platform/platform.integration.spec.ts
 *
 * The outcomes S7 is measured by, each with its positive control:
 * - a rollback round trip: publish, publish over it, roll back twice, and each
 *   head is where it was, with every move kept;
 * - an MA 37 directive is excluded for a project in Graz and applies in Vienna,
 *   by the competence rulesets of the site's chain;
 * - a published text gets its indexing run, and reads indexed once the corpus
 *   says so (the corpus itself is the backend's, and stands in here);
 * - a second office sees the std-asi listing as "gelistet, kein Text" once it
 *   is entitled to Austria, and nothing before.
 * And the guards: four eyes on verdicts and approvals, preview before stable, a conflict on a record
 * released since, and a tenant reading nothing of the change requests.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))

const corpus = { queued: [] as string[], unknown: [] as string[], ingested: [] as string[], marks: {} as Record<string, unknown> }
vi.mock('@/lib/knowledge/service', () => ({
  reingestKnowledgeBaseDocuments: async (names: string[], marks: Record<string, unknown> = {}) => (Object.assign(corpus.marks, marks), {
    status: 'pending',
    queued: names.filter((name) => corpus.queued.includes(name)),
    unknown: names.filter((name) => corpus.unknown.includes(name)),
    message: '',
  }),
  getKnowledgeBaseStatus: async () => ({ files: corpus.ingested.map((fileName) => ({ fileName, state: 'ingested' })) }),
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const ORG = `org_pbk_${RUN}`
const SECOND_ORG = `org_pbk_${RUN}_second`
const GRAZ = `AT:testgraz:${RUN}`
const VIENNA = `AT:testwien:${RUN}`
const AUTHOR = 'user_pbk_author'
const EXPERT = 'user_pbk_expert'
const ACTOR = { by: EXPERT, decisionSource: 'app' as const }

describe.skipIf(!url)('platform base knowledge against Postgres', () => {
  let store: typeof import('./store')
  let release: typeof import('./release')
  let entitlements: typeof import('./entitlements')
  let indexing: typeof import('./indexing')
  let officeRead: typeof import('./office-read')
  let wire: typeof import('./wire')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const key = (name: string) => `${name}-${RUN}`
  const records = (raw: unknown[]) => raw.map((record) => wire.proposedRecordSchema.parse(record))

  /** A request through to approval: proposed by the author, every claim accepted and approved by the expert. */
  async function approved(title: string, raw: unknown[]): Promise<string> {
    const id = await store.insertChangeRequest({ title, countryId: 'AT', createdBy: AUTHOR })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      await store.insertProposedRecords(tx, request!, records(raw), { createdBy: AUTHOR, proposedBy: 'person' })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    const view = await store.readChangeRequest(id)
    await store.platformTransaction(async (tx) => {
      await store.insertReviewDecisions(
        tx,
        id,
        { by: EXPERT, decisionSource: 'app' },
        view!.revisions.flatMap((revision) =>
          revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const })),
        ),
      )
      await store.insertApproval(tx, { changeRequestId: id, approver: EXPERT, role: 'domain_expert', decisionSource: 'app' })
      await store.setChangeRequestStatus(tx, id, 'approved', 'decidedAt')
    })
    return id
  }

  async function published(title: string, raw: unknown[]): Promise<string> {
    const id = await approved(title, raw)
    await release.publishChangeRequest(id, 'preview', ACTOR)
    await release.publishChangeRequest(id, 'stable', ACTOR)
    return id
  }

  const head = async (recordId: string) =>
    withPlatformAccess('pbk spec head', async () => {
      const rows = await db.execute<{ head: string | null }>(sql`SELECT head_revision_id AS head FROM knowledge_records WHERE id = ${recordId}`)
      return rows[0]?.head ?? null
    })

  const listing = () => [
    {
      type: 'work',
      key: key('oenorm-b-5371'),
      kind: 'technical_standard',
      title: 'Treppen, Geländer und Brüstungen',
      designation: 'ÖNORM B 5371',
      issuer: 'Austrian Standards',
    },
    { type: 'edition', key: key('oenorm-b-5371-2021'), workKey: key('oenorm-b-5371'), label: '2021-01-15' },
  ]

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    store = await import('./store')
    release = await import('./release')
    entitlements = await import('./entitlements')
    indexing = await import('./indexing')
    officeRead = await import('./office-read')
    wire = await import('./wire')
    // The first office sits in Austria; the second in Germany, entitled to nothing else yet.
    for (const [organizationId, home] of [
      [ORG, 'AT'],
      [SECOND_ORG, 'DE'],
    ] as const) {
      await withTenant({ organizationId }, () =>
        db.execute(sql`INSERT INTO organizations (workos_organization_id, home_country) VALUES (${organizationId}, ${home})`),
      )
    }
    // Austria's territories, one request: what authorities and directives name.
    await published('Austria: territories', [
      { type: 'territory', id: 'AT', kind: 'country', name: 'Österreich' },
      { type: 'territory', id: 'AT-6', kind: 'state', name: 'Steiermark', parents: [{ id: 'AT' }] },
      { type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parents: [{ id: 'AT' }] },
      // Run-scoped places, so the competence rules below decide for this run's places only and never for a
      // real Gemeinde another suite in the same database resolves (site-resolution's Graz).
      { type: 'territory', id: GRAZ, kind: 'municipality', name: 'Graz (test)', parents: [{ id: 'AT-6' }] },
      { type: 'territory', id: VIENNA, kind: 'municipality', name: 'Wien (test)', parents: [{ id: 'AT-9' }] },
    ])
  })

  afterAll(async () => {
    await withPlatformAccess('pbk spec cleanup', async () => {
      await db.execute(sql`DELETE FROM organization_countries WHERE organization_id IN (${ORG}, ${SECOND_ORG})`)
      await db.execute(sql`DELETE FROM organizations WHERE workos_organization_id IN (${ORG}, ${SECOND_ORG})`)
    })
  })

  it('a rollback round trip: each head returns to where it was, and every move is kept', async () => {
    const workId = `work:${key('oenorm-b-5371')}`
    const first = await published('ÖNORM B 5371 listed', listing())
    const firstHead = await head(workId)
    expect(firstHead).not.toBeNull()
    const [retitled] = listing()
    const second = await published('ÖNORM B 5371 retitled', [{ ...retitled, title: 'Treppen (neu)' }])
    const secondHead = await head(workId)
    expect(secondHead).not.toBe(firstHead)

    // The older release cannot be undone under a newer one.
    await expect(release.rollbackChangeRequest(first, 'wrong order', ACTOR)).rejects.toThrow(/released again/)
    expect(await release.rollbackChangeRequest(second, 'title was right', ACTOR)).toEqual({ restored: 1, unreleasedFiles: [] })
    expect(await head(workId)).toBe(firstHead)
    // The rolled-back revision stays readable to whoever may read the record: an old citation resolves.
    expect(await officeRead.PLATFORM_RECORDS_KNOWLEDGE.isReleased(ORG, secondHead!)).toBe(true)

    expect(await release.rollbackChangeRequest(first, 'not yet', ACTOR)).toMatchObject({ restored: 2 })
    expect(await head(workId)).toBeNull()
    const moves = await withPlatformAccess('pbk spec moves', () =>
      db.execute<{ action: string }>(sql`SELECT action FROM knowledge_release_moves WHERE record_id = ${workId} AND channel = 'stable' ORDER BY seq`),
    )
    expect(moves.map((move) => move.action)).toEqual(['publish', 'publish', 'rollback', 'rollback'])
    // Publish it again for the tests below.
    await published('ÖNORM B 5371 listed again', listing())
  })

  it('a second office sees the std-asi listing as "gelistet, kein Text" once entitled to Austria, and not before', async () => {
    // Positive control: the Austrian office sees it.
    expect(await officeRead.PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(ORG, [])).toEqual(
      expect.arrayContaining([expect.objectContaining({ designation: 'ÖNORM B 5371', hasText: false })]),
    )
    // An office holding the norm (its own edition suffix aside) is not told it lacks it.
    const held = await officeRead.PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(ORG, ['ÖNORM B 5371:2021'])
    expect(held.map((listed) => listed.designation)).not.toContain('ÖNORM B 5371')

    expect(await officeRead.PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(SECOND_ORG, [])).toEqual([])
    const raw = await withTenant({ organizationId: SECOND_ORG }, () =>
      // Austria's records only: suites running beside this one publish other countries' platform rows into the same database.
      db.execute(sql`SELECT 1 FROM knowledge_records WHERE organization_id IS NULL AND country_id = 'AT'`),
    )
    expect(raw).toHaveLength(0)

    await entitlements.setEntitlement(SECOND_ORG, 'AT', true, ACTOR)
    const listed = await officeRead.PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(SECOND_ORG, [])
    expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ designation: 'ÖNORM B 5371', hasText: false })]))
    const { renderBaseKnowledgeBlock } = await import('../office/turn-block')
    expect(renderBaseKnowledgeBlock([], { territoryId: null, label: null }, listed)).toContain('gelistet, kein Text')

    // Withdrawn: gone again.
    await entitlements.setEntitlement(SECOND_ORG, 'AT', false, ACTOR)
    expect(await officeRead.PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(SECOND_ORG, [])).toEqual([])
  })

  it('excludes an MA 37 directive for a project in Graz, and applies it in Vienna, by the competence rulesets', async () => {
    await published('MA 37, its directive and Vienna’s competence', [
      {
        type: 'authority',
        key: key('at-wien-ma37'),
        name: 'MA 37 Baupolizei',
        functionCodes: ['building_permit'],
        seatTerritoryId: 'AT-9',
        competenceTerritoryIds: ['AT-9'],
      },
      {
        type: 'work',
        key: key('ma37-stellplatz'),
        kind: 'authority_directive',
        title: 'Weisung Stellplätze',
        territoryIds: ['AT-9'],
        addressees: [{ name: 'MA 37', territoryId: 'AT-9', authorityKey: key('at-wien-ma37') }],
      },
      {
        type: 'ruleset',
        key: key('competence-at'),
        values: {
          purpose: 'competence',
          territoryIds: [GRAZ, VIENNA],
          validFrom: '2000-01-01',
          body: {
            kind: 'table',
            payloadSchema: 'decision_table.v1',
            payload: {
              inputs: [{ key: 'municipality', type: 'code' }],
              output: { type: 'bodies' },
              rows: [
                {
                  id: 'vienna',
                  when: { '===': [{ var: 'municipality' }, VIENNA] },
                  then: { bodies: [{ authorityId: `authority:${key('at-wien-ma37')}`, role: 'decides' }] },
                  provision: { citation: 'fixture: § 132 BO für Wien' },
                },
                {
                  id: 'styria',
                  when: { '===': [{ var: 'municipality' }, GRAZ] },
                  then: { bodies: [{ authorityId: `authority:${key('at-graz-bba')}`, role: 'decides' }] },
                  provision: { citation: 'fixture: § 95 Stmk. BauG' },
                },
              ],
              otherwise: { undetermined: true },
            },
          },
        },
      },
    ])
    const titles = async (territoryId: string | null) =>
      (await officeRead.PLATFORM_RECORDS_KNOWLEDGE.directivesFor(ORG, territoryId)).map((directive) => [directive.title, directive.verdict.verdict])
    expect(await titles(GRAZ)).not.toContainEqual(['Weisung Stellplätze', expect.anything()])
    // Positive control: in Vienna it applies.
    expect(await titles(VIENNA)).toContainEqual(['Weisung Stellplätze', 'applies'])
    // Unknown territory: said, not guessed.
    expect(await titles(null)).toContainEqual(['Weisung Stellplätze', 'authority_unknown'])
  })

  it('gives a published text its indexing run, and reads it indexed once the corpus has its chunks', async () => {
    const file = `OIB-RL-4-${RUN}.pdf`
    const id = await published('OIB-RL 4 text', [
      { type: 'work', key: key('oib-rl-4'), kind: 'guideline', title: 'Nutzungssicherheit und Barrierefreiheit', designation: 'OIB-RL 4' },
      { type: 'edition', key: key('oib-rl-4-2023'), workKey: key('oib-rl-4'), label: '2023' },
      { type: 'manifestation', key: key('oib-rl-4-2023-de'), editionKey: key('oib-rl-4-2023'), licenceClass: 'public_open', corpusFile: file },
    ])
    const runs = await withPlatformAccess('pbk spec runs', () =>
      db.execute<{ id: string }>(sql`SELECT id FROM knowledge_index_runs WHERE change_request_id = ${id}`),
    )
    expect(runs).toHaveLength(1)
    expect((await indexing.readIndexStatus(id)).texts).toEqual([expect.objectContaining({ corpusFile: file, state: 'requested' })])
    corpus.queued = [file]
    await indexing.runPlatformTextIndex(ORG, { runId: runs[0].id }, { last: false })
    expect((await indexing.readIndexStatus(id)).texts[0].state).toBe('queued')
    // The text's chunks carry its country and edition, so a turn's gate can filter them (ADR-0173).
    expect(corpus.marks[file]).toEqual({ countryId: 'AT', editionId: `edition:${key('oib-rl-4-2023')}` })
    corpus.ingested = [file]
    expect((await indexing.readIndexStatus(id)).texts[0].state).toBe('indexed')
    // The listing now says the platform holds the text.
    const listed = await officeRead.PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(ORG, [])
    expect(listed).toContainEqual(expect.objectContaining({ designation: 'OIB-RL 4', hasText: true }))
    // Rolled back, no release names the file any more: it is de-indexed (ADR-0173).
    expect(await release.rollbackChangeRequest(id, 'spec: the text goes', ACTOR)).toMatchObject({ unreleasedFiles: [file] })
  })

  it('records a corpus that does not know the file as failed, with why', async () => {
    const file = `missing-${RUN}.pdf`
    const id = await published('A text the corpus lacks', [
      { type: 'work', key: key('missing'), kind: 'guideline', title: 'Fehlt' },
      { type: 'edition', key: key('missing-1'), workKey: key('missing'), label: '1' },
      { type: 'manifestation', key: key('missing-1-de'), editionKey: key('missing-1'), licenceClass: 'public_open', corpusFile: file },
    ])
    const [run] = await withPlatformAccess('pbk spec run', () =>
      db.execute<{ id: string }>(sql`SELECT id FROM knowledge_index_runs WHERE change_request_id = ${id}`),
    )
    corpus.unknown = [file]
    await indexing.runPlatformTextIndex(ORG, { runId: run.id }, { last: false })
    expect((await indexing.readIndexStatus(id)).texts[0]).toMatchObject({ state: 'failed', failure: expect.stringContaining(file) })
  })

  it('refuses an approval by the request’s own author (four eyes)', async () => {
    const id = await store.insertChangeRequest({ title: 'own', countryId: 'AT', createdBy: AUTHOR })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      await store.insertProposedRecords(tx, request!, records([{ type: 'work', key: key('own'), kind: 'guideline', title: 'Eigen' }]), {
        createdBy: AUTHOR,
        proposedBy: 'person',
      })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    await expect(
      store.platformTransaction((tx) =>
        store.insertApproval(tx, { changeRequestId: id, approver: AUTHOR, role: 'domain_expert', decisionSource: 'app' }),
      ),
    ).rejects.toThrow(/four eyes/)
  })

  it('refuses a verdict by the request’s own author (four eyes), and takes the expert’s with its source', async () => {
    const id = await store.insertChangeRequest({ title: 'own review', countryId: 'AT', createdBy: AUTHOR })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      await store.insertProposedRecords(tx, request!, records([{ type: 'work', key: key('own-review'), kind: 'guideline', title: 'Eigen' }]), {
        createdBy: AUTHOR,
        proposedBy: 'agent',
      })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    const [revision] = (await store.readChangeRequest(id))!.revisions
    const verdict = [{ revisionId: revision.revisionId, claimPath: 'title', decision: 'accepted' as const }]
    await expect(
      store.platformTransaction((tx) => store.insertReviewDecisions(tx, id, { by: AUTHOR, decisionSource: 'agent' }, verdict)),
    ).rejects.toThrow(/four eyes/)
    // Positive control: another person's verdict lands, with how it was given.
    await store.platformTransaction((tx) => store.insertReviewDecisions(tx, id, { by: EXPERT, decisionSource: 'agent' }, verdict))
    const sources = await withPlatformAccess('pbk spec verdicts', () =>
      db.execute<{ source: string }>(sql`SELECT decision_source AS source FROM knowledge_review_decisions WHERE change_request_id = ${id}`),
    )
    expect(sources.map((row) => row.source)).toEqual(['agent'])
  })

  it('publishes to stable only after preview, and refuses a record released by another request since', async () => {
    const work = { type: 'work', key: key('race'), kind: 'guideline', title: 'Wettlauf' }
    const early = await approved('opened first', [work])
    await expect(release.publishChangeRequest(early, 'stable', ACTOR)).rejects.toThrow(/preview first/)
    await published('opened second, released first', [{ ...work, title: 'Wettlauf (zuerst)' }])
    await release.publishChangeRequest(early, 'preview', ACTOR)
    await expect(release.publishChangeRequest(early, 'stable', ACTOR)).rejects.toThrow(/released by another change request/)
  })

  it('shows a tenant nothing of the change requests, and lets no tenant entitle itself', async () => {
    const id = await store.insertChangeRequest({ title: 'hidden', countryId: 'AT', createdBy: AUTHOR })
    // Positive control: the platform reads it.
    expect(await store.findChangeRequest(id)).not.toBeNull()
    for (const table of ['knowledge_change_requests', 'knowledge_release_moves', 'knowledge_approvals', 'knowledge_review_decisions', 'knowledge_index_runs']) {
      const rows = await withTenant({ organizationId: ORG }, () => db.execute(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`))
      expect(rows, table).toHaveLength(0)
    }
    await expect(
      withTenant({ organizationId: SECOND_ORG }, () =>
        db.execute(sql`INSERT INTO organization_countries (organization_id, country_id, entitled_by, decision_source)
                       VALUES (${SECOND_ORG}, 'AT', 'self', 'app')`),
      ),
    ).rejects.toThrow()
  })
})
