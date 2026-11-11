/**
 * @vitest-environment node
 *
 * Accepting every open claim of a change request in one decision, against a
 * REAL Postgres, through the service the route and the door both call:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/platform/accept-all.integration.spec.ts
 *
 * A request the size of a country (about 3,000 claims) is accepted in one call
 * and one audit event; a claim that already has a verdict keeps it; the author
 * is refused on prod settings (the four-eyes trigger) and let through on dev's
 * one operator alone; `sourceChecked` is written only as the person gave it, and
 * an agent's call without the person's yes writes nothing.
 */

import { sql } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_accept_${Date.now().toString(36)}` }))
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

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const PERMISSIONS = ['platform:settings:view', 'platform:knowledge:write', 'platform:knowledge:review']
/** Works of seven claims each: 430 make a country's 3,010. */
const CLAIMS_PER_WORK = 7
const LARGE = 430

describe('the accept-all suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('accepting every open claim of a change request in one decision', () => {
  let service: typeof import('./service')
  let store: typeof import('./store')
  let wire: typeof import('./wire')
  let acting: typeof import('@/lib/agent-api/acting-session')

  const session = (userId: string) => ({ userId, email: `${userId}@example.com`, organizationId: fixed.platformOrg, permissions: PERMISSIONS }) as unknown as UserSession
  const AUTHOR = `user_accept_author_${RUN}`
  const author = session(AUTHOR)
  const expert = session(`user_accept_expert_${RUN}`)

  /** A submitted request of `works` works, each with seven claims, written by AUTHOR. */
  async function submittedRequest(name: string, works: number): Promise<string> {
    const id = await store.insertChangeRequest({ title: name, countryId: 'AT', createdBy: AUTHOR })
    const records = Array.from({ length: works }, (_, index) =>
      wire.proposedRecordSchema.parse({
        type: 'work',
        key: `accept-${name}-${index}-${RUN}`,
        kind: 'guideline',
        title: `Leitfaden ${name} ${index}`,
        designation: `LF ${index}`,
        issuer: 'Land',
      }),
    )
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      for (let start = 0; start < records.length; start += 200) {
        await store.insertProposedRecords(tx, request!, records.slice(start, start + 200), { createdBy: AUTHOR, proposedBy: 'person' })
      }
      await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
    })
    return id
  }

  const verdictRows = (id: string) =>
    store.platformTransaction((tx) =>
      tx.execute<{ claim_path: string; decision: string; source_checked: boolean; reviewer: string }>(
        sql`SELECT claim_path, decision, source_checked, reviewer FROM knowledge_review_decisions WHERE change_request_id = ${id}::uuid`,
      ),
    )

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    service = await import('./service')
    store = await import('./store')
    wire = await import('./wire')
    acting = await import('@/lib/agent-api/acting-session')
  })

  beforeEach(() => audit.record.mockClear())
  afterEach(() => vi.unstubAllEnvs())

  it('accepts every open claim of a 3,000-claim request in one call, with one audit event of the counts', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', '')
    const id = await submittedRequest('large', LARGE)
    const claims = (await service.getPlatformChangeRequest(expert, id)).revisions.flatMap((revision) => revision.claims)
    expect(claims.length).toBeGreaterThanOrEqual(3000)

    const started = performance.now()
    const receipt = await service.acceptAllPlatformChangeRequest(expert, id, { sourceChecked: true })
    const elapsed = performance.now() - started
    console.debug(`accept-all: ${receipt.accepted} claims on ${receipt.records} records in ${Math.round(elapsed)} ms`)

    expect(receipt).toEqual({ accepted: claims.length, records: LARGE, alreadyDecided: 0, sourceChecked: true })
    expect(elapsed).toBeLessThan(30_000)
    const after = (await service.getPlatformChangeRequest(expert, id)).revisions.flatMap((revision) => revision.claims)
    expect(after.every((claim) => claim.decision === 'accepted')).toBe(true)
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.knowledge.claims_accepted',
        targetId: id,
        metadata: { accepted: claims.length, records: LARGE, alreadyDecided: 0, sourceChecked: true, decisionSource: 'app' },
      }),
    )
  })

  it('leaves a claim that already has a verdict as it is: accepted, edited or rejected', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', '')
    const id = await submittedRequest('kept', 2)
    const [first, second] = (await service.getPlatformChangeRequest(expert, id)).revisions
    await service.reviewPlatformChangeRequest(expert, id, [
      { revisionId: first!.revisionId, claimPath: 'title', decision: 'rejected', note: 'Wrong title' },
      { revisionId: first!.revisionId, claimPath: 'issuer', decision: 'edited' },
      { revisionId: second!.revisionId, claimPath: 'title', decision: 'accepted' },
    ])
    const receipt = await service.acceptAllPlatformChangeRequest(expert, id, { sourceChecked: false })
    expect(receipt).toMatchObject({ accepted: 2 * CLAIMS_PER_WORK - 3, records: 2, alreadyDecided: 3 })

    const decided = new Map(
      (await service.getPlatformChangeRequest(expert, id)).revisions.flatMap((revision) =>
        revision.claims.map((claim) => [`${revision.revisionId}|${claim.path}`, claim.decision]),
      ),
    )
    expect(decided.get(`${first!.revisionId}|title`)).toBe('rejected')
    expect(decided.get(`${first!.revisionId}|issuer`)).toBe('edited')
    // One verdict per claim: nothing was written over the three given before.
    expect(await verdictRows(id)).toHaveLength(2 * CLAIMS_PER_WORK)
  })

  it('refuses the author on prod settings (four eyes) and writes nothing', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', '')
    const id = await submittedRequest('own', 2)
    await expect(service.acceptAllPlatformChangeRequest(author, id, { sourceChecked: true })).rejects.toThrow(/four eyes/)
    expect(await verdictRows(id)).toHaveLength(0)
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('lets the author accept their own request on dev’s one operator alone (#1633)', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', 'true')
    const id = await submittedRequest('alone', 2)
    await expect(service.acceptAllPlatformChangeRequest(author, id, { sourceChecked: true })).resolves.toMatchObject({ accepted: 2 * CLAIMS_PER_WORK })
  })

  it('writes `sourceChecked` only as the person gave it, and nothing on an agent’s call without their yes', async () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', '')
    const id = await submittedRequest('source', 1)
    const asAgent = acting.runAsActingSession(
      expert as unknown as AuthorizedSession,
      () => service.acceptAllPlatformChangeRequest(expert, id, { sourceChecked: true }),
      'agent',
    )
    await expect(asAgent).rejects.toMatchObject({ status: 403, code: 'PERSON_DECISION_REQUIRED' })
    expect(await verdictRows(id)).toHaveLength(0)

    await service.acceptAllPlatformChangeRequest(expert, id, { sourceChecked: false })
    const rows = await verdictRows(id)
    expect(rows).toHaveLength(CLAIMS_PER_WORK)
    expect(rows.every((row) => row.source_checked === false && row.decision === 'accepted')).toBe(true)
  })
})
