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
 * publish (also by trigger) and leaves the rollback, or a reject that withdraws
 * the preview, to a person. Every role approved alone owes its own second
 * review, from somebody holding that role; a request rejected before approval
 * owes none.
 */

import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { approvedRequest, publishedRequest } from './testing/lifecycle'

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
const MANAGE = ['platform:settings:view', 'platform:knowledge:write', 'platform:knowledge:review', 'platform:knowledge:approve_as_domain_expert']

const person = (userId: string, permissions: string[]) =>
  ({ userId, email: `${userId}@example.com`, organizationId: fixed.platformOrg, permissions }) as unknown as UserSession

/** A database refusal, by its reason: drizzle puts the server's message in `cause`. */
const refusedWith = (reason: RegExp) => (error: unknown) => {
  const failure = error as { message?: string; cause?: { message?: string } }
  return reason.test(`${failure?.message ?? ''} ${failure?.cause?.message ?? ''}`)
}

describe('the approve-alone suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('approving a platform change request alone (ADR-0176)', () => {
  let service: typeof import('./service')
  let store: typeof import('./store')
  let onboarding: typeof import('./onboarding')
  let release: typeof import('./release')
  let wire: typeof import('./wire')
  let runAsActingSession: typeof import('@/lib/agent-api/acting-session').runAsActingSession
  let PersonDecisionRequiredError: typeof import('@/lib/agent-api/person-decision').PersonDecisionRequiredError
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const AUTHOR = `user_alone_owner_${RUN}`
  const owner = person(AUTHOR, [...MANAGE, 'platform:knowledge:approve_alone'])
  const ownerWithout = person(AUTHOR, MANAGE)
  const expert = person(`user_alone_expert_${RUN}`, MANAGE)
  const counsel = person(`user_alone_counsel_${RUN}`, ['platform:settings:view', 'platform:knowledge:write', 'platform:knowledge:review', 'platform:knowledge:approve_as_counsel'])
  const managerOnly = person(`user_alone_manager_${RUN}`, ['platform:settings:view', 'platform:knowledge:write', 'platform:knowledge:review'])

  /** A submitted request holding one work, written by the owner; `key` names the work when two requests share it. */
  async function submitted(name: string, key = name): Promise<string> {
    const id = await store.insertChangeRequest({ title: name, countryId: 'AT', createdBy: AUTHOR })
    const records = [wire.proposedRecordSchema.parse({ type: 'work', key: `${key}-${RUN}`, kind: 'guideline', title: `Leitfaden ${name}` })]
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

  /** A request the owner approved alone in two roles, as a request needing counsel would be, and so approved. */
  async function approvedAloneTwice(name: string): Promise<string> {
    const id = await submitted(name)
    await store.platformTransaction(async (tx) => {
      for (const role of ['domain_expert', 'counsel'] as const) {
        await store.insertApproval(tx, { changeRequestId: id, approver: AUTHOR, role, decisionSource: 'app', overrideReason: REASON })
      }
      await store.setChangeRequestStatus(tx, id, 'approved', 'decidedAt')
    })
    return id
  }

  const moves = (id: string) =>
    withPlatformAccess('alone spec', () =>
      db.execute<{ channel: string; action: string }>(
        sql`SELECT channel, action FROM knowledge_release_moves WHERE change_request_id = ${id}::uuid ORDER BY seq`,
      ),
    )

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    service = await import('./service')
    store = await import('./store')
    onboarding = await import('./onboarding')
    release = await import('./release')
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
    ).rejects.toSatisfy(refusedWith(/knowledge_approvals_override_reasoned/))
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
      secondReviewDue: ['domain_expert'],
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
    await expect(service.decidePlatformChangeRequest(owner, id, { decision: 'approve', role: 'domain_expert' })).rejects.toThrow(/four eyes/)
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'approve', role: 'domain_expert' })).rejects.toThrow(/not accepted/)
    await acceptAll(id, expert)
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'approve', role: 'domain_expert' })).resolves.toEqual({
      status: 'published',
      awaiting: [],
      approval: 'single',
      secondReview: 'confirmed',
      secondReviewDue: [],
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
    ).rejects.toSatisfy(refusedWith(/moves only from due/))
  })

  it('keeps the author from giving the second review themselves', async () => {
    const id = await submitted('self-review')
    await service.decidePlatformChangeRequest(owner, id, alone)
    await expect(service.decidePlatformChangeRequest(owner, id, { decision: 'reject', role: 'domain_expert' })).rejects.toThrow(/four eyes/)
    await expect(
      withPlatformAccess('alone spec', () =>
        db.execute(sql`UPDATE knowledge_change_requests SET second_review = 'confirmed', second_review_by = ${AUTHOR}, second_review_at = now() WHERE id = ${id}::uuid`),
      ),
    ).rejects.toSatisfy(refusedWith(/second reviewer may not have written/))
  })

  it('voids the review a request owed once it is rejected before approval: off the queue and the list, no badge left due', async () => {
    const id = await submitted('rejected-after-alone')
    // The owner's override left it submitted, as one still waiting for counsel would be.
    await store.platformTransaction((tx) =>
      store.insertApproval(tx, { changeRequestId: id, approver: AUTHOR, role: 'domain_expert', decisionSource: 'app', overrideReason: REASON }),
    )
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'reject', role: 'domain_expert' })).resolves.toMatchObject({
      status: 'rejected',
      secondReview: 'void',
    })
    expect(await service.getPlatformChangeRequest(expert, id)).toMatchObject({ status: 'rejected', secondReview: { state: 'void', by: expert.userId } })
    expect(await queued(id)).toBe(false)
    const due = await service.listPlatformChangeRequests(expert, { secondReview: 'due' })
    expect(due.changeRequests.some((request) => request.id === id)).toBe(false)
    // A void review stays void: nothing moves it back to due.
    await expect(
      withPlatformAccess('alone spec', () =>
        db.execute(sql`UPDATE knowledge_change_requests SET second_review = 'due', second_review_by = NULL, second_review_at = NULL WHERE id = ${id}::uuid`),
      ),
    ).rejects.toSatisfy(refusedWith(/moves only from due/))
  })

  it('lets a request disputed before its stable publish be rejected, which withdraws its preview', async () => {
    const id = await submitted('disputed-in-preview')
    await service.decidePlatformChangeRequest(owner, id, alone)
    await service.publishPlatformChangeRequest(owner, id, { channel: 'preview' })
    await service.decidePlatformChangeRequest(expert, id, { decision: 'reject', role: 'domain_expert' })
    await expect(service.publishPlatformChangeRequest(owner, id, { channel: 'stable' })).rejects.toThrow(/Reject it, which withdraws its preview/)
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'reject', role: 'domain_expert' })).resolves.toMatchObject({
      status: 'rejected',
      secondReview: 'disputed',
    })
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'platform.knowledge.change_request_rejected', metadata: expect.objectContaining({ withdrawn: 1 }) }),
    )
    expect(await moves(id)).toEqual([
      { channel: 'preview', action: 'publish' },
      { channel: 'preview', action: 'rollback' },
    ])
    const overview = await service.platformKnowledgeOverview(expert)
    expect(overview.queue.some((request) => request.id === id)).toBe(false)
  })

  it('refuses in the database a publish of a disputed request, whatever path reaches it', async () => {
    const id = await submitted('disputed-trigger')
    await service.decidePlatformChangeRequest(owner, id, alone)
    await service.decidePlatformChangeRequest(expert, id, { decision: 'reject', role: 'domain_expert' })
    const [revision] = (await service.getPlatformChangeRequest(expert, id)).revisions
    await expect(
      withPlatformAccess('alone spec', () =>
        db.execute(sql`INSERT INTO knowledge_release_moves (record_id, channel, action, to_revision_id, change_request_id, released_by, decision_source)
          VALUES (${revision!.recordId}, 'stable', 'publish', ${revision!.revisionId}::uuid, ${id}::uuid, ${AUTHOR}, 'app')`),
      ),
    ).rejects.toSatisfy(refusedWith(/second review disputed it is not published/))
  })

  it('owes a second review in every role approved alone, each from somebody holding that role', async () => {
    const id = await approvedAloneTwice('two-roles')
    await acceptAll(id, expert)
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'approve', role: 'domain_expert' })).resolves.toMatchObject({
      secondReview: 'due',
      secondReviewDue: ['counsel'],
    })
    expect(await queued(id)).toBe(true)
    // The expert does not hold counsel, so cannot close that role; the database refuses a confirmation while it is owed.
    await expect(service.decidePlatformChangeRequest(expert, id, { decision: 'approve', role: 'counsel' })).rejects.toMatchObject({ status: 403 })
    await expect(
      withPlatformAccess('alone spec', () =>
        db.execute(sql`UPDATE knowledge_change_requests SET second_review = 'confirmed', second_review_by = ${expert.userId}, second_review_at = now() WHERE id = ${id}::uuid`),
      ),
    ).rejects.toSatisfy(refusedWith(/every role approved alone is/))
    await expect(service.decidePlatformChangeRequest(counsel, id, { decision: 'approve', role: 'counsel' })).resolves.toMatchObject({
      secondReview: 'confirmed',
      secondReviewDue: [],
    })
    expect((await service.getPlatformChangeRequest(expert, id)).secondReviewRoles).toEqual([
      { role: 'counsel', state: 'confirmed', by: counsel.userId, at: expect.any(String) },
      { role: 'domain_expert', state: 'confirmed', by: expert.userId, at: expect.any(String) },
    ])
    expect(await queued(id)).toBe(false)
  })

  it('refuses a dispute, and a plain reject, from somebody without the role they name', async () => {
    const id = await submitted('unroled-dispute')
    await expect(service.decidePlatformChangeRequest(managerOnly, id, { decision: 'reject', role: 'domain_expert' })).rejects.toMatchObject({ status: 403 })
    await service.decidePlatformChangeRequest(owner, id, alone)
    await expect(service.decidePlatformChangeRequest(managerOnly, id, { decision: 'reject', role: 'domain_expert' })).rejects.toMatchObject({ status: 403 })
    await expect(service.decidePlatformChangeRequest(counsel, id, { decision: 'reject', role: 'counsel' })).rejects.toThrow(/No second review is due in the counsel role/)
    expect(await service.getPlatformChangeRequest(expert, id)).toMatchObject({ secondReview: { state: 'due' } })
  })

  it('withdraws only its own preview: a record another request previewed since keeps that preview', async () => {
    const disputed = await submitted('shared-preview-a', 'shared-preview')
    await service.decidePlatformChangeRequest(owner, disputed, alone)
    await service.publishPlatformChangeRequest(owner, disputed, { channel: 'preview' })
    // A second request on the same work, approved with four eyes, previews over it.
    const later = await submitted('shared-preview-b', 'shared-preview')
    await acceptAll(later, expert)
    await service.decidePlatformChangeRequest(expert, later, { decision: 'approve', role: 'domain_expert' })
    await service.publishPlatformChangeRequest(owner, later, { channel: 'preview' })
    const [laterRevision] = (await service.getPlatformChangeRequest(expert, later)).revisions
    await service.decidePlatformChangeRequest(expert, disputed, { decision: 'reject', role: 'domain_expert' })
    await expect(service.decidePlatformChangeRequest(expert, disputed, { decision: 'reject', role: 'domain_expert' })).resolves.toMatchObject({
      status: 'rejected',
    })
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ withdrawn: 0 }) }))
    expect(await moves(disputed)).toEqual([{ channel: 'preview', action: 'publish' }])
    const [preview] = await withPlatformAccess('alone spec', () =>
      db.execute<{ to: string }>(
        sql`SELECT to_revision_id AS to FROM knowledge_release_moves WHERE record_id = ${laterRevision!.recordId} AND channel = 'preview' ORDER BY seq DESC LIMIT 1`,
      ),
    )
    expect(preview?.to).toBe(laterRevision!.revisionId)
  })

  it('withdraws a preview that another withdrawn request put back: no rejected revision stays in preview', async () => {
    const first = await submitted('restored-preview-a', 'restored-preview')
    await service.decidePlatformChangeRequest(owner, first, alone)
    await service.publishPlatformChangeRequest(owner, first, { channel: 'preview' })
    const second = await submitted('restored-preview-b', 'restored-preview')
    await service.decidePlatformChangeRequest(owner, second, alone)
    await service.publishPlatformChangeRequest(owner, second, { channel: 'preview' })
    const [firstRevision] = (await service.getPlatformChangeRequest(expert, first)).revisions
    const previewOf = async () => {
      const [row] = await withPlatformAccess('alone spec', () =>
        db.execute<{ to: string | null }>(
          sql`SELECT to_revision_id AS to FROM knowledge_release_moves WHERE record_id = ${firstRevision!.recordId} AND channel = 'preview' ORDER BY seq DESC LIMIT 1`,
        ),
      )
      return row?.to ?? null
    }
    // The second is disputed and rejected: its withdrawal puts the first one's revision back in preview.
    await service.decidePlatformChangeRequest(expert, second, { decision: 'reject', role: 'domain_expert' })
    await service.decidePlatformChangeRequest(expert, second, { decision: 'reject', role: 'domain_expert' })
    expect(await previewOf()).toBe(firstRevision!.revisionId)
    // The first is disputed and rejected too: its revision is withdrawn although another request's move restored it.
    await service.decidePlatformChangeRequest(expert, first, { decision: 'reject', role: 'domain_expert' })
    await service.decidePlatformChangeRequest(expert, first, { decision: 'reject', role: 'domain_expert' })
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ withdrawn: 1 }) }))
    expect(await previewOf()).not.toBe(firstRevision!.revisionId)
  })

  it('needs a domain expert’s approval on every request: an approval in another role alone approves nothing', async () => {
    const id = await submitted('counsel-only')
    await acceptAll(id, expert)
    await expect(service.decidePlatformChangeRequest(counsel, id, { decision: 'approve', role: 'counsel' })).resolves.toMatchObject({
      status: 'submitted',
      awaiting: ['domain_expert'],
    })
    // Nor does any path around the service: the status trigger refuses the move.
    await expect(
      withPlatformAccess('alone spec', () => db.execute(sql`UPDATE knowledge_change_requests SET status = 'approved' WHERE id = ${id}::uuid`)),
    ).rejects.toSatisfy(refusedWith(/every role it needs has approved it/))
  })

  it('moves a request’s status only along its lifecycle, and to approved only with no claim open', async () => {
    const id = await submitted('status-guard')
    const move = (status: string) =>
      withPlatformAccess('alone spec', () => db.execute(sql`UPDATE knowledge_change_requests SET status = ${status} WHERE id = ${id}::uuid`))
    await expect(move('published')).rejects.toSatisfy(refusedWith(/does not move from submitted to published/))
    // A domain expert's approval with a rejected claim and nobody else's verdicts: still not approvable.
    const view = await service.getPlatformChangeRequest(expert, id)
    const [revision] = view.revisions
    await service.reviewPlatformChangeRequest(expert, id, [{ revisionId: revision!.revisionId, claimPath: revision!.claims[0]!.path, decision: 'rejected' }])
    await store.platformTransaction((tx) =>
      store.insertApproval(tx, { changeRequestId: id, approver: expert.userId, role: 'domain_expert', decisionSource: 'app' }),
    )
    await expect(move('approved')).rejects.toSatisfy(refusedWith(/edited, rejected or unreviewed/))
  })

  it('refuses an approval alone while a page the operator pasted is not checked against its source', async () => {
    const id = await store.insertChangeRequest({ title: 'pasted', countryId: 'AT', createdBy: AUTHOR })
    const capture = await onboarding.capturePlatformCitation(owner, id, {
      basis: 'operator_supplied',
      url: 'https://www.example.org/leitfaden',
      text: 'Leitfaden Barrierefreiheit, Ausgabe 2026, des Landes',
    })
    const record = wire.proposedRecordSchema.parse({
      type: 'work',
      key: `pasted-${RUN}`,
      kind: 'guideline',
      title: 'Leitfaden Barrierefreiheit',
      citations: [{ captureId: capture.captureId, quote: 'Leitfaden Barrierefreiheit, Ausgabe 2026' }],
    })
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      await store.insertProposedRecords(tx, request!, [record], { createdBy: AUTHOR, proposedBy: 'person' })
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    // The view says so, so the UI offers no approval alone that could only be refused.
    expect((await service.getPlatformChangeRequest(owner, id)).sourcesUnchecked).toBe(true)
    await expect(service.decidePlatformChangeRequest(owner, id, alone)).rejects.toThrow(/cite a fetched capture/)
    expect(await approvalRows(id)).toHaveLength(0)
  })

  it('reads the source check off the revisions a request releases: a re-proposal that drops a pasted page clears it', async () => {
    const id = await store.insertChangeRequest({ title: 'repaired', countryId: 'AT', createdBy: AUTHOR })
    const capture = await onboarding.capturePlatformCitation(owner, id, {
      basis: 'operator_supplied',
      url: 'https://www.example.org/leitfaden-repariert',
      text: 'Leitfaden Barrierefreiheit, Ausgabe 2027, des Landes',
    })
    const work = (citations: { captureId: string; quote: string }[]) =>
      wire.proposedRecordSchema.parse({ type: 'work', key: `repaired-${RUN}`, kind: 'guideline', title: 'Leitfaden Barrierefreiheit', citations })
    const propose = (records: ReturnType<typeof work>[], submit: boolean) =>
      store.platformTransaction(async (tx) => {
        const request = await store.lockChangeRequest(tx, id)
        await store.insertProposedRecords(tx, request!, records, { createdBy: AUTHOR, proposedBy: 'person' })
        if (submit) await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
      })
    await propose([work([{ captureId: capture.captureId, quote: 'Leitfaden Barrierefreiheit, Ausgabe 2027' }])], false)
    // Resent after a repair, in a later call, without the pasted page: the record's newest revision is what the request releases.
    await propose([work([])], true)
    expect((await service.getPlatformChangeRequest(owner, id)).sourcesUnchecked).toBe(false)
    await expect(service.decidePlatformChangeRequest(owner, id, alone)).resolves.toMatchObject({ status: 'approved' })
  })

  describe('the lifecycle the database holds (migration 0218)', () => {
    const STATUSES = ['draft', 'submitted', 'approved', 'published', 'rejected', 'rolled_back'] as const
    type Status = (typeof STATUSES)[number]
    const LEGAL = new Set(['draft>submitted', 'draft>rejected', 'submitted>approved', 'submitted>rejected', 'approved>published', 'approved>rejected', 'published>rolled_back'])
    const work = (name: string) => [wire.proposedRecordSchema.parse({ type: 'work', key: `${name}-${RUN}`, kind: 'guideline', title: `Leitfaden ${name}` })]
    const actors = { author: AUTHOR, expert: expert.userId }
    const setStatus = (id: string, status: string) =>
      withPlatformAccess('alone spec', () => db.execute(sql`UPDATE knowledge_change_requests SET status = ${status} WHERE id = ${id}::uuid`))

    /** A request in `status`, reached the lawful way. */
    async function requestIn(status: Status): Promise<string> {
      const name = `edge-${status}-${Math.random().toString(36).slice(2, 8)}`
      if (status === 'draft') return store.insertChangeRequest({ title: name, countryId: 'AT', createdBy: AUTHOR })
      if (status === 'submitted') return submitted(name)
      if (status === 'rejected') {
        const id = await store.insertChangeRequest({ title: name, countryId: 'AT', createdBy: AUTHOR })
        await store.platformTransaction((tx) => store.setChangeRequestStatus(tx, id, 'rejected', 'decidedAt'))
        return id
      }
      if (status === 'approved') return approvedRequest({ title: name, countryId: 'AT', records: work(name) }, actors)
      const id = await publishedRequest({ title: name, countryId: 'AT', records: work(name) }, actors)
      if (status === 'rolled_back') await release.rollbackChangeRequest(id, 'spec: an edge', { by: expert.userId, decisionSource: 'app' })
      return id
    }

    it.each(STATUSES)('refuses every illegal move out of %s', async (from) => {
      const id = await requestIn(from)
      for (const to of STATUSES.filter((to) => to !== from && !LEGAL.has(`${from}>${to}`))) {
        await expect(setStatus(id, to), `${from} > ${to}`).rejects.toSatisfy(refusedWith(new RegExp(`does not move from ${from} to ${to}`)))
      }
    })

    it('refuses an approved request’s reject until its second review disputed it', async () => {
      const id = await requestIn('approved')
      await expect(setStatus(id, 'rejected')).rejects.toSatisfy(refusedWith(/only once its second review disputed it/))
    })

    it('refuses an approval while a revision nobody reviewed would be released, unless the domain expert approved alone', async () => {
      const id = await submitted('unreviewed')
      await store.platformTransaction((tx) =>
        store.insertApproval(tx, { changeRequestId: id, approver: expert.userId, role: 'domain_expert', decisionSource: 'app' }),
      )
      await expect(setStatus(id, 'approved')).rejects.toSatisfy(refusedWith(/edited, rejected or unreviewed/))
    })

    it('starts every request as a draft', async () => {
      await expect(
        withPlatformAccess('alone spec', () =>
          db.execute(sql`INSERT INTO knowledge_change_requests (id, title, country_id, created_by, status) VALUES (gen_random_uuid(), 'born published', 'AT', ${AUTHOR}, 'published')`),
        ),
      ).rejects.toSatisfy(refusedWith(/starts as a draft/))
    })
  })
})
