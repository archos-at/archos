/**
 * @vitest-environment node
 *
 * `recordReadable` is the 0211 row policy on `knowledge_records`, written in
 * code (ADR-0165). Under the restricted role the policy hides whatever the
 * code predicate would widen, so the predicate is checked on its own: as the
 * table owner (RLS bypassed), with the office's setting bound, it must name
 * exactly the records the runtime role sees through the policy, for each
 * office in the database. Own rows, entitled rows, the EU pack through a
 * member, a record reached by a released relation, and another office's or
 * another country's rows all count.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@… TEST_OWNER_DATABASE_URL=postgres://app_owner@… \
 *     npx vitest run bff/base-knowledge/store/visibility.integration.spec.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { publishedRequest } from '../platform/testing/lifecycle'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/knowledge/service', () => ({
  reingestKnowledgeBaseDocuments: async (names: string[]) => ({ status: 'pending', queued: names, unknown: [], message: '' }),
  getKnowledgeBaseStatus: async () => ({ files: [] }),
}))

const url = process.env.TEST_DATABASE_URL
const ownerUrl = process.env.TEST_OWNER_DATABASE_URL
const RUN = Date.now().toString(36)
const AUSTRIAN = `org_vis_${RUN}_at`
const GERMAN = `org_vis_${RUN}_de`
const AUTHOR = 'user_vis_author'
const EXPERT = 'user_vis_expert'

const pack = (name: string): { countryId: string; title: string; records: unknown[] } =>
  JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', name), 'utf8'))

describe.skipIf(!url || !ownerUrl)('the office read predicate against the row policy', () => {
  let wire: typeof import('../platform/wire')
  let visibility: typeof import('./visibility')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let ORGANIZATION_SETTING: string
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let owner: postgres.Sql

  /** A pack published through the lifecycle (migration 0218), in batches as records-propose takes them: a pack may hold more than one batch. */
  async function published(countryId: string, title: string, raw: unknown[]): Promise<void> {
    const records = Array.from({ length: Math.ceil(raw.length / wire.MAX_PROPOSED_RECORDS) }, (_, i) =>
      wire.proposeRecordsBodySchema.parse({ records: raw.slice(i * wire.MAX_PROPOSED_RECORDS, (i + 1) * wire.MAX_PROPOSED_RECORDS) }).records,
    ).flat()
    await publishedRequest({ title, countryId, records }, { author: AUTHOR, expert: EXPERT })
  }

  /** The ids the runtime role reads through the row policy, as `organizationId`. */
  const throughPolicy = async (organizationId: string): Promise<string[]> =>
    (await withTenant({ organizationId }, () => db.execute<{ id: string }>(sql`SELECT id FROM knowledge_records ORDER BY id`))).map((row) => row.id)

  /** The ids the code predicate names for `organizationId`, read as the owner with no row policy. */
  async function throughPredicate(organizationId: string): Promise<string[]> {
    const ownerDb = drizzle(owner)
    return ownerDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config(${ORGANIZATION_SETTING}, ${organizationId}, true)`)
      const rows = await tx.execute<{ id: string }>(
        sql`SELECT r.id FROM knowledge_records r WHERE ${visibility.recordReadable('r', organizationId)} ORDER BY r.id`,
      )
      return rows.map((row) => row.id)
    })
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    ORGANIZATION_SETTING = context.ORGANIZATION_SETTING
    db = (await import('@/lib/db')).getDb()
    wire = await import('../platform/wire')
    visibility = await import('./visibility')
    owner = postgres(ownerUrl as string, { max: 1, onnotice: () => {} })
    for (const [organizationId, home] of [
      [AUSTRIAN, 'AT'],
      [GERMAN, 'DE'],
    ] as const) {
      await withTenant({ organizationId }, () =>
        db.execute(sql`INSERT INTO organizations (workos_organization_id, home_country) VALUES (${organizationId}, ${home})`),
      )
    }
    // The Austria and EU packs, unless a suite before this one in the same database published them.
    const held = await withPlatformAccess('visibility spec: are the packs published', () =>
      db.execute(sql`SELECT 1 FROM knowledge_records WHERE id = 'work:wbtv' AND head_revision_id IS NOT NULL`),
    )
    if (held.length === 0) {
      for (const name of ['eu.json', 'at.json']) {
        const { countryId, title, records } = pack(name)
        await published(countryId, `${title} ${RUN}`, records)
      }
    }
    // A Swiss standard no office is entitled to, reached from the Wiener Bautechnikverordnung.
    await published('CH', `SIA listing ${RUN}`, [
      { type: 'work', key: `sia-500-${RUN}`, kind: 'technical_standard', title: 'Hindernisfreie Bauten', designation: 'SIA 500' },
      { type: 'edition', key: `sia-500-2009-${RUN}`, workKey: `sia-500-${RUN}`, label: '2009', issuedOn: '2009-01-01' },
    ])
    await published('AT', `Wien references SIA 500 ${RUN}`, [
      {
        type: 'relation',
        key: `wien-sia-${RUN}`,
        relationType: 'makes_binding',
        mode: 'static_reference',
        from: { type: 'work', key: 'wbtv' },
        to: { type: 'edition', key: `sia-500-2009-${RUN}` },
      },
    ])
    // A chain of Swiss standards nine relation steps from the WBTV: hop-1 is one step away, hop-9 nine. The reach
    // stops at eight steps, a relation is read through a from-instrument reached with a step to spare (depth ≤ 7),
    // and step 3 lands on an edition, so hop-3's work is reached at depth 3 through it (the edition/work move).
    const hop = (i: number) => `hop-${i}-${RUN}`
    const swissChain: unknown[] = []
    for (let i = 1; i <= 9; i++) {
      swissChain.push({ type: 'work', key: hop(i), kind: 'technical_standard', title: `Hop ${i}`, designation: `HOP ${i}` })
    }
    swissChain.push({ type: 'edition', key: `${hop(3)}-2020`, workKey: hop(3), label: '2020', issuedOn: '2020-01-01' })
    for (let i = 1; i <= 8; i++) {
      const to = i === 2 ? { type: 'edition', key: `${hop(3)}-2020` } : { type: 'work', key: hop(i + 1) }
      swissChain.push({ type: 'relation', key: `${hop(i)}-next`, relationType: 'makes_binding', mode: 'dynamic_reference', from: { type: 'work', key: hop(i) }, to })
    }
    await published('CH', `A chain of Swiss standards ${RUN}`, swissChain)
    await published('AT', `Wien references the chain ${RUN}`, [
      { type: 'relation', key: `wien-hop-${RUN}`, relationType: 'makes_binding', mode: 'dynamic_reference', from: { type: 'work', key: 'wbtv' }, to: { type: 'work', key: hop(1) } },
    ])
  }, 120_000)

  afterAll(async () => {
    await owner?.end()
    await withPlatformAccess('visibility spec cleanup', async () => {
      await db.execute(sql`DELETE FROM organizations WHERE workos_organization_id IN (${AUSTRIAN}, ${GERMAN})`)
    })
  })

  it('names exactly what the row policy lets each office read', async () => {
    const offices = (
      await withPlatformAccess('visibility spec: every office', () =>
        db.execute<{ id: string }>(sql`SELECT workos_organization_id AS id FROM organizations ORDER BY 1`),
      )
    ).map((row) => row.id)
    expect(offices).toEqual(expect.arrayContaining([AUSTRIAN, GERMAN]))
    for (const organizationId of offices) {
      expect(await throughPredicate(organizationId), organizationId).toEqual(await throughPolicy(organizationId))
    }
  })

  // Migration 0236 reads the reach as one set; 0211's per-row walk stays defined, and is the oracle:
  // for every office, every platform record is in the set exactly where the walk answers true.
  it('reads the reach as one set that answers what the per-row walk answers, for every office', async () => {
    const offices = (
      await withPlatformAccess('visibility spec: every office', () =>
        db.execute<{ id: string }>(sql`SELECT workos_organization_id AS id FROM organizations ORDER BY 1`),
      )
    ).map((row) => row.id)
    for (const organizationId of offices) {
      const disagreements = await drizzle(owner).transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config(${ORGANIZATION_SETTING}, ${organizationId}, true)`)
        return tx.execute<{ id: string; walk: boolean }>(sql`
          SELECT r.id, knowledge_reached_by_relation(r.id) AS walk FROM knowledge_records r
          WHERE r.organization_id IS NULL
            AND knowledge_reached_by_relation(r.id) IS DISTINCT FROM (r.id IN (SELECT knowledge_reached_ids()))`)
      })
      expect(disagreements, organizationId).toEqual([])
    }
    const reached = await drizzle(owner).transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config(${ORGANIZATION_SETTING}, ${AUSTRIAN}, true)`)
      return (await tx.execute<{ id: string }>(sql`SELECT knowledge_reached_ids() AS id`)).map((row) => row.id)
    })
    expect(reached).toEqual(expect.arrayContaining([`work:sia-500-${RUN}`, `edition:sia-500-2009-${RUN}`]))
    // The chain's boundaries, stated independently of the per-row walk: works one to eight steps away are reached
    // (hop-3 through its edition), the ninth is not; a relation is read through a from-instrument at most seven
    // steps away, so the relation from hop-7 is and the one from hop-8 is not.
    const hop = (i: number) => `hop-${i}-${RUN}`
    for (let i = 1; i <= 8; i++) expect(reached, `work:${hop(i)}`).toContain(`work:${hop(i)}`)
    expect(reached).toContain(`edition:${hop(3)}-2020`)
    expect(reached).not.toContain(`work:${hop(9)}`)
    for (let i = 1; i <= 7; i++) expect(reached, `relation:${hop(i)}-next`).toContain(`relation:${hop(i)}-next`)
    expect(reached).not.toContain(`relation:${hop(8)}-next`)
  })

  it('is not vacuous: an Austrian office reads the reached Swiss standard and the EU pack, a German office neither', async () => {
    const austrian = await throughPredicate(AUSTRIAN)
    expect(austrian).toEqual(expect.arrayContaining([`work:sia-500-${RUN}`, 'EU']))
    const german = await throughPredicate(GERMAN)
    expect(german).not.toContain(`work:sia-500-${RUN}`)
    expect(german).not.toContain('AT-9')
  })
})
