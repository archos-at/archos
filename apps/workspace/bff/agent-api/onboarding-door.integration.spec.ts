// @disk-inputs: tests/fixtures/onboarding/at-9.json
/**
 * @vitest-environment node
 *
 * The agent-grade platform door (ADR-0170), measured the way the brief states
 * it: a scripted client with no model takes the AT-9 (Vienna) case to a green
 * validation using door operations only, and on through review, approval,
 * publish and entitlement with the person's yes. Every call goes through the
 * real MCP door handler (`createAgentDoorHandler`), the real catalog, the real
 * dispatcher and the real route handlers, against a REAL Postgres:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/agent-api/onboarding-door.integration.spec.ts
 *
 * Faked, because they are outside the door: WorkOS (the platform organization
 * and the operator's permissions), the platform's feature flag, the audit trail,
 * server events, and the backend's public-source reader (answered from the
 * case's pages, as `POST /v1/public-sources/capture` answers).
 *
 * Each guard has its positive control beside it: the same call that is refused
 * without the person's yes runs with it; the batch refused with a made-up quote
 * passes with the page's own words; the repeat with the same idempotency key
 * answers the first result and the same key with other input is refused.
 */

import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import { doorScript, platformOperator, platformSession } from './testing/platform-door-script'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_onb_${Date.now().toString(36)}` }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/authz/platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/authz/platform')>()
  return {
    ...real,
    getPlatformOrganizationId: async () => fixed.platformOrg,
    hasPlatformPermission: async (session: { permissions?: string[] } | null, permission: string) =>
      Boolean(session?.permissions?.includes(permission)),
    requirePlatformPermission: async (session: { permissions?: string[] } | null, permission: string) => {
      if (!session?.permissions?.includes(permission)) throw new real.PlatformAccessDeniedError(`Platform permission required: ${permission}`)
    },
  }
})
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/audit/after-commit', () => ({ recordAuditEventAfterCommit: vi.fn() }))
vi.mock('./telemetry', () => ({ recordOperationCalled: vi.fn(), recordOperationMissing: vi.fn() }))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const BACKEND = 'http://localhost:8000'

interface CasePage {
  basis: 'fetched' | 'operator_supplied'
  sourceId?: string
  url: string
  html?: string
  text: string
  note?: string
}
type CaseCitation = { capture?: string; quote?: string; url?: string }
type CaseRecord = Record<string, unknown> & { key: string; citations: CaseCitation[] }
interface AtNine {
  countryId: string
  title: string
  pages: Record<string, CasePage>
  territories: { capture: string; rows: { code: string; name: string }[] }
  draft: CaseRecord[]
  repairs: Record<string, CaseCitation[]>
  expectedDraftProblems: { key: string; code: string; pointer: string }[]
}

const CASE = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/onboarding/at-9.json'), 'utf8')) as AtNine

describe('the onboarding door suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('an operator’s agent onboards AT-9 through the platform door, with no model', () => {
  type Principal = import('./principal').AgentPrincipal
  let handler: ReturnType<typeof import('./mcp-server').createAgentDoorHandler>
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  const OFFICE = `org_onb_office_${RUN}`

  const session = (userId: string, permissions: string[]): AuthorizedSession => platformSession(fixed.platformOrg, userId, permissions)
  const operator = (who: AuthorizedSession): Principal => platformOperator(who)
  const APPROVER = 'platform:knowledge:approve_as_domain_expert'
  const author = operator(session(`user_onb_author_${RUN}`, ['platform:settings:view', 'platform:settings:manage', APPROVER]))
  const expert = operator(
    session(`user_onb_expert_${RUN}`, ['platform:settings:view', 'platform:settings:manage', 'platform:organizations:manage', APPROVER]),
  )

  const key = (name: string) => `${name}-${RUN}`
  const captureIds = new Map<string, string>()
  const { rpc, door, ok } = doorScript(() => handler)

  const records = (raw: readonly CaseRecord[]) =>
    raw.map(({ key: recordKey, citations, ...rest }) => {
      const record: Record<string, unknown> = { ...rest, key: key(recordKey), citations: citations.map(cite) }
      for (const field of ['workKey', 'editionKey'] as const) if (typeof rest[field] === 'string') record[field] = key(rest[field])
      return record
    })
  const cite = ({ capture, ...citation }: CaseCitation) => (capture ? { captureId: captureIds.get(capture), ...citation } : citation)

  /** The backend's public-source reader, answering from the case's pages as the api tier would. */
  function stubPublicSourceReader() {
    vi.stubGlobal('fetch', async (target: string | URL | Request, init?: RequestInit) => {
      const address = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url
      if (address !== `${BACKEND}/v1/public-sources/capture`) throw new Error(`no network in this spec: ${address}`)
      const asked = JSON.parse(String(init?.body)) as { source: string; url: string }
      const page = Object.values(CASE.pages).find((candidate) => candidate.basis === 'fetched' && candidate.url === asked.url)
      if (!asked.url.startsWith('https://www.ris.bka.gv.at/')) {
        return Response.json({ detail: `${asked.url} is not an https URL on a host of source ${asked.source}` }, { status: 403 })
      }
      if (!page?.html) return Response.json({ detail: 'the source answered HTTP 404' }, { status: 502 })
      return Response.json({
        url: asked.url,
        finalUrl: asked.url,
        contentType: 'text/html; charset=utf-8',
        sha256: createHash('sha256').update(page.html).digest('hex'),
        bytes: Buffer.byteLength(page.html),
        text: page.text,
        retrievedAt: new Date().toISOString(),
      })
    })
  }

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    process.env.APP_DATABASE_URL = url
    vi.stubEnv('INTERNAL_API_TOKEN', 'a-real-internal-token-for-the-onboarding-spec')
    vi.stubEnv('BACKEND_URL', BACKEND)
    db = (await import('@/lib/db')).getDb()
    withPlatformAccess = (await import('@/lib/db/tenant-context')).withPlatformAccess
    handler = (await import('./mcp-server')).createAgentDoorHandler(() => undefined)
    stubPublicSourceReader()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const count = async (query: ReturnType<typeof sql>) =>
    withPlatformAccess('onboarding spec count', async () => Number((await db.execute<{ n: number }>(query))[0]?.n ?? 0))

  let requestId = ''

  it('finds the guide and the shapes on the platform door, and nothing of an office there', async () => {
    const listed = await rpc(author, 'resources/list', {})
    const uris = ((listed.result?.resources ?? []) as { uri: string }[]).map((resource) => resource.uri)
    const { ONBOARDING_GUIDE_URI } = await import('./door/platform-guide')
    expect(uris).toEqual([ONBOARDING_GUIDE_URI])
    const guide = await rpc(author, 'resources/read', { uri: ONBOARDING_GUIDE_URI })
    const text = ((guide.result?.contents ?? []) as { text: string }[])[0]?.text ?? ''
    expect(text).toContain('platform-knowledge-citation-capture')
    expect(text).toContain('idempotencyKey')

    const shapes = await ok(author, 'platform-knowledge-schema-get', {})
    expect(Object.keys(shapes.recordTypes as object).sort()).toEqual(['authority', 'edition', 'manifestation', 'relation', 'ruleset', 'source', 'territory', 'work'])
    expect(shapes.maxBatch).toBe(200)
    expect((shapes.checks as { code: string }[]).map((check) => check.code)).toEqual(['KC-1', 'KC-3', 'KC-5', 'KC-6', 'KC-7'])

    // Fail closed on an unknown record type, as an RFC 9457 problem.
    const unknownType = await door(author, 'platform-knowledge-schema-get', { query: { type: 'office_copy' } })
    expect(unknownType.ok).toBe(false)
    expect(unknownType.problem?.status).toBe(400)

    // The door split (ADR-0160): an office's workspace is on no operation this door lists.
    const listing = await door(author, 'project-list', {})
    expect(listing.ok).toBe(false)
  })

  it('opens one change request however often the script retries it with the same key, and refuses the key for other input', async () => {
    const before = await count(sql`SELECT count(*)::int AS n FROM knowledge_change_requests WHERE created_by = ${author.session.userId}`)
    const input = { idempotencyKey: `create-${RUN}`, body: { title: CASE.title, countryId: CASE.countryId } }
    const first = await ok(author, 'platform-knowledge-change-request-create', input)
    const again = await ok(author, 'platform-knowledge-change-request-create', input)
    requestId = String(first.id)
    expect(again.id).toBe(requestId)
    expect(await count(sql`SELECT count(*)::int AS n FROM knowledge_change_requests WHERE created_by = ${author.session.userId}`)).toBe(before + 1)

    const reused = await door(author, 'platform-knowledge-change-request-create', { ...input, body: { title: 'another', countryId: 'AT' } })
    expect(reused.problem).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('captures the pages: fetched through the source reader, or supplied by the operator, and refuses a host off the source', async () => {
    for (const [name, page] of Object.entries(CASE.pages)) {
      const body =
        page.basis === 'fetched'
          ? { basis: 'fetched', sourceId: page.sourceId, url: page.url }
          : { basis: 'operator_supplied', url: page.url, text: page.text, note: page.note }
      const captured = await ok(author, 'platform-knowledge-citation-capture', { idempotencyKey: `capture-${name}-${RUN}`, params: { changeRequestId: requestId }, body })
      expect(captured).toMatchObject({ basis: page.basis, url: page.url })
      expect(captured.sha256).toMatch(/^[0-9a-f]{64}$/)
      captureIds.set(name, String(captured.captureId))
    }
    expect((await ok(author, 'platform-knowledge-citation-capture', { params: { changeRequestId: requestId }, body: { basis: 'fetched', sourceId: 'at-ris', url: CASE.pages['ris-bo']!.url } })).sha256).toBe(
      createHash('sha256').update(CASE.pages['ris-bo']!.html!).digest('hex'),
    )

    const offHost = await door(author, 'platform-knowledge-citation-capture', {
      params: { changeRequestId: requestId },
      body: { basis: 'fetched', sourceId: 'at-ris', url: 'https://example.org/made-up-statute.html' },
    })
    expect(
      await count(sql`SELECT count(*)::int AS n FROM knowledge_citation_captures WHERE change_request_id = ${requestId} AND created_by = ${author.session.userId} AND via_client = 'client_claude' AND retrieved_at IS NOT NULL`),
    ).toBe(Object.keys(CASE.pages).length + 1)
    expect(offHost.problem).toMatchObject({ status: 422 })
    expect(offHost.problem?.detail).toContain('not an https URL on a host of source at-ris')
  })

  it('imports the territories, a dry run first, each name checked against the capture of the list', async () => {
    const rows = CASE.territories.rows
    const captureId = captureIds.get(CASE.territories.capture)
    const dry = await ok(author, 'platform-territory-import', { params: { changeRequestId: requestId }, body: { format: 'iso3166', captureId, rows, dryRun: true } })
    expect(dry).toMatchObject({ dryRun: true, valid: true })

    // Positive control for KC-6 on the import: a name the list does not hold.
    const madeUp = await ok(author, 'platform-territory-import', {
      params: { changeRequestId: requestId },
      body: { format: 'iso3166', captureId, rows: [{ code: 'AT-9', name: 'Wienerland' }], dryRun: true },
    })
    expect(madeUp.valid).toBe(false)

    const imported = await ok(author, 'platform-territory-import', { idempotencyKey: `territories-${RUN}`, params: { changeRequestId: requestId }, body: { format: 'iso3166', captureId, rows } })
    expect((imported.results as { status: string }[]).map((result) => result.status)).toEqual(['written', 'written'])
  })

  it('names every mistake of the draft by record, check and JSON Pointer, and writes nothing of a refused batch', async () => {
    const draft = records(CASE.draft)
    const dry = await ok(author, 'platform-knowledge-records-propose', { params: { changeRequestId: requestId }, body: { dryRun: true, records: draft } })
    expect(dry.valid).toBe(false)
    const found = (dry.results as { key: string; problems: { code: string; pointer: string; hint: string }[] }[]).flatMap((result) =>
      result.problems.map((problem) => ({ key: result.key, code: problem.code, pointer: problem.pointer })),
    )
    expect(found).toEqual(CASE.expectedDraftProblems.map((problem) => ({ ...problem, key: key(problem.key) })))

    const refused = await door(author, 'platform-knowledge-records-propose', { params: { changeRequestId: requestId }, body: { records: draft } })
    expect(refused.problem).toMatchObject({ status: 422, code: 'UNPROCESSABLE', type: 'urn:problem-type:base-knowledge:unprocessable' })
    expect(JSON.stringify(refused.problem?.details)).toContain('KC-6')
    expect(await count(sql`SELECT count(*)::int AS n FROM knowledge_revisions WHERE change_request_id = ${requestId} AND record_type <> 'territory'`)).toBe(0)

    const validation = await ok(author, 'platform-knowledge-validate', { params: { changeRequestId: requestId } })
    expect(validation).toMatchObject({ valid: true, records: 2 })
  })

  it('takes the repaired batch, changes nothing when it is sent again, and validates green', async () => {
    const repaired = records(CASE.draft.map((record) => (CASE.repairs[record.key] ? { ...record, citations: CASE.repairs[record.key]! } : record)))
    const body = { records: repaired }
    const written = await ok(author, 'platform-knowledge-records-propose', { idempotencyKey: `propose-${RUN}`, params: { changeRequestId: requestId }, body })
    expect((written.results as { status: string }[]).every((result) => result.status === 'written')).toBe(true)

    // A retry after a timeout, with a fresh key: the proposal itself is idempotent.
    const resent = await ok(author, 'platform-knowledge-records-propose', { idempotencyKey: `propose-again-${RUN}`, params: { changeRequestId: requestId }, body })
    expect((resent.results as { status: string }[]).map((result) => result.status)).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged'])

    const validation = await ok(author, 'platform-knowledge-validate', { params: { changeRequestId: requestId } })
    expect(validation).toMatchObject({ valid: true, records: 6, problems: [] })

    const revisions = await withPlatformAccess('onboarding spec attribution', async () =>
      db.execute<{ via: string | null; by: string }>(
        sql`SELECT provenance->>'viaClient' AS via, created_by AS by FROM knowledge_revisions WHERE change_request_id = ${requestId}`,
      ),
    )
    expect(new Set(revisions.map((row) => `${row.by}|${row.via}`))).toEqual(new Set([`${author.session.userId}|client_claude`]))

    await ok(author, 'platform-knowledge-change-request-submit', { idempotencyKey: `submit-${RUN}`, params: { changeRequestId: requestId } })
  })

  it('approves only on the person’s yes, never the author’s, and only once the operator-supplied sources were checked', async () => {
    const view = await ok(expert, 'platform-knowledge-change-request-get', { params: { changeRequestId: requestId } })
    const revisions = view.revisions as { revisionId: string; claims: { path: string }[]; citations: { captureId?: string }[] }[]
    const supplied = new Set([captureIds.get('iso-at'), captureIds.get('ma37')])
    const verdicts = (sourceChecked: boolean) =>
      revisions.flatMap((revision) =>
        revision.claims.map((claim) => ({
          revisionId: revision.revisionId,
          claimPath: claim.path,
          decision: 'accepted',
          sourceChecked: sourceChecked && revision.citations.some((citation) => supplied.has(citation.captureId)),
        })),
      )
    await ok(expert, 'platform-knowledge-change-request-review', { params: { changeRequestId: requestId }, body: { decisions: verdicts(false) } }, { person: 'yes' })
    const approve = { params: { changeRequestId: requestId }, body: { decision: 'approve', role: 'domain_expert' } }

    // The author's yes is no approval: four eyes.
    const own = await door(author, 'platform-knowledge-change-request-decide', approve, { person: 'yes' })
    expect(own.problem).toMatchObject({ status: 409 })

    // A client that cannot ask the person is told where they decide it, and nothing changes.
    const cannotAsk = await door(expert, 'platform-knowledge-change-request-decide', approve, { elicits: false })
    expect(cannotAsk.ok).toBe(false)
    expect(cannotAsk.body).toMatchObject({ decision: 'person_required', changed: false })

    // The person says no: nothing changes.
    const declined = await door(expert, 'platform-knowledge-change-request-decide', approve, { person: 'no' })
    expect(declined.body).toMatchObject({ decision: 'declined', changed: false })

    // The person says yes, but nobody checked the pages nobody fetched: refused by the database.
    const unchecked = await door(expert, 'platform-knowledge-change-request-decide', approve, { person: 'yes' })
    expect(unchecked.problem).toMatchObject({ status: 409 })
    expect(unchecked.problem?.detail).toContain('operator-supplied')

    // Nobody checks their own source: the author's agent, even with the author's yes, is refused.
    const review = { params: { changeRequestId: requestId }, body: { decisions: verdicts(true) } }
    const ownCheck = await door(author, 'platform-knowledge-change-request-review', review, { person: 'yes' })
    expect(ownCheck.problem).toMatchObject({ status: 409 })
    // And a source check dispatched with no yes at all is refused at the route.
    const { callOperation } = await import('./dispatch')
    const { findOperation } = await import('./catalog')
    const bare = await callOperation(findOperation('platform-knowledge-change-request-review')!, review, expert.session, 'agent', {})
    expect(bare).toMatchObject({ status: 403, body: { code: 'PERSON_DECISION_REQUIRED' } })
    expect(
      await count(sql`SELECT count(*)::int AS n FROM knowledge_review_decisions WHERE change_request_id = ${requestId} AND source_checked`),
    ).toBe(0)

    await ok(expert, 'platform-knowledge-change-request-review', review, { person: 'yes' })
    const approved = await ok(expert, 'platform-knowledge-change-request-decide', approve, { person: 'yes' })
    expect(approved.status).toBe('approved')
    expect(await count(sql`SELECT count(*)::int AS n FROM knowledge_approvals WHERE change_request_id = ${requestId} AND decision_source = 'elicitation'`)).toBe(1)
  })

  it('holds the person’s yes at the route itself: the same publish dispatched with no yes is refused (the revert check)', async () => {
    const { callOperation } = await import('./dispatch')
    const { findOperation } = await import('./catalog')
    const publish = findOperation('platform-knowledge-publish')!
    const bare = await callOperation(publish, { params: { changeRequestId: requestId }, body: { channel: 'preview' } }, expert.session, 'agent', {})
    expect(bare).toMatchObject({ status: 403, ok: false, body: { code: 'PERSON_DECISION_REQUIRED' } })
    expect(await count(sql`SELECT count(*)::int AS n FROM knowledge_release_moves WHERE change_request_id = ${requestId}`)).toBe(0)
  })

  it('publishes to preview, then stable, and entitles an office, each on the person’s yes', async () => {
    await ok(expert, 'platform-knowledge-publish', { idempotencyKey: `preview-${RUN}`, params: { changeRequestId: requestId }, body: { channel: 'preview' } }, { person: 'yes' })
    const stable = await ok(expert, 'platform-knowledge-publish', { idempotencyKey: `stable-${RUN}`, params: { changeRequestId: requestId }, body: { channel: 'stable' } }, { person: 'yes' })
    expect(stable.moved).toBe(6)
    const head = await withPlatformAccess('onboarding spec head', async () =>
      db.execute<{ head: string | null }>(sql`SELECT head_revision_id AS head FROM knowledge_records WHERE id = ${`authority:${key('at-wien-ma37')}`}`),
    )
    expect(head[0]?.head).toBeTruthy()

    const entitle = { params: { organizationId: OFFICE }, body: { countryId: 'AT', entitled: true } }
    const notAsked = await door(expert, 'platform-org-country-entitle', entitle, { person: 'no' })
    expect(notAsked.body).toMatchObject({ decision: 'declined', changed: false })
    expect(await count(sql`SELECT count(*)::int AS n FROM organization_countries WHERE organization_id = ${OFFICE}`)).toBe(0)
    await ok(expert, 'platform-org-country-entitle', entitle, { person: 'yes' })
    expect(await count(sql`SELECT count(*)::int AS n FROM organization_countries WHERE organization_id = ${OFFICE} AND decision_source = 'elicitation'`)).toBe(1)
  })

  it('puts a platform skill’s publish behind the person’s yes as well', async () => {
    const created = await door(expert, 'platform-skill-create', {
      body: { name: `onboarding-check-${RUN}`, description: 'A skill the spec drafts.', body: 'Do the thing.', published: true },
    })
    expect(created.problem).toMatchObject({ status: 403, code: 'PERSON_DECISION_REQUIRED' })
    const update = await door(expert, 'platform-skill-update', { params: { skillId: 'any' }, body: { published: true } }, { elicits: false })
    expect(update.body).toMatchObject({ decision: 'person_required', changed: false })

    // The routes hold it whatever path the call took: an edit or a delete dispatched with no yes is refused.
    const { callOperation } = await import('./dispatch')
    const { findOperation } = await import('./catalog')
    for (const [name, input] of [
      ['platform-skill-update', { params: { skillId: 'any' }, body: { published: true } }],
      ['platform-skill-delete', { params: { skillId: 'any' } }],
    ] as const) {
      const bare = await callOperation(findOperation(name)!, input, expert.session, 'agent', {})
      expect(bare, name).toMatchObject({ status: 403, body: { code: 'PERSON_DECISION_REQUIRED' } })
    }
  })
})
