// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json
/**
 * @vitest-environment node
 *
 * The Austria pack in the records, against a REAL Postgres (migration 0211,
 * ADR-0168), every office read through the restricted runtime role:
 *
 *   bash scripts/rls-test-db.sh --only bff/base-knowledge/chain/chain.integration.spec.ts
 *
 * The EU and Austria packs enter as change requests, reviewed, approved and
 * published like any platform change (there is no seed path), and then:
 * - an Austrian office reads the chain for Steiermark: OIB-RL 2 binds in 2019
 *   and 2023 only guides (defect 7), with the route;
 * - the EU pack follows an entitled member: an Austrian office reads the CPR,
 *   a German office with no Austrian entitlement reads nothing of either;
 * - a record of another pack is read only where a released relation reaches
 *   it, and stops being read when that relation is rolled back;
 * - a relation is append-only and names records of its own owner or the platform's.
 *
 * Publishes Austria's real territory ids, which `platform.integration.spec.ts`
 * publishes too: it runs one file at a time (`scripts/rls-test-db.sh`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/knowledge/service', () => ({
  reingestKnowledgeBaseDocuments: async (names: string[]) => ({ status: 'pending', queued: names, unknown: [], message: '' }),
  getKnowledgeBaseStatus: async () => ({ files: [] }),
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const AUSTRIAN = `org_chain_${RUN}_at`
const GERMAN = `org_chain_${RUN}_de`
const SECOND_AUSTRIAN = `org_chain_${RUN}_at2`
const BRITISH = `org_chain_${RUN}_gb`
const AUTHOR = 'user_chain_author'
const EXPERT = 'user_chain_expert'
const ACTOR = { by: EXPERT, decisionSource: 'app' as const }

const pack = (name: string): { countryId: string; title: string; records: unknown[] } =>
  JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', name), 'utf8'))

describe.skipIf(!url)('the Austria pack against Postgres', () => {
  let store: typeof import('../platform/store')
  let release: typeof import('../platform/release')
  let wire: typeof import('../platform/wire')
  let load: typeof import('./load')
  let resolve: typeof import('./resolve')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  /** Proposed by the author, every claim accepted and approved by the expert, published to preview and stable. */
  async function published(countryId: string, title: string, raw: unknown[]): Promise<string> {
    const id = await store.insertChangeRequest({ title, countryId, createdBy: AUTHOR })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      // In batches, as records-propose takes them: a pack may hold more records than one batch carries.
      for (let start = 0; start < raw.length; start += wire.MAX_PROPOSED_RECORDS) {
        const records = wire.proposeRecordsBodySchema.parse({ records: raw.slice(start, start + wire.MAX_PROPOSED_RECORDS) }).records
        await store.insertProposedRecords(tx, request!, records, { createdBy: AUTHOR, proposedBy: 'person' })
      }
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
    await release.publishChangeRequest(id, 'preview', ACTOR)
    await release.publishChangeRequest(id, 'stable', ACTOR)
    return id
  }

  const bindingOf = async (organizationId: string, leaf: string, workId: string) => {
    const { graph, truncated } = await load.loadGraph(organizationId, leaf)
    expect(truncated).toBe(false)
    return resolve
      .resolveChain(graph, leaf, '2026-11-10')
      .uses.filter((use) => use.workId === workId)
      .map((use) => [use.editionId, use.role])
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    store = await import('../platform/store')
    release = await import('../platform/release')
    wire = await import('../platform/wire')
    load = await import('./load')
    resolve = await import('./resolve')
    for (const [organizationId, home] of [
      [AUSTRIAN, 'AT'],
      [GERMAN, 'DE'],
      [SECOND_AUSTRIAN, 'AT'],
      [BRITISH, 'GB'],
    ] as const) {
      await withTenant({ organizationId }, () =>
        db.execute(sql`INSERT INTO organizations (workos_organization_id, home_country) VALUES (${organizationId}, ${home})`),
      )
    }
    const eu = pack('eu.json')
    const at = pack('at.json')
    await published(eu.countryId, eu.title, eu.records)
    await published(at.countryId, at.title, at.records)
  })

  afterAll(async () => {
    await withPlatformAccess('chain spec cleanup', async () => {
      await db.execute(sql`DELETE FROM organizations WHERE workos_organization_id IN (${AUSTRIAN}, ${GERMAN}, ${SECOND_AUSTRIAN}, ${BRITISH})`)
    })
  })

  it('reads the chain for Steiermark: OIB-RL 2 binds in 2019, and 2023 only guides (defect 7)', async () => {
    expect(await bindingOf(AUSTRIAN, 'AT-6', 'work:oib-rl-2')).toEqual([
      ['edition:oib-rl-2-2019', 'binding'],
      ['edition:oib-rl-2-2023', 'guidance'],
    ])
    expect(await bindingOf(AUSTRIAN, 'AT-9', 'work:oib-rl-2')).toEqual([
      ['edition:oib-rl-2-2023', 'binding'],
      ['edition:oib-rl-2-2019', 'information'],
    ])
    const { graph } = await load.loadGraph(AUSTRIAN, 'AT-6')
    expect(graph.editions.get('edition:oib-rl-2-2023')?.corpusFiles).toEqual(['oib-rl_2_ausgabe_mai_2023.pdf'])
  })

  it('reads a work’s identifiers at its source as its sourceRefs, by scheme, and nothing else of them', async () => {
    await published('AT', 'A Viennese statute read live at RIS', [
      {
        type: 'work',
        key: `wien-statute-${RUN}`,
        kind: 'statute',
        title: 'Testgesetz für Wien',
        designation: 'TG Wien',
        territoryIds: ['AT-9'],
        identifiers: { 'ris_gesetzesnummer': '20000006', eli: `https://example.test/eli/lgbl/w/${RUN}/` },
        citations: [{ url: 'https://www.ris.bka.gv.at/', note: 'fixture' }],
      },
    ])
    const { graph } = await load.loadGraph(AUSTRIAN, 'AT-9')
    expect(graph.works.get(`work:wien-statute-${RUN}`)?.sourceRefs).toEqual([
      { scheme: 'eli', value: `https://example.test/eli/lgbl/w/${RUN}/` },
      { scheme: 'ris_gesetzesnummer', value: '20000006' },
    ])
  })

  it('reads the EU pack through an entitled member, and a German office reads neither', async () => {
    expect(await bindingOf(AUSTRIAN, 'AT-9', 'work:eu-cpr')).toEqual([['edition:eu-cpr-305-2011', 'binding']])
    // Positive control above; the same reads for an office not entitled to Austria.
    const { graph } = await load.loadGraph(GERMAN, 'AT-9')
    expect([...graph.works.keys()]).toEqual([])
    expect(graph.relations).toEqual([])
    const raw = await withTenant({ organizationId: GERMAN }, () =>
      db.execute(sql`SELECT id FROM knowledge_records WHERE organization_id IS NULL AND (country_id = 'EU' OR country_id = 'AT')`),
    )
    expect(raw).toHaveLength(0)
  })

  it('reads no EU record through a membership that has ended', async () => {
    const euRecords = async (organizationId: string) =>
      withTenant({ organizationId }, () => db.execute(sql`SELECT id FROM knowledge_records WHERE organization_id IS NULL AND country_id = 'EU'`))
    expect((await euRecords(AUSTRIAN)).length).toBeGreaterThan(0)
    await published('GB', `United Kingdom ${RUN}`, [
      {
        type: 'territory',
        id: 'GB',
        kind: 'country',
        name: 'United Kingdom',
        datedParents: [{ id: 'EU', validFrom: '1973-01-01', validTo: '2020-02-01' }],
      },
    ])
    expect(await euRecords(BRITISH)).toHaveLength(0)
  })

  it('reads a record of another pack only where a released relation reaches it, and not after its rollback', async () => {
    // A Swiss standard (another pack, no Swiss entitlement) and, in a second request, the Austrian relation that reaches it.
    await published('CH', `SIA listing ${RUN}`, [
      { type: 'work', key: `sia-500-${RUN}`, kind: 'technical_standard', title: 'Hindernisfreie Bauten', designation: 'SIA 500' },
      { type: 'edition', key: `sia-500-2009-${RUN}`, workKey: `sia-500-${RUN}`, label: '2009', issuedOn: '2009-01-01' },
    ])
    const visible = async () =>
      (
        await withTenant({ organizationId: AUSTRIAN }, () =>
          db.execute<{ id: string }>(sql`SELECT id FROM knowledge_records WHERE id IN (${`work:sia-500-${RUN}`}, ${`edition:sia-500-2009-${RUN}`})`),
        )
      ).map((row) => row.id)
    expect(await visible()).toEqual([])
    const relation = await published('AT', `Wien references SIA 500 ${RUN}`, [
      {
        type: 'relation',
        key: `wien-sia-${RUN}`,
        relationType: 'makes_binding',
        mode: 'static_reference',
        from: { type: 'work', key: 'wbtv' },
        to: { type: 'edition', key: `sia-500-2009-${RUN}` },
      },
    ])
    expect((await visible()).sort()).toEqual([`edition:sia-500-2009-${RUN}`, `work:sia-500-${RUN}`])
    expect(await bindingOf(AUSTRIAN, 'AT-9', `work:sia-500-${RUN}`)).toEqual([[`edition:sia-500-2009-${RUN}`, 'binding']])
    // A German office reaches nothing through an Austrian relation it cannot read.
    const german = await withTenant({ organizationId: GERMAN }, () =>
      db.execute(sql`SELECT id FROM knowledge_records WHERE id = ${`work:sia-500-${RUN}`}`),
    )
    expect(german).toHaveLength(0)
    await release.rollbackChangeRequest(relation, 'spec: the reference goes', ACTOR)
    expect(await visible()).toEqual([])
  })

  it('reads an office relation for its own office only, as a route the office maintains', async () => {
    const relationId = `relation:office-${RUN}`
    const revisionId = crypto.randomUUID()
    await withTenant({ organizationId: AUSTRIAN }, async () => {
      await db.execute(sql`INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES (${relationId}, ${AUSTRIAN}, 'relation', ${AUTHOR})`)
      await db.execute(sql`INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by)
        VALUES (${revisionId}, ${relationId}, 'relation', ${AUSTRIAN}, ${AUTHOR})`)
      await db.execute(sql`INSERT INTO knowledge_relation_revisions
        (revision_id, record_id, organization_id, relation_type, mode, from_id, from_type, to_id, to_type)
        VALUES (${revisionId}, ${relationId}, ${AUSTRIAN}, 'makes_binding', 'declared', 'work:wbtv', 'work', 'edition:oib-rl-6-2019', 'edition')`)
      await db.execute(sql`UPDATE knowledge_records SET head_revision_id = ${revisionId} WHERE id = ${relationId}`)
    })
    const own = await load.loadGraph(AUSTRIAN, 'AT-9')
    expect(own.graph.relations.find((relation) => relation.id === relationId)?.owner).toBe('office')
    const rl6 = resolve
      .resolveChain(own.graph, 'AT-9', '2026-11-10')
      .uses.find((use) => use.editionId === 'edition:oib-rl-6-2019')
    expect(rl6).toMatchObject({ role: 'binding', qualifier: 'office_maintained' })
    // Another office entitled to the same country reads the platform's relations and not this one.
    const other = await load.loadGraph(SECOND_AUSTRIAN, 'AT-9')
    expect(other.graph.relations.length).toBeGreaterThan(0)
    expect(other.graph.relations.some((relation) => relation.id === relationId)).toBe(false)
  })

  it('keeps a relation append-only, and refuses a platform relation to an office record', async () => {
    const [row] = await withPlatformAccess('chain spec relation', () =>
      db.execute<{ revision_id: string }>(sql`SELECT revision_id FROM knowledge_relation_revisions LIMIT 1`),
    )
    // The runtime roles hold no UPDATE on a body (0209 revokes it); the append-only trigger stands behind that for the owner.
    await expect(
      withPlatformAccess('chain spec update', () =>
        db.execute(sql`UPDATE knowledge_relation_revisions SET provision = 'x' WHERE revision_id = ${row.revision_id}`),
      ),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }) })
    const officeWork = `work:office-${RUN}`
    await withTenant({ organizationId: AUSTRIAN }, () =>
      db.execute(sql`INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES (${officeWork}, ${AUSTRIAN}, 'work', ${AUTHOR})`),
    )
    const request = await store.insertChangeRequest({ title: `cross owner ${RUN}`, countryId: 'AT', createdBy: AUTHOR })
    await expect(
      store.platformTransaction(async (tx) => {
        const locked = await store.lockChangeRequest(tx, request)
        await store.insertProposedRecords(
          tx,
          locked!,
          wire.proposeRecordsBodySchema.parse({
            records: [
              {
                type: 'relation',
                key: `cross-${RUN}`,
                relationType: 'makes_binding',
                mode: 'declared',
                from: { type: 'work', key: 'wbtv' },
                to: { type: 'work', key: `office-${RUN}` },
              },
            ],
          }).records,
          { createdBy: AUTHOR, proposedBy: 'person' },
        )
      }),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/belongs to another owner/) }) })
  })
})
