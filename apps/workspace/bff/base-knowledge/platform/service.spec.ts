/**
 * @vitest-environment node
 *
 * The platform's decisions at the service, where the routes and the door both
 * arrive (ADR-0165). Each decision that moves what offices read runs only on
 * the person's own yes: under an acting session that carries none, or carries
 * the unverified `app-unverified`, it answers 403 before anything is written,
 * and the elicited yes passes (the positive control). The acting session is
 * the real one the dispatcher binds; storage, WorkOS and the audit trail are
 * stand-ins, since what is tested is the guard in front of them.
 *
 * Also: a verdict records how it was given, and an approval's role is one the
 * approver holds.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const held = { permissions: new Set<string>() }
vi.mock('@/lib/authz/platform', () => ({
  getPlatformOrganizationId: async () => 'org_platform',
  requirePlatformPermission: async (_session: unknown, permission: string) => {
    if (!held.permissions.has(permission)) {
      throw Object.assign(new Error(`Platform permission required: ${permission}`), { status: 403 })
    }
  },
}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn(async () => undefined) }))

const writes = vi.hoisted(() => ({
  approval: vi.fn(async (..._args: unknown[]) => undefined),
  verdicts: vi.fn(async (..._args: unknown[]) => undefined),
  status: vi.fn(async (..._args: unknown[]) => undefined),
  publish: vi.fn(async (..._args: unknown[]) => ({ moved: 1, indexRuns: [] })),
  rollback: vi.fn(async (..._args: unknown[]) => ({ restored: 1, unreleasedFiles: [] as string[] })),
  entitle: vi.fn(async (..._args: unknown[]) => true),
  home: vi.fn(async (..._args: unknown[]) => 'DE'),
}))

const REVISION = 'e0000000-0000-4000-8000-000000000001'
vi.mock('./store', () => ({
  platformTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn({}),
  lockChangeRequest: async (_tx: unknown, id: string) => ({ id, status: 'submitted', countryId: 'AT' }),
  findChangeRequest: async (id: string) => ({ id, status: 'approved' }),
  reviewedRevisions: async () => [
    { revisionId: REVISION, recordId: 'work:x', createdBy: 'user_author', claims: [{ path: 'title', decision: 'accepted' }] },
  ],
  insertApproval: writes.approval,
  insertReviewDecisions: writes.verdicts,
  setChangeRequestStatus: writes.status,
}))
vi.mock('./release', () => ({ publishChangeRequest: writes.publish, rollbackChangeRequest: writes.rollback }))
vi.mock('./entitlements', () => ({
  setEntitlement: writes.entitle,
  moveHomeCountry: writes.home,
  readOrganizationCountries: vi.fn(),
}))
const { enqueueDeindex } = vi.hoisted(() => ({ enqueueDeindex: vi.fn(async () => 0) }))
vi.mock('./indexing', () => ({ enqueueIndexRuns: async () => ({ enqueued: 0, failed: 0 }), enqueueDeindex, readIndexStatus: vi.fn() }))
vi.mock('./overview', () => ({ readOverview: vi.fn() }))

import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { runAsActingSession, type ActingDecisionSource } from '@/lib/agent-api/acting-session'
import { PersonDecisionRequiredError } from '@/lib/agent-api/person-decision'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import * as service from './service'

const EXPERT = { userId: 'user_expert', email: 'expert@example.com', organizationId: 'org_platform' } as unknown as UserSession
const REQUEST = 'c0000000-0000-4000-8000-000000000001'

/** Every decision that runs only on the person's yes, as the route calls it. */
const DECISIONS: [string, () => Promise<unknown>][] = [
  ['approve', () => service.decidePlatformChangeRequest(EXPERT, REQUEST, { decision: 'approve', role: 'domain_expert' })],
  ['reject', () => service.decidePlatformChangeRequest(EXPERT, REQUEST, { decision: 'reject', role: 'domain_expert' })],
  ['publish', () => service.publishPlatformChangeRequest(EXPERT, REQUEST, { channel: 'stable' })],
  ['rollback', () => service.rollbackPlatformChangeRequest(EXPERT, REQUEST, 'wrong title')],
  ['entitle', () => service.entitleOrganizationCountry(EXPERT, 'org_office', { countryId: 'AT', entitled: true })],
  ['home-country-set', () => service.setOrganizationHomeCountry(EXPERT, 'org_office', 'DE')],
]

