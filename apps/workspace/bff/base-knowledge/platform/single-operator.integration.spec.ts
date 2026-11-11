/**
 * @vitest-environment node
 *
 * One operator alone on dev (migration 0229, `./single-operator.ts`) against a
 * REAL Postgres, through the service the route and the door both call:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/platform/single-operator.integration.spec.ts
 *
 * Unset (prod, the default) the author of a request citing a page they pasted
 * is refused twice, as before: their own verdict (four eyes) and their approval
 * alone (nobody else checked the source). With `KNOWLEDGE_SINGLE_OPERATOR=true`
 * the same author reviews the claims, checks the source, approves with an
 * override and publishes, alone: the approval is audited, marked `single`, and
 * no second review is left due. A plain approve by the author is still refused.
 */

import { sql } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserSession } from '@/lib/auth/types'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_single_${Date.now().toString(36)}` }))
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
const REASON = 'Dev: one operator onboards the country alone, by the owner’s decision.'
const PERMISSIONS = [
  'platform:settings:view',
  'platform:knowledge:write',
  'platform:knowledge:review',
  'platform:knowledge:approve_as_domain_expert',
  'platform:knowledge:approve_alone',
]

describe('the single-operator suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('one operator alone on a deployment that says so (migration 0229)', () => {
  let service: typeof import('./service')
  let store: typeof import('./store')
  let onboarding: typeof import('./onboarding')
  let wire: typeof import('./wire')
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const AUTHOR = `user_single_owner_${RUN}`
  const owner = { userId: AUTHOR, email: `${AUTHOR}@example.com`, organizationId: fixed.platformOrg, permissions: PERMISSIONS } as unknown as UserSession
  const alone = { decision: 'approve' as const, role: 'domain_expert' as const, override: { reason: REASON } }

  /** A submitted request whose one work cites a page the author pasted: the case that blocked dev. */
  async function pastedRequest(name: string): Promise<string> {
    const id = await store.insertChangeRequest({ title: name, countryId: 'AT', createdBy: AUTHOR })
    const capture = await onboarding.capturePlatformCitation(owner, id, {
      basis: 'operator_supplied',
      url: `https://www.example.org/${name}`,
      text: `Leitfaden ${name}, Ausgabe 2026, des Landes`,
    })
    const record = wire.proposedRecordSchema.parse({
      type: 'work',
      key: `single-${name}-${RUN}`,
      kind: 'guideline',
      title: `Leitfaden ${name}`,
      citations: [{ captureId: capture.captureId, quote: `Leitfaden ${name}, Ausgabe 2026` }],
    })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      await store.insertProposedRecords(tx, request!, [record], { createdBy: AUTHOR, proposedBy: 'person' })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    return id
  }

  const reviewOwn = async (id: string, sourceChecked: boolean) => {
    const view = await service.getPlatformChangeRequest(owner, id)
    const decisions = view.revisions.flatMap((revision) =>
      revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const, sourceChecked })),
    )
    return service.reviewPlatformChangeRequest(owner, id, decisions)
  }

  const approvalRows = (id: string) =>
    withPlatformAccess('single spec', () =>
      db.execute<{ approver: string }>(sql`SELECT approver FROM knowledge_approvals WHERE change_request_id = ${id}::uuid`),
    )

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    withPlatformAccess = (await import('@/lib/db/tenant-context')).withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    service = await import('./service')
    store = await import('./store')
    onboarding = await import('./onboarding')
    wire = await import('./wire')
  })

  beforeEach(() => audit.record.mockClear())
  afterEach(() => vi.unstubAllEnvs())

  it('unset, refuses the author’s own verdict and their approval alone, as before (prod)', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', '')
    const id = await pastedRequest('default')
    await expect(reviewOwn(id, true)).rejects.toThrow(/four eyes/)
    await expect(service.decidePlatformChangeRequest(owner, id, alone)).rejects.toThrow(/Another person checks it/)
    expect(await approvalRows(id)).toHaveLength(0)
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('unset, the database still refuses a single approval that owes no second review (0214’s CHECK, now a trigger)', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', '')
    const id = await pastedRequest('backstop')
    await expect(
      store.platformTransaction((tx) => tx.execute(sql`UPDATE knowledge_change_requests SET approval = 'single' WHERE id = ${id}::uuid`)),
    ).rejects.toSatisfy((error: unknown) => /owes a second review/.test(String((error as { cause?: unknown }).cause ?? error)))
    await expect(
      store.platformTransaction((tx) =>
        tx.execute(sql`INSERT INTO knowledge_change_requests (id, title, country_id, created_by, approval) VALUES (gen_random_uuid(), 'x', 'AT', ${AUTHOR}, 'single')`),
      ),
    ).rejects.toSatisfy((error: unknown) => /owes a second review/.test(String((error as { cause?: unknown }).cause ?? error)))
  })

  it('set to anything but true, still refuses (fails closed)', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', '1')
    const id = await pastedRequest('one')
    await expect(reviewOwn(id, true)).rejects.toThrow(/four eyes/)
  })

  it('set, names the operator’s own way out when the source is not checked yet', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', 'true')
    const id = await pastedRequest('unchecked')
    await reviewOwn(id, false)
    expect((await service.getPlatformChangeRequest(owner, id)).sourcesUnchecked).toBe(true)
    await expect(service.decidePlatformChangeRequest(owner, id, alone)).rejects.toThrow(/check the source yourself/)
  })

  it('set, lets the author review, check the source, approve alone and publish: audited, single, nothing left due', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', 'true')
    const id = await pastedRequest('alone')
    expect((await reviewOwn(id, true)).recorded).toBeGreaterThan(0)
    expect((await service.getPlatformChangeRequest(owner, id)).sourcesUnchecked).toBe(false)
    // Approving alone stays explicit: the author's plain approve is refused, the override is not.
    await expect(service.decidePlatformChangeRequest(owner, id, { decision: 'approve', role: 'domain_expert' })).rejects.toThrow(/four eyes/)
    await expect(service.decidePlatformChangeRequest(owner, id, alone)).resolves.toEqual({
      status: 'approved',
      awaiting: [],
      approval: 'single',
      secondReview: null,
      secondReviewDue: [],
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platform.knowledge.change_request_approved_alone', metadata: expect.objectContaining({ reason: REASON }) }),
    )
    const view = await service.getPlatformChangeRequest(owner, id)
    expect(view).toMatchObject({ approval: 'single', secondReview: null, secondReviewRoles: [] })
    expect((await service.platformKnowledgeOverview(owner)).queue.some((request) => request.id === id)).toBe(false)
    await service.publishPlatformChangeRequest(owner, id, { channel: 'preview' })
    await service.publishPlatformChangeRequest(owner, id, { channel: 'stable' })
    expect((await service.getPlatformChangeRequest(owner, id)).status).toBe('published')
  })
})
