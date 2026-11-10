/**
 * @vitest-environment node
 *
 * Which edition applied, against a REAL Postgres (migration 0206, ADR-0171),
 * every office read through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/time/time.integration.spec.ts
 *
 * The platform records are seeded the only way they can be (migration 0205):
 * through a change request, reviewed, approved and released to stable. The
 * node is synthetic (`AT:test:<run>`, under AT-3), so this run's
 * reference-date rule is the only one on it.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/knowledge/service', () => ({
  reingestKnowledgeBaseDocuments: async () => ({
    status: 'pending',
    queued: [],
    unknown: [],
    message: '',
  }),
  getKnowledgeBaseStatus: async () => ({ files: [] }),
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const ORG = `org_time_${RUN}`
const OUTSIDER = `org_time_${RUN}_outsider`
const AUTHOR = 'user_time_author'
const EXPERT = 'user_time_expert'
const ACTOR = { by: EXPERT, decisionSource: 'app' as const }
const NODE = `AT:test:${RUN}`
const NOW = new Date('2026-11-10T09:00:00Z')

describe.skipIf(!url)('editions in time against Postgres', () => {
  let store: typeof import('../platform/store')
  let release: typeof import('../platform/release')
  let wire: typeof import('../platform/wire')
  let repository: typeof import('./repository')
  let rulesets: typeof import('../store/rulesets')
  let asOf: typeof import('./as-of')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const key = (name: string) => `${name}-${RUN}`
  const workId = () => `work:${key('noe-bo')}`

  async function published(title: string, raw: unknown[]): Promise<void> {
    const id = await store.insertChangeRequest({ title, countryId: 'AT', createdBy: AUTHOR })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      const records = raw.map((record) => wire.proposedRecordSchema.parse(record))
      await store.insertProposedRecords(tx, request!, records, {
        createdBy: AUTHOR,
        proposedBy: 'person',
      })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    const view = await store.readChangeRequest(id)
    await store.platformTransaction(async (tx) => {
      const decisions = view!.revisions.flatMap((revision) =>
        revision.claims.map((claim) => ({
          revisionId: revision.revisionId,
          claimPath: claim.path,
          decision: 'accepted' as const,
        }))
      )
      await store.insertReviewDecisions(tx, id, { by: EXPERT, decisionSource: 'app' }, decisions)
      await store.insertApproval(tx, {
        changeRequestId: id,
        approver: EXPERT,
        role: 'domain_expert',
        decisionSource: 'app',
      })
      await store.setChangeRequestStatus(tx, id, 'approved', 'decidedAt')
    })
    await release.publishChangeRequest(id, 'preview', ACTOR)
    await release.publishChangeRequest(id, 'stable', ACTOR)
  }

  const transition = {
    inputs: [
      { key: 'filed_on', type: 'date' },
      { key: 'boundary_from', type: 'date' },
      { key: 'decided', type: 'boolean' },
      { key: 'decided_on', type: 'date' },
    ],
    output: { type: 'code', codes: ['old_law', 'new_law'] },
    rows: [
      {
        id: 'open-at-boundary',
        when: {
          and: [
            { '<': [{ var: 'filed_on' }, { var: 'boundary_from' }] },
            {
              or: [
                { '!': { var: 'decided' } },
                { '>=': [{ var: 'decided_on' }, { var: 'boundary_from' }] },
              ],
            },
          ],
        },
        then: 'old_law',
        provision: { citation: 'fixture: Übergangsbestimmung' },
      },
    ],
    otherwise: { then: 'new_law' },
    examples: [
      {
        facts: {
          filed_on: '2022-10-01',
          boundary_from: '2023-01-01',
          decided: true,
          decided_on: '2023-04-01',
        },
        expect: { then: 'old_law' },
      },
    ],
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
    repository = await import('./repository')
    rulesets = await import('../store/rulesets')
    asOf = await import('./as-of')
    for (const [organizationId, home] of [
      [ORG, 'AT'],
      [OUTSIDER, 'DE'],
    ] as const) {
      await withTenant({ organizationId }, () =>
        db.execute(
          sql`INSERT INTO organizations (workos_organization_id, home_country) VALUES (${organizationId}, ${home})`
        )
      )
    }
    await published('Austria: territories for time', [
      { type: 'territory', id: 'AT', kind: 'country', name: 'Österreich' },
      { type: 'territory', id: 'AT-3', kind: 'state', name: 'Niederösterreich', parents: [{ id: 'AT' }] },
      {
        type: 'territory',
        id: NODE,
        kind: 'municipality',
        name: 'Testgemeinde',
        parents: [{ id: 'AT-3' }],
      },
    ])
    await published('A Land building code in time', [
      {
        type: 'work',
        key: key('noe-bo'),
        kind: 'statute',
        title: 'Bauordnung (fixture)',
        territoryIds: ['AT-3'],
        historyAvailableFrom: '2015-02-01',
      },
      {
        type: 'edition',
        key: key('noe-bo-2015'),
        workKey: key('noe-bo'),
        label: 'LGBl. 1/2015',
        inForceFrom: '2015-02-01',
        inForceTo: '2022-12-31',
      },
      {
        type: 'edition',
        key: key('noe-bo-2023'),
        workKey: key('noe-bo'),
        label: 'LGBl. 2023/1',
        inForceFrom: '2023-01-01',
        transition,
      },
      {
        type: 'ruleset',
        key: key('node-reference-date'),
        values: {
          purpose: 'reference_date',
          territoryIds: [NODE],
          validFrom: '2000-01-01',
          body: {
            kind: 'table',
            payloadSchema: 'decision_table.v1',
            payload: {
              inputs: [{ key: 'filed_on', type: 'date' }],
              output: { type: 'event', events: ['filed_on'] },
              rows: [
                {
                  id: 'filed',
                  when: { '<=': ['0000-01-01', { var: 'filed_on' }] },
                  then: 'filed_on',
                  provision: { citation: 'fixture: Stichtag' },
                },
              ],
              otherwise: { undetermined: true },
            },
          },
        },
      },
    ])
  })

  afterAll(async () => {
    await withPlatformAccess('time spec cleanup', async () => {
      await db.execute(
        sql`DELETE FROM organization_countries WHERE organization_id IN (${ORG}, ${OUTSIDER})`
      )
      await db.execute(
        sql`DELETE FROM organizations WHERE workos_organization_id IN (${ORG}, ${OUTSIDER})`
      )
    })
  })

  async function answerFor(organizationId: string, procedure: Record<string, unknown>) {
    const read = await repository.readWorkInTime(organizationId, workId())
    if (!read) return null
    const chain = await repository.readTerritoryChain(organizationId, NODE, '2026-11-10')
    const rules = await rulesets.readRulesetsInForce(organizationId, {
      purpose: 'reference_date',
      territoryIds: chain,
    })
    const { procedureSchema } = await import('@/lib/base-knowledge/wire/time')
    return asOf.editionForProcedure({
      work: read.work,
      rulesets: rules.rulesets,
      chain,
      procedure: procedureSchema.parse(procedure),
      now: NOW,
    })
  }

  it('reads the released editions with their dates, transition and history start', async () => {
    const read = await repository.readWorkInTime(ORG, workId())
    expect(read?.unreadable).toEqual([])
    expect(read?.work.historyAvailableFrom).toBe('2015-02-01')
    expect(
      read?.work.editions.map((edition) => [
        edition.label,
        edition.inForceFrom,
        edition.inForceTo,
        edition.transition !== null,
      ])
    ).toEqual([
      ['LGBl. 1/2015', '2015-02-01', '2022-12-31', false],
      ['LGBl. 2023/1', '2023-01-01', null, true],
    ])
    // `EU` follows `AT` where another spec in the same database published the Austria pack's dated parent.
    expect((await repository.readTerritoryChain(ORG, NODE, '2026-11-10')).slice(0, 3)).toEqual([NODE, 'AT-3', 'AT'])
  })

  it('names the edition that applied: the stored transition keeps the old law for a procedure open at the boundary', async () => {
    const answer = await answerFor(ORG, { filedOn: '2022-10-01', decidedOn: '2023-04-01' })
    expect(answer).toMatchObject({
      status: 'determined',
      edition: { label: 'LGBl. 1/2015' },
      referenceDate: { date: '2022-10-01', territoryId: NODE },
      transitions: [{ outcome: 'old_law' }],
    })
    // Positive control: filed after the boundary, the new edition.
    expect(await answerFor(ORG, { filedOn: '2023-02-01', decidedOn: 'pending' })).toMatchObject({
      edition: { label: 'LGBl. 2023/1' },
    })
  })

  it('asks for the filing day it does not have, and refuses a day before the history held', async () => {
    expect(await answerFor(ORG, { decidedOn: '2023-04-01' })).toMatchObject({
      reason: 'unknown_inputs',
      unknownInputs: ['filed_on'],
    })
    expect(await answerFor(ORG, { filedOn: '2014-01-01' })).toMatchObject({
      reason: 'history_not_held',
    })
  })

  it('an office not entitled to Austria reads no such work', async () => {
    expect(await answerFor(OUTSIDER, { filedOn: '2022-10-01' })).toBeNull()
  })
})