const asAgent = <T,>(fn: () => Promise<T>, decisionSource?: ActingDecisionSource) =>
  runAsActingSession(EXPERT as unknown as AuthorizedSession, fn, 'agent', decisionSource ? { decisionSource } : {})

const anyWrite = () => Object.values(writes).some((write) => write.mock.calls.length > 0)

beforeEach(() => {
  for (const write of Object.values(writes)) write.mockClear()
  held.permissions = new Set([...Object.values(PLATFORM_PERMISSIONS)])
})

describe("the person's yes, at the service", () => {
  for (const [name, call] of DECISIONS) {
    it(`${name}: refuses an agent call without a yes (403) and writes nothing`, async () => {
      const refusal = asAgent(call)
      await expect(refusal).rejects.toBeInstanceOf(PersonDecisionRequiredError)
      await expect(refusal).rejects.toMatchObject({ status: 403 })
      expect(anyWrite()).toBe(false)
    })

    it(`${name}: refuses an unverified MCP Apps yes (403) and writes nothing`, async () => {
      await expect(asAgent(call, 'app-unverified')).rejects.toMatchObject({ status: 403, code: 'PERSON_DECISION_REQUIRED' })
      expect(anyWrite()).toBe(false)
    })

    it(`${name}: runs on the elicited yes (positive control)`, async () => {
      await expect(asAgent(call, 'elicitation')).resolves.toBeDefined()
      expect(anyWrite()).toBe(true)
    })
  }
})

describe('a rollback (ADR-0173)', () => {
  it('de-indexes every text it left unreleased, as the platform organization', async () => {
    writes.rollback.mockResolvedValueOnce({ restored: 2, unreleasedFiles: ['OIB-RL-4-2023.pdf'] })
    await service.rollbackPlatformChangeRequest(EXPERT, REQUEST, 'wrong edition')
    expect(enqueueDeindex).toHaveBeenCalledWith('org_platform', ['OIB-RL-4-2023.pdf'])
  })

  it('enqueues nothing when every text it released is still released', async () => {
    enqueueDeindex.mockClear()
    await service.rollbackPlatformChangeRequest(EXPERT, REQUEST, 'wrong title')
    expect(enqueueDeindex).not.toHaveBeenCalled()
  })
})

describe('a verdict on a claim', () => {
  const review = () =>
    service.reviewPlatformChangeRequest(EXPERT, REQUEST, [{ revisionId: REVISION, claimPath: 'title', decision: 'accepted' }])

  it("records an agent's verdict as the agent's", async () => {
    await asAgent(review)
    expect(writes.verdicts).toHaveBeenCalledWith({}, REQUEST, { by: 'user_expert', decisionSource: 'agent' }, expect.any(Array))
  })

  it("records the person's own verdict as given in the app", async () => {
    await review()
    expect(writes.verdicts).toHaveBeenCalledWith({}, REQUEST, { by: 'user_expert', decisionSource: 'app' }, expect.any(Array))
  })
})

describe("an approval's role", () => {
  it('is refused for a role the approver does not hold', async () => {
    held.permissions.delete(PLATFORM_PERMISSIONS.knowledgeApproveAsCounsel)
    await expect(service.decidePlatformChangeRequest(EXPERT, REQUEST, { decision: 'approve', role: 'counsel' })).rejects.toMatchObject({
      status: 403,
    })
    expect(writes.approval).not.toHaveBeenCalled()
  })

  it('is recorded for a role the approver holds (positive control)', async () => {
    held.permissions = new Set([PLATFORM_PERMISSIONS.settingsManage, PLATFORM_PERMISSIONS.knowledgeApproveAsCounsel])
    await expect(service.decidePlatformChangeRequest(EXPERT, REQUEST, { decision: 'approve', role: 'counsel' })).resolves.toEqual({
      status: 'approved',
    })
    expect(writes.approval).toHaveBeenCalledWith({}, expect.objectContaining({ approver: 'user_expert', role: 'counsel' }))
  })
})
