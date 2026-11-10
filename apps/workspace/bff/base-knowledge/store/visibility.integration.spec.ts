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
const ACTOR = { by: EXPERT, decisionSource: 'app' as const }

const pack = (name: string): { countryId: string; title: string; records: unknown[] } =>
  JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', name), 'utf8'))

describe.skipIf(!url || !ownerUrl)('the office read predicate against the row policy', () => {
  let store: typeof import('../platform/store')
  let release: typeof import('../platform/release')
  let wire: typeof import('../platform/wire')
  let visibility: typeof import('./visibility')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let ORGANIZATION_SETTING: string
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let owner: postgres.Sql

  async function published(countryId: string, title: string, raw: unknown[]): Promise<void> {
    const id = await store.insertChangeRequest({ title, countryId, createdBy: AUTHOR })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      const records = wire.proposeRecordsBodySchema.parse({ records: raw }).records
      await store.insertProposedRecords(tx, request!, records, { createdBy: AUTHOR, proposedBy: 'person' })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    const view = await store.readChangeRequest(id)
    await store.platformTransaction(async (tx) => {
      await store.insertReviewDecisions(
        tx,
        id,
        ACTOR,
        view!.revisions.flatMap((revision) =>
          revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const })),
        ),
      )
      await store.insertApproval(tx, { changeRequestId: id, approver: EXPERT, role: 'domain_expert', decisionSource: 'app' })
      await store.setChangeRequestStatus(tx, id, 'approved', 'decidedAt')
    })
    await release.publishChangeRequest(id, 'preview', ACTOR)
    await release.publishChangeRequest(id, 'stable', ACTOR)
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
    store = await import('../platform/store')
    release = await import('../platform/release')
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

  it('is not vacuous: an Austrian office reads the reached Swiss standard and the EU pack, a German office neither', async () => {
    const austrian = await throughPredicate(AUSTRIAN)
    expect(austrian).toEqual(expect.arrayContaining([`work:sia-500-${RUN}`, 'EU']))
    const german = await throughPredicate(GERMAN)
    expect(german).not.toContain(`work:sia-500-${RUN}`)
    expect(german).not.toContain('AT-9')
  })
})
