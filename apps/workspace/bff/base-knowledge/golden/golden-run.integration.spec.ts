/**
 * @vitest-environment node
 *
 * Golden cases as records and the golden run (migration 0228, ADR-0165
 * amendment) against a REAL Postgres, through the service the routes and the
 * door call:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/golden/golden-run.integration.spec.ts
 *
 * The outcomes, each with its control:
 * - a golden case is a platform record: proposed, reviewed, published, and read
 *   back by a run as the scorer reads it; a case nobody released does not run;
 * - a run asks each case once, and the conversation it asked in carries the
 *   case's site and facts in place of a project; no other conversation, and no
 *   other organization's turn, does;
 * - an answer is scored against its case, with its seconds and its cost from
 *   the usage ledger, and a case that could not be answered is settled without
 *   a verdict;
 * - a change request's cases run only from preview, a country the platform
 *   organization is not entitled to does not run, and only the person who
 *   started a run steps it;
 * - no tenant reads a case, a run or a verdict.
 *
 * The answer path itself (`askAgent`, the headless turn) stands in here: its
 * own specs hold it, and a turn needs a model.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AskView } from '@/lib/agent-asks/ask-wire'
import type { UserSession } from '@/lib/auth/types'
import { approvedRequest, publishedRequest } from '../platform/testing/lifecycle'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_golden_${Date.now().toString(36)}` }))
/** The asks the stand-in answer path holds, by ask id. */
const asks = vi.hoisted(() => ({ byId: new Map<string, Record<string, unknown>>(), refuse: null as string | null }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: async () => undefined }))
vi.mock('@/lib/authz/platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/authz/platform')>()
  return {
    ...real,
    getPlatformOrganizationId: async () => fixed.platformOrg,
    requirePlatformPermission: async (session: { permissions?: string[] } | null, permission: string) => {
      if (!session?.permissions?.includes(permission)) throw new real.PlatformAccessDeniedError(`Platform permission required: ${permission}`)
    },
  }
})
vi.mock('../platform/indexing', () => ({ enqueueIndexRuns: async () => ({ enqueued: 0, failed: 0 }), enqueueDeindex: async () => 0, readIndexStatus: vi.fn() }))
vi.mock('@/lib/conversations/repository', () => ({ findMessageInConversation: async () => ({ metadata: { trace_id: '0af7651916cd43dd8448eb211c80319c' } }) }))
vi.mock('@/lib/langfuse/golden-run-score', () => ({ goldenDatasetRunName: () => null, recordGoldenScores: async () => undefined }))
vi.mock('@/lib/agent-asks/service', () => ({
  askAgent: async (session: { organizationId: string }, input: { question: string }, options: { beforeTurn?: (ask: { id: string; conversationId: string }) => Promise<void> }) => {
    const id = randomUUID()
    const conversationId = `s_${id.replace(/-/g, '_')}`
    const view = { id, conversationId, projectId: null, state: 'submitted', question: input.question, reason: null, answer: null, documents: [], createdAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z', endedAt: null, pollAfterSeconds: 10 }
    if (asks.refuse) return { ...view, state: 'rejected', reason: asks.refuse }
    await options.beforeTurn?.({ id, conversationId })
    asks.byId.set(id, view)
    return view
  },
  getAsk: async (_session: unknown, id: string) => asks.byId.get(id),
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const COUNTRY = 'XG'
const MANAGE = ['platform:settings:view', 'platform:knowledge:write', 'platform:knowledge:review', 'platform:knowledge:approve_as_domain_expert']

const person = (userId: string, permissions: string[], organizationId = fixed.platformOrg) =>
  ({ userId, email: `${userId}@example.com`, organizationId, permissions }) as unknown as UserSession

describe('the golden-run suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('golden cases as records, and the golden run', () => {
  let run: typeof import('./run')
  let turn: typeof import('./turn')
  let wire: typeof import('../platform/wire')
  let release: typeof import('../platform/release')
  let entitlements: typeof import('../platform/entitlements')
  let context: typeof import('@/lib/db/tenant-context')
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const operator = person(`user_golden_operator_${RUN}`, MANAGE)
  const expert = person(`user_golden_expert_${RUN}`, MANAGE)
  const viewer = person(`user_golden_viewer_${RUN}`, ['platform:settings:view'])
  const actors = { author: operator.userId, expert: expert.userId }
  const STAIR = `stair-${RUN}`
  const CLASS = `class-${RUN}`

  const goldenCase = (key: string, question: string, extra: Record<string, unknown> = {}) =>
    wire.proposedRecordSchema.parse({
      type: 'golden_case',
      key,
      question,
      language: 'en',
      expected: { values: [{ label: 'distance', anyOf: ['40 m'], grounding: 'text' }], citations: [{ designation: 'Fire Code', locus: 'clause 5.1', grounding: 'text' }] },
      mustNot: [{ kind: 'phrase', id: 'confident-with-gap', in: 'confidence_reason', anyOf: ['open'], whenConfidence: ['high'] }],
      tags: ['fixture'],
      ...extra,
    })

  const answer = (id: string, text: string, confidence: { level: 'high' | 'medium'; reason: string }) => {
    const submitted = asks.byId.get(id) as unknown as AskView
    asks.byId.set(id, {
      ...submitted,
      state: 'completed',
      endedAt: '2026-11-11T10:00:36.300Z',
      answer: { messageId: randomUUID(), text, confidence, sources: [{ documentId: 'doc:fire-code', name: 'Fire Code, edition 2023', kind: 'building_law', url: 'https://app.example/cite' }] },
    })
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    context = await import('@/lib/db/tenant-context')
    db = (await import('@/lib/db')).getDb()
    run = await import('./run')
    turn = await import('./turn')
    wire = await import('../platform/wire')
    release = await import('../platform/release')
    entitlements = await import('../platform/entitlements')
    await publishedRequest(
      {
        title: `Golden cases ${RUN}`,
        countryId: COUNTRY,
        records: [goldenCase(STAIR, 'How long may the escape route be?', { context: { facts: { storeys_above_ground: 4, building_type: 'residential' }, referenceDate: '2023-06-01' } }), goldenCase(CLASS, 'Which class is it?')],
      },
      actors,
    )
  })

  it('does not run a country the platform organization is not entitled to', async () => {
    await expect(run.startGoldenRun(operator, { countryId: COUNTRY })).rejects.toMatchObject({ status: 409, details: { reason: 'golden-run-not-entitled' } })
  })

  it('runs the released cases: each asked once, scored against its case, with seconds and the ledger’s cost', async () => {
    await entitlements.setEntitlement(fixed.platformOrg, COUNTRY, true, { by: expert.userId, decisionSource: 'app' })
    const started = await run.startGoldenRun(operator, { countryId: COUNTRY })
    expect(started.summary).toMatchObject({ cases: 2, asked: 2, pending: 0, settled: 0 })
    expect(started.releaseSeq).toEqual(expect.any(Number))
    const [stair, klass] = [STAIR, CLASS].map((key) => started.cases.find((entry) => entry.key === key)!)

    // The conversation a case was asked in carries its site and facts; no other conversation does, and no other organization's.
    const conversationOf = (askId: string) => String((asks.byId.get(askId) as { conversationId: string }).conversationId)
    const golden = await turn.goldenTurnFor(fixed.platformOrg, conversationOf(stair.askId!))
    expect(golden?.projectContext).toBe('Stated facts of the building in question (no project is open):\nfiled_on=2023-06-01\nbuilding_type=residential\nstoreys_above_ground=4')
    expect(golden?.knowledgeContext.gate.state).toEqual(expect.any(String))
    expect(await turn.goldenTurnFor(fixed.platformOrg, 's_another_conversation')).toBeNull()
    expect(await turn.goldenTurnFor('org_an_office', conversationOf(stair.askId!))).toBeNull()

    // Still running: a step settles nothing and asks nothing twice.
    expect((await run.advanceGoldenRun(operator, started.runId, 0)).summary).toMatchObject({ asked: 2, settled: 0 })

    answer(stair.askId!, 'At most 40 m (Fire Code, clause 5.1).', { level: 'high', reason: 'The clause was read.' })
    answer(klass.askId!, 'Probably 40 m.', { level: 'high', reason: 'The value is read; the use is open.' })
    await context.withTenant({ organizationId: fixed.platformOrg }, () =>
      db.execute(sql`INSERT INTO llm_usage_events (organization_id, conversation_id, cost_usd) VALUES
        (${fixed.platformOrg}, ${conversationOf(stair.askId!)}, 0.031), (${fixed.platformOrg}, ${conversationOf(stair.askId!)}, 0.011)`),
    )

    const done = await run.advanceGoldenRun(operator, started.runId, 0)
    expect(done.summary).toMatchObject({ cases: 2, settled: 2, passed: 1, failed: 1, unanswered: 0 })
    expect(done.finishedAt).not.toBeNull()
    expect(done.medianSeconds).toBe(36.3)
    const settled = (key: string) => done.cases.find((entry) => entry.key === key)!
    expect(settled(STAIR)).toMatchObject({ state: 'settled', passed: true })
    expect(settled(STAIR).result).toMatchObject({ seconds: 36.3, costUsd: 0.042, confidence: 'high', traceId: '0af7651916cd43dd8448eb211c80319c' })
    expect(settled(STAIR).result?.scores).toMatchObject({ 'golden-case-passed': true, 'golden-expected-values': 1, 'claim-citation-resolves': true, 'law-cited-from-web': false, 'golden-seconds': 36.3, 'golden-cost-usd': 0.042 })
    expect(settled(CLASS).passed).toBe(false)
    expect(settled(CLASS).result?.costUsd).toBeNull()
    expect(settled(CLASS).result?.checks.filter((check) => !check.passed).map((check) => `${check.kind}:${check.id}`)).toEqual(['citation:Fire Code', 'must_not:confident-with-gap'])

    // Read by anyone on the platform; stepped only by the person who started it; a settled run stays as it is.
    expect((await run.getGoldenRun(viewer, started.runId)).summary.passed).toBe(1)
    await expect(run.advanceGoldenRun(expert, started.runId, 0)).rejects.toMatchObject({ status: 403 })
    expect((await run.advanceGoldenRun(operator, started.runId, 0)).summary).toEqual(done.summary)
    await expect(run.getGoldenRun(viewer, 'not-a-run')).rejects.toMatchObject({ status: 404 })
  })

  it('settles a case the answer path refused as unanswered, with why and no verdict', async () => {
    asks.refuse = 'The organization LLM budget is exhausted.'
    try {
      const refused = await run.startGoldenRun(operator, { countryId: COUNTRY, caseKeys: [STAIR] })
      expect(refused.summary).toMatchObject({ cases: 1, settled: 1, passed: 0, failed: 0, unanswered: 1 })
      expect(refused.cases[0]).toMatchObject({ passed: null, result: null, failure: 'rejected: The organization LLM budget is exhausted.' })
      expect(refused.finishedAt).not.toBeNull()
    } finally {
      asks.refuse = null
    }
    await expect(run.startGoldenRun(operator, { countryId: COUNTRY, caseKeys: ['no-such-case'] })).rejects.toMatchObject({ status: 404 })
  })

  it('runs a change request’s cases only once it is in preview, and then those cases and no others', async () => {
    const DRAFTED = `drafted-${RUN}`
    const id = await approvedRequest({ title: `More golden cases ${RUN}`, countryId: COUNTRY, records: [goldenCase(DRAFTED, 'Is a lift required?')] }, actors)
    await expect(run.startGoldenRun(operator, { countryId: COUNTRY, changeRequestId: id })).rejects.toMatchObject({ status: 409, details: { reason: 'golden-run-not-in-preview' } })
    await expect(run.startGoldenRun(operator, { countryId: 'XH', changeRequestId: id })).rejects.toMatchObject({ status: 409 })
    // Approved and unreleased: the released set does not hold it.
    expect((await run.startGoldenRun(operator, { countryId: COUNTRY })).cases.map((entry) => entry.key).sort()).toEqual([CLASS, STAIR].sort())

    await release.publishChangeRequest(id, 'preview', { by: expert.userId, decisionSource: 'app' })
    const preview = await run.startGoldenRun(operator, { countryId: COUNTRY, changeRequestId: id })
    expect(preview.changeRequestId).toBe(id)
    expect(preview.cases.map((entry) => entry.key)).toEqual([DRAFTED])
  })

  it('refuses a caller outside the platform organization, and one without the permission', async () => {
    await expect(run.startGoldenRun(person(operator.userId, MANAGE, 'org_an_office'), { countryId: COUNTRY })).rejects.toMatchObject({ status: 403 })
    await expect(run.startGoldenRun(viewer, { countryId: COUNTRY })).rejects.toThrow(/Platform permission required/)
  })

  it('shows a tenant no case, no run and no verdict', async () => {
    for (const table of ['knowledge_golden_case_revisions', 'knowledge_golden_runs', 'knowledge_golden_run_cases']) {
      const visible = await context.withTenant({ organizationId: fixed.platformOrg }, () => db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)}`))
      expect(Number(visible[0]?.n), table).toBe(0)
      const platform = await context.withPlatformAccess('golden spec', () => db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)}`))
      expect(Number(platform[0]?.n), table).toBeGreaterThan(0)
    }
  })
})
