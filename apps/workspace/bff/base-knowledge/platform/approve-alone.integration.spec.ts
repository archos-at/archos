/**
 * @vitest-environment node
 *
 * Approve alone, review later (ADR-0176) against a REAL Postgres (migration
 * 0214), through the service the route and the door both call:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/platform/approve-alone.integration.spec.ts
 *
 * The guards, each with its positive control: the author's plain approve is
 * refused as before; the override is refused without the permission and
 * without the person's own yes; with both and a reason it approves, audits the
 * override, marks the request and every release from it `single` and puts the
 * request in the queue with its second review due; another person's review
 * and approve closes it, and their reject disputes it, which stops a further
 * publish and leaves the rollback to a person.
 */

import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_alone_${Date.now().toString(36)}` }))
const audit = vi.hoisted(() => ({ record: vi.fn(async (..._args: unknown[]) => undefined) }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
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
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: audit.record }))
vi.mock('./indexing', () => ({
  enqueueIndexRuns: async () => ({ enqueued: 0, failed: 0 }),
  enqueueDeindex: async () => 0,
  readIndexStatus: vi.fn(),
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const REASON = 'Only platform owner on call this week; counsel back on Monday.'
const MANAGE = ['platform:settings:view', 'platform:settings:manage', 'platform:knowledge:approve_as_domain_expert']

const person = (userId: string, permissions: string[]) =>
  ({ userId, email: `${userId}@example.com`, organizationId: fixed.platformOrg, permissions }) as unknown as UserSession

describe('the approve-alone suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('approving a platform change request alone (ADR-0176)', () => {
  let service: typeof import('./service')
  let store: typeof import('./store')
  let wire: typeof import('./wire')
  let runAsActingSession: typeof import('@/lib/agent-api/acting-session').runAsActingSession
  let PersonDecisionRequiredError: typeof import('@/lib/agent-api/person-decision').PersonDecisionRequiredError
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const AUTHOR = `user_alone_owner_${RUN}`
  const owner = person(AUTHOR, [...MANAGE, 'platform:knowledge:approve_alone'])
  const ownerWithout = person(AUTHOR, MANAGE)
  const expert = person(`user_alone_expert_${RUN}`, MANAGE)

  /** A submitted request holding one work, written by the owner. */
  async function submitted(name: string): Promise<string> {
    const id = await store.insertChangeRequest({ title: name, countryId: 'AT', createdBy: AUTHOR })
    const records = [wire.proposedRecordSchema.parse({ type: 'work', key: `${name}-${RUN}`, kind: 'guideline', title: `Leitfaden ${name}` })]
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      await store.insertProposedRecords(tx, request!, records, { createdBy: AUTHOR, proposedBy: 'person' })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    return id
  }

  const approvalRows = (id: string) =>
    withPlatformAccess('alone spec', () =>
      db.execute<{ approver: string; override_reason: string | null }>(
        sql`SELECT approver, override_reason FROM knowledge_approvals WHERE change_request_id = ${id}::uuid`,
      ),
    )

  const queued = async (id: string) => (await service.platformKnowledgeOverview(expert)).queue.some((request) => request.id === id)

  const acceptAll = async (id: string, by: UserSession) => {
    const view = await service.getPlatformChangeRequest(by, id)
    const decisions = view.revisions.flatMap((revision) =>
      revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const })),
    )
    await service.reviewPlatformChangeRequest(by, id, decisions)
  }

  const alone = { decision: 'approve' as const, role: 'domain_expert' as const, override: { reason: REASON } }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    service = await import('./service')
    store = await import('./store')
    wire = await import('./wire')
    runAsActingSession = (await import('@/lib/agent-api/acting-session')).runAsActingSession
    PersonDecisionRequiredError = (await import('@/lib/agent-api/person-decision')).PersonDecisionRequiredError
  })

  beforeEach(() => audit.record.mockClear())

  it('still refuses the author’s plain approve (four eyes)', async () => {
    const id = await submitted('plain')
    await expect(service.decidePlatformChangeRequest(owner, id, { decision: 'approve', role: 'domain_expert' })).rejects.toThrow(/four eyes/)
    expect(await approvalRows(id)).toHaveLength(0)
  })

  it('refuses the override without platform:knowledge:approve_alone', async () => {
    const id = await submitted('unpermitted')
    await expect(service.decidePlatformChangeRequest(ownerWithout, id, alone)).rejects.toMatchObject({ status: 403 })
    expect(await approvalRows(id)).toHaveLength(0)
  })

  it('refuses the override from an agent without the person’s yes, and takes the elicited one', async () => {
    const id = await submitted('agent')
    const asAgent = (decisionSource?: 'elicitation') =>
      runAsActingSession(owner as unknown as AuthorizedSession, () => service.decidePlatformChangeRequest(owner, id, alone), 'agent', decisionSource ? { decisionSource } : {})
    await expect(asAgent()).rejects.toBeInstanceOf(PersonDecisionRequiredError)
    expect(await approvalRows(id)).toHaveLength(0)
    await expect(asAgent('elicitation')).resolves.toMatchObject({ status: 'approved', approval: 'single' })
  })

  it('refuses a reason too short to follow up, at the wire and in the database', async () => {
    expect(wire.approvalBodySchema.safeParse({ decision: 'approve', override: { reason: 'just me' } }).success).toBe(false)
    const id = await submitted('short')
    await expect(
      store.platformTransaction((tx) =>
        store.insertApproval(tx, { changeRequestId: id, approver: AUTHOR, role: 'domain_expert', decisionSource: 'app', overrideReason: 'just me' }),
      ),
    ).rejects.toThrow()
  })

  it('refuses an override from somebody who wrote nothing in the request: there is nothing to override', async () => {
    const id = await submitted('stranger')
    const stranger = person(`user_alone_stranger_${RUN}`, [...MANAGE, 'platform:knowledge:approve_alone'])
    await expect(service.decidePlatformChangeRequest(stranger, id, alone)).rejects.toThrow(/nothing to override/)
  })

  it('approves alone with the permission and a reason: audited, marked on the request and its releases, a second review due', async () => {
    const id = await submitted('alone')
    await expect(service.decidePlatformChangeRequest(owner, id, alone)).resolves.toEqual({
      status: 'approved',
      awaiting: [],
      approval: 'single',
      secondReview: 'due',
    })
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.knowledge.change_request_approved_alone',
        actor: { userId: AUTHOR, email: `${AUTHOR}@example.com` },
        targetId: id,
        metadata: expect.objectContaining({ reason: REASON, revisionCount: 1, decisionSource: 'app' }),
      }),
    )
    expect(await approvalRows(id)).toEqual([{ approver: AUTHOR, override_reason: REASON }])
    expect(await queued(id)).toBe(true)

    await service.publishPlatformChangeRequest(owner, id, { channel: 'preview' })
    await service.publishPlatformChangeRequest(owner, id, { channel: 'stable' })
    const view = await service.getPlatformChangeRequest(expert, id)
    expect(view).toMatchObject({ status: 'published', approval: 'single', secondReview: { state: 'due', by: null } })
    expect(view.releases.length).toBeGreaterThan(0)
    expect(view.releases.every((release) => release.approval === 'single')).toBe(true)
    expect(view.approvals[0]?.overrideReason).toBe(REASON)

    // Another person's review, then their approve: the second review closes and leaves the queue.
    await expect(service.decidePlatformChangeRequest(owner, id, { decision: 'approve', role: 'domain_expert' })).rejects.toThrow(/second review/)
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'approve', role: 'domain_expert' })).rejects.toThrow(/not accepted/)
    await acceptAll(id, expert)
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'approve', role: 'domain_expert' })).resolves.toEqual({
      status: 'published',
      awaiting: [],
      approval: 'single',
      secondReview: 'confirmed',
    })
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'platform.knowledge.second_review_confirmed', targetId: id }))
    expect(await service.getPlatformChangeRequest(expert, id)).toMatchObject({ secondReview: { state: 'confirmed', by: expert.userId } })
    expect(await queued(id)).toBe(false)
  })

  it('marks a request the second review rejects, stops its further publishing, and leaves the rollback to a person', async () => {
    const id = await submitted('disputed')
    await service.decidePlatformChangeRequest(owner, id, alone)
    await service.publishPlatformChangeRequest(owner, id, { channel: 'preview' })
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'reject', role: 'domain_expert' })).resolves.toMatchObject({
      status: 'approved',
      secondReview: 'disputed',
    })
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'platform.knowledge.second_review_disputed' }))
    await expect(service.publishPlatformChangeRequest(owner, id, { channel: 'stable' })).rejects.toThrow(/disputed/)
    // A closed second review stays closed: the trigger refuses to reopen it.
    await expect(
      withPlatformAccess('alone spec', () => db.execute(sql`UPDATE knowledge_change_requests SET second_review = 'due', second_review_by = NULL, second_review_at = NULL WHERE id = ${id}::uuid`)),
    ).rejects.toThrow()
  })

  it('keeps the author from giving the second review themselves', async () => {
    const id = await submitted('self-review')
    await service.decidePlatformChangeRequest(owner, id, alone)
    await expect(service.decidePlatformChangeRequest(owner, id, { decision: 'reject', role: 'domain_expert' })).rejects.toThrow(/four eyes/)
    await expect(
      withPlatformAccess('alone spec', () =>
        db.execute(sql`UPDATE knowledge_change_requests SET second_review = 'confirmed', second_review_by = ${AUTHOR}, second_review_at = now() WHERE id = ${id}::uuid`),
      ),
    ).rejects.toThrow()
  })
})
