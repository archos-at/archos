/**
 * @vitest-environment node
 *
 * The country onboarding tooling (ADR-0174), measured the way the brief states
 * it: a scripted client with no model onboards a SYNTHETIC country (`XA`,
 * Xanadu: a fixture territory, one configured source, one advice policy) to a
 * green validation using door operations only, takes it through review,
 * counsel's approval and publish on the person's yes, and a monitor opens a
 * change request when the source changes. Every call goes through the real MCP
 * door handler, catalog, dispatcher and route handlers, against a REAL Postgres:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/agent-api/synthetic-country-door.integration.spec.ts
 *
 * Faked, because they are outside the door: WorkOS (the platform organization,
 * the operator's permissions, the flags), the audit trail, the secret store's
 * key (a local AES key), and the api tier's public-source routes (capture,
 * check, probe), answered as `packages/public-sources` answers them; their own
 * tests are in that package and `apps/agent-host/tests`.
 *
 * Each guard has its positive control beside it: the source refused by KC-7
 * passes repaired; the host refused to another request is usable by its own;
 * the request one approval does not approve is approved by counsel's; the key
 * refused without the person's yes is set with it and never read back; the
 * monitor that opens one request for a change does not open a second.
 */

import { createHash, randomBytes, webcrypto } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import { doorScript, platformOperator, platformSession } from './testing/platform-door-script'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_xa_${Date.now().toString(36)}`, flagsOff: new Set<string>() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async (slug: string) => !fixed.flagsOff.has(slug) }))
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

/** The synthetic country. Its source key is per run, so a rerun on the same database starts clean. */
const COUNTRY = 'XA'
const SOURCE = `xa-gazette-${RUN}`
const HOST = 'gazette.xa.example'
const CODE_URL = `https://${HOST}/building-code`
const TERMS_URL = `https://${HOST}/terms`
const PAGE_V1 = 'Building Code of Xanadu\n§ 1 Scope\nThis code applies to every building in Xanadu.'
const PAGE_V2 = `${PAGE_V1}\n§ 2 Heights\nNo building in Xanadu is higher than the palace.`
const TERMS = 'Terms of use of the Gazette of Xanadu: the gazette is published under an open licence.'
const ISO_LIST = 'XA Republic of Xanadu (a user-assigned code, for testing)'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

/** The source record as an operator's agent proposes it. */
const sourceRecord = (captureId: string, overrides: Record<string, unknown> = {}) => ({
  type: 'source',
  key: SOURCE,
  title: 'Gazette of Xanadu',
  territoryId: COUNTRY,
  protocol: 'web_document',
  format: 'html_statute',
  hosts: [HOST],
  dataFlow: 'public_only',
  terms: { url: TERMS_URL, licence: 'public_open', checked: '2026-11-01' },
  monitor: { kind: 'sha256', intervalHours: 24, probe: { operation: 'document', args: { id: 'code' } } },
  access: { documents: [{ id: 'code', url: CODE_URL, title: 'Building Code' }] },
  credential: { header: 'X-Api-Key' },
  engine: { unit: '//section', number: "./span[@class='nr']", heading: './h2', title: '//h1' },
  fixtures: [
    {
      name: 'code',
      operation: 'document',
      args: { id: 'code' },
      responses: { [CODE_URL]: { contentType: 'text/html; charset=utf-8', body: '<h1>Building Code of Xanadu</h1>' } },
      expect: { title: 'Building Code of Xanadu' },
    },
  ],
  citations: [{ captureId, quote: 'the gazette is published under an open licence' }],
  ...overrides,
})

describe('the synthetic country suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('an operator’s agent onboards a synthetic country through the platform door, and a monitor keeps it current', () => {
  type Principal = import('./principal').AgentPrincipal
  let handler: ReturnType<typeof import('./mcp-server').createAgentDoorHandler>
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess

  const session = (userId: string, permissions: string[]): AuthorizedSession => platformSession(fixed.platformOrg, userId, permissions)
  const MANAGE = ['platform:settings:view', 'platform:settings:manage']
  const author = platformOperator(session(`user_xa_author_${RUN}`, MANAGE))
  const expert = platformOperator(session(`user_xa_expert_${RUN}`, [...MANAGE, 'platform:knowledge:approve_as_domain_expert']))
  const counsel = platformOperator(session(`user_xa_counsel_${RUN}`, [...MANAGE, 'platform:knowledge:approve_as_counsel']))
  const { door, ok } = doorScript(() => handler)

  /** What the api tier was asked, so a test can say what left this tier. */
  const asked: { path: string; body: Record<string, unknown> }[] = []
  /** What the source serves now; a test moves it to make the monitor see a change. */
  let served = PAGE_V1
  let checkerDown = false
  let builtInDown = false

  /** The api tier's public-source routes, answered as `packages/public-sources` answers them. */
  function stubPublicSources() {
    vi.stubGlobal('fetch', async (target: string | URL | Request, init?: RequestInit) => {
      const address = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url
      if (address.startsWith('https://') && address.includes('langfuse')) return Response.json({})
      const path = address.replace(BACKEND, '')
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      asked.push({ path, body })
      const config = body.config as { hosts?: string[]; fixtures?: { responses: Record<string, unknown> }[] } | undefined
      if (path === '/v1/public-sources/check') {
        if (checkerDown) return new Response('down', { status: 503 })
        // As the package checks it: every URL a fixture records is on the record's hosts.
        const off = (config?.fixtures ?? []).flatMap((fixture) => Object.keys(fixture.responses)).filter((u) => !config?.hosts?.includes(new URL(u).hostname))
        return Response.json({
          valid: off.length === 0,
          problems: off.map((u) => ({ fixture: 'code', detail: `${u} is not an https URL on a host of the source` })),
          fixtures: [{ name: 'code', ok: off.length === 0, requested: [CODE_URL] }],
        })
      }
      if (path === '/v1/public-sources/capture') {
        const page = String(body.url)
        // A configured source's hosts travel with it; a source the api tier does not know by id is a 404.
        if (!config) return Response.json({ detail: `no source ${String(body.source)}` }, { status: 404 })
        if (!config.hosts?.includes(new URL(page).hostname)) return Response.json({ detail: 'not on a host' }, { status: 403 })
        const text = page === TERMS_URL ? TERMS : served
        return Response.json({ url: page, finalUrl: page, contentType: 'text/html', sha256: sha(text), bytes: text.length, text, retrievedAt: new Date().toISOString() })
      }
      if (path === '/v1/public-sources/built-in') {
        if (builtInDown) return Response.json({ detail: 'broken' }, { status: 500 })
        // The repository's own sources, as the api tier lists them (one, abridged).
        return Response.json({
          sources: [
            {
              sourceKey: 'at-ris',
              title: 'RIS',
              territory: 'AT',
              protocol: 'rest',
              format: 'ris_xml',
              hosts: ['data.bka.gv.at', 'www.ris.bka.gv.at'],
              dataFlow: 'public_only',
              licence: 'public_open',
              monitor: { kind: 'none', intervalHours: 24 },
              credentialHeader: null,
              fixtures: { valid: true, problems: [], fixtures: [{ name: 'search', ok: true, requested: ['https://data.bka.gv.at/x'] }] },
            },
          ],
        })
      }
      if (path === '/v1/public-sources/probe') {
        const previous = body.previous as { sha256: string }
        const current = sha(served)
        return Response.json({
          changed: Boolean(previous.sha256) && previous.sha256 !== current,
          termsChanged: false,
          termsUnwatched: '',
          current: { etag: '', sha256: current, version: '', termsSha256: sha(TERMS) },
          url: CODE_URL,
          contentType: 'text/html',
          bytes: served.length,
          text: served,
          anchors: ['para_1'],
        })
      }
      throw new Error(`no network in this spec: ${address}`)
    })
  }

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    process.env.APP_DATABASE_URL = url
    vi.stubEnv('INTERNAL_API_TOKEN', 'a-real-internal-token-for-the-synthetic-spec')
    vi.stubEnv('BACKEND_URL', BACKEND)
    vi.stubEnv('BYOK_SECRET_BACKEND', 'local-aes-gcm')
    vi.stubEnv('BYOK_LOCAL_KEK', randomBytes(32).toString('base64'))
    db = (await import('@/lib/db')).getDb()
    withPlatformAccess = (await import('@/lib/db/tenant-context')).withPlatformAccess
    handler = (await import('./mcp-server')).createAgentDoorHandler(() => undefined)
    stubPublicSources()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const count = async (query: ReturnType<typeof sql>) =>
    withPlatformAccess('synthetic spec count', async () => Number((await db.execute<{ n: number }>(query))[0]?.n ?? 0))

  let requestId = ''
  const captures = new Map<string, string>()

  const capture = async (principal: Principal, name: string, body: Record<string, unknown>, request = requestId) => {
    const captured = await ok(principal, 'platform-knowledge-citation-capture', { params: { changeRequestId: request }, body })
    captures.set(name, String(captured.captureId))
    return captured
  }

  it('offers the source record type and KC-7 in the shapes', async () => {
    const shapes = await ok(author, 'platform-knowledge-schema-get', { query: { type: 'source' } })
    expect(Object.keys(shapes.recordTypes as object)).toEqual(['source'])
    expect((shapes.checks as { code: string }[]).map((check) => check.code)).toContain('KC-7')
    const created = await ok(author, 'platform-knowledge-change-request-create', { body: { title: 'Xanadu at open', countryId: COUNTRY } })
    requestId = String(created.id)
  })

  it('imports the fixture territory and proposes the source, refused by KC-7 until its fixture is on its hosts', async () => {
    await capture(author, 'iso', { basis: 'operator_supplied', url: 'https://www.iso.org/obp/ui/#iso:code:3166:XA', text: ISO_LIST })
    await capture(author, 'terms', { basis: 'operator_supplied', url: TERMS_URL, text: TERMS })
    await ok(author, 'platform-territory-import', {
      params: { changeRequestId: requestId },
      body: { format: 'iso3166', captureId: captures.get('iso'), rows: [{ code: COUNTRY, name: 'Republic of Xanadu' }] },
    })

    // KC-7: a fixture that records a URL off the source's hosts.
    const offHost = sourceRecord(captures.get('terms')!, {
      fixtures: [{ name: 'code', operation: 'document', args: { id: 'code' }, responses: { 'https://elsewhere.example/x': { contentType: 'text/html', body: 'x' } }, expect: {} }],
    })
    const dry = await ok(author, 'platform-knowledge-records-propose', { params: { changeRequestId: requestId }, body: { dryRun: true, records: [offHost] } })
    expect(dry.valid).toBe(false)
    expect((dry.results as { problems: { code: string; pointer: string }[] }[])[0]?.problems).toEqual([expect.objectContaining({ code: 'KC-7', pointer: '/fixtures/0' })])

    // A licensed source is no record: its fixtures and captures would keep licensed text (ADR-0164).
    const licensed = await door(author, 'platform-knowledge-records-propose', {
      params: { changeRequestId: requestId },
      body: { dryRun: true, records: [sourceRecord(captures.get('terms')!, { terms: { url: TERMS_URL, licence: 'licensed', checked: '2026-11-01' } })] },
    })
    expect(licensed.problem).toMatchObject({ status: 400 })

    // Unknown fails closed: with the checker down, the source is a problem, never a pass.
    checkerDown = true
    const unchecked = await ok(author, 'platform-knowledge-records-propose', { params: { changeRequestId: requestId }, body: { dryRun: true, records: [sourceRecord(captures.get('terms')!)] } })
    checkerDown = false
    expect(unchecked.valid).toBe(false)

    // Positive control: the repaired record is written.
    const written = await ok(author, 'platform-knowledge-records-propose', { params: { changeRequestId: requestId }, body: { records: [sourceRecord(captures.get('terms')!)] } })
    expect((written.results as { status: string }[])[0]?.status).toBe('written')
  })

  it('opens the draft source’s hosts to its own request only, for testing', async () => {
    const own = await ok(author, 'platform-knowledge-source-test', { params: { sourceKey: SOURCE }, body: { changeRequestId: requestId } })
    expect(own).toMatchObject({ state: 'testing', hosts: [HOST], fixtures: { valid: true } })

    // No egress to an unregistered host: unpublished, so not usable without its request.
    const published = await door(author, 'platform-knowledge-source-test', { params: { sourceKey: SOURCE }, body: {} })
    expect(published.problem).toMatchObject({ status: 404 })

    // Another request cannot fetch through this draft's hosts.
    const other = await ok(author, 'platform-knowledge-change-request-create', { body: { title: 'Another draft', countryId: COUNTRY } })
    asked.length = 0
    const elsewhere = await door(author, 'platform-knowledge-citation-capture', {
      params: { changeRequestId: String(other.id) },
      body: { basis: 'fetched', sourceId: SOURCE, url: CODE_URL },
    })
    expect(elsewhere.ok).toBe(false)
    expect(asked.every((call) => call.body.config === undefined)).toBe(true)

    // Positive control: its own request fetches the page through the source's configuration.
    const page = await capture(author, 'code', { basis: 'fetched', sourceId: SOURCE, url: CODE_URL })
    expect(page.sha256).toBe(sha(PAGE_V1))
    expect((asked.at(-1)?.body.config as { id: string }).id).toBe(SOURCE)
  })

  it('proposes an advice policy and validates green using door operations only', async () => {
    const policy = {
      type: 'ruleset',
      key: `xa-advice-${RUN}`,
      values: {
        purpose: 'advice_policy',
        territoryIds: [COUNTRY],
        validFrom: '2026-01-01',
        body: { kind: 'advice_policy', payloadSchema: 'advice_policy.v1', payload: { topics: { deadlines: 'hedge', contract_drafting: 'decline' } } },
      },
      citations: [{ captureId: captures.get('code'), quote: 'This code applies to every building in Xanadu.' }],
    }
    await ok(author, 'platform-knowledge-records-propose', { params: { changeRequestId: requestId }, body: { records: [policy] } })
    const validation = await ok(author, 'platform-knowledge-validate', { params: { changeRequestId: requestId } })
    expect(validation).toMatchObject({ valid: true, records: 3, problems: [] })
    await ok(author, 'platform-knowledge-change-request-submit', { params: { changeRequestId: requestId } })
  })

  it('needs counsel’s approval for an advice policy: one domain expert’s yes leaves it submitted', async () => {
    const view = await ok(expert, 'platform-knowledge-change-request-get', { params: { changeRequestId: requestId } })
    // The expert checked the operator-supplied pages (the ISO list, the terms) against their sources.
    const decisions = (view.revisions as { revisionId: string; claims: { path: string }[] }[]).flatMap((revision) =>
      revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted', sourceChecked: true })),
    )
    await ok(expert, 'platform-knowledge-change-request-review', { params: { changeRequestId: requestId }, body: { decisions } }, { person: 'yes' })

    const asExpert = await ok(expert, 'platform-knowledge-change-request-decide', { params: { changeRequestId: requestId }, body: { decision: 'approve', role: 'domain_expert' } }, { person: 'yes' })
    expect(asExpert).toMatchObject({ status: 'submitted', awaiting: ['counsel'] })
    const early = await door(expert, 'platform-knowledge-publish', { params: { changeRequestId: requestId }, body: { channel: 'preview' } }, { person: 'yes' })
    expect(early.ok).toBe(false)

    // The role is the approver's, held in WorkOS: the expert cannot approve as counsel.
    const claimed = await door(expert, 'platform-knowledge-change-request-decide', { params: { changeRequestId: requestId }, body: { decision: 'approve', role: 'counsel' } }, { person: 'yes' })
    expect(claimed.problem).toMatchObject({ status: 403 })

    const asCounsel = await ok(counsel, 'platform-knowledge-change-request-decide', { params: { changeRequestId: requestId }, body: { decision: 'approve', role: 'counsel' } }, { person: 'yes' })
    expect(asCounsel).toMatchObject({ status: 'approved', awaiting: [] })

    await ok(expert, 'platform-knowledge-publish', { params: { changeRequestId: requestId }, body: { channel: 'preview' } }, { person: 'yes' })
    const stable = await ok(expert, 'platform-knowledge-publish', { params: { changeRequestId: requestId }, body: { channel: 'stable' } }, { person: 'yes' })
    expect(stable.moved).toBe(3)
  })

  it('reads the published source’s state, and takes its key only on the person’s yes, never giving it back', async () => {
    const status = await ok(author, 'platform-knowledge-source-status', { query: { sourceKey: SOURCE } })
    const [source] = status.sources as { origin: string; state: string; hosts: { state: string }[]; credential: { set: boolean } }[]
    expect(source).toMatchObject({ origin: 'record', state: 'active', hosts: [{ state: 'active' }], credential: { set: false } })

    // The built-in sources are listed beside the records, read-only, with their recorded fixtures' result.
    const every = await ok(author, 'platform-knowledge-source-status', { query: {} })
    const listed = every.sources as { sourceKey: string; origin: string; recordId: string | null; fixtures: { valid: boolean } | null }[]
    expect(listed.find((one) => one.sourceKey === 'at-ris')).toMatchObject({ origin: 'built_in', recordId: null, fixtures: { valid: true } })
    expect(listed.find((one) => one.sourceKey === SOURCE)).toMatchObject({ origin: 'record', fixtures: null })
    expect(every.builtInUnavailable).toBeNull()

    // An api tier that cannot list them costs the built-in sources only: the records are listed, and the answer says why.
    builtInDown = true
    const degraded = await ok(author, 'platform-knowledge-source-status', { query: {} })
    builtInDown = false
    const left = degraded.sources as { sourceKey: string; origin: string }[]
    expect(left.some((one) => one.origin === 'built_in')).toBe(false)
    expect(left.find((one) => one.sourceKey === SOURCE)).toMatchObject({ origin: 'record' })
    expect(String(degraded.builtInUnavailable)).toContain('did not answer')

    const input = { params: { sourceKey: SOURCE }, body: { secret: 'xa-key-0123456789' } }
    const cannotAsk = await door(expert, 'platform-knowledge-source-credential-set', input, { elicits: false })
    expect(cannotAsk.body).toMatchObject({ decision: 'person_required', changed: false })
    const { callOperation } = await import('./dispatch')
    const { findOperation } = await import('./catalog')
    const bare = await callOperation(findOperation('platform-knowledge-source-credential-set')!, input, expert.session, 'agent', {})
    expect(bare).toMatchObject({ status: 403, body: { code: 'PERSON_DECISION_REQUIRED' } })
    expect(await count(sql`SELECT count(*)::int AS n FROM knowledge_source_credentials WHERE record_id = ${`source:${SOURCE}`}`)).toBe(0)

    const set = await ok(expert, 'platform-knowledge-source-credential-set', input, { person: 'yes' })
    expect(JSON.stringify(set)).not.toContain('xa-key-0123456789')
    expect(set).toMatchObject({ credential: { set: true, hint: '…6789' } })
    const after = await ok(author, 'platform-knowledge-source-status', { query: { sourceKey: SOURCE } })
    expect(JSON.stringify(after)).not.toContain('xa-key-0123456789')
    const stored = await withPlatformAccess('synthetic spec credential', async () =>
      db.execute<{ encrypted: string }>(sql`SELECT encrypted_key AS encrypted FROM knowledge_source_credentials WHERE record_id = ${`source:${SOURCE}`}`),
    )
    expect(stored[0]?.encrypted).not.toContain('xa-key-0123456789')
  })

  it('sends the key with a draft only to hosts and under a header the released source already had', async () => {
    const reproposed = async (hosts: string[]) => {
      const request = String((await ok(author, 'platform-knowledge-change-request-create', { body: { title: 'Xanadu, again', countryId: COUNTRY } })).id)
      const terms = String(
        (await ok(author, 'platform-knowledge-citation-capture', { params: { changeRequestId: request }, body: { basis: 'operator_supplied', url: TERMS_URL, text: TERMS } }))
          .captureId,
      )
      await ok(author, 'platform-knowledge-records-propose', { params: { changeRequestId: request }, body: { records: [sourceRecord(terms, { hosts })] } })
      asked.length = 0
      await ok(author, 'platform-knowledge-source-test', { params: { sourceKey: SOURCE }, body: { changeRequestId: request, live: true } })
      return asked.find((call) => call.path === '/v1/public-sources/probe')?.body
    }
    // A draft that adds a host nobody reviewed is probed without the key.
    const widened = await reproposed([HOST, 'attacker.example'])
    expect(widened?.config).toMatchObject({ hosts: [HOST, 'attacker.example'] })
    expect(widened?.credential).toBeUndefined()
    // Positive control: the same hosts as released, so the key goes.
    expect((await reproposed([HOST]))?.credential).toBe('xa-key-0123456789')
  })

  it('opens one change request when the source changes, never publishes, and the agent finds it by origin', async () => {
    const { runSourceMonitor } = await import('@/lib/base-knowledge/platform/monitor')
    const { probeSource } = await import('@/lib/base-knowledge/platform/source-service')
    const runs: { lags: { recordId: string; days: number }[] }[] = []
    const deps = { probe: probeSource, record: async (run: (typeof runs)[number]) => void runs.push(run) }
    const recordId = `source:${SOURCE}`

    // Flag off, through the real check of the platform's flags: nothing read, nothing fetched.
    fixed.flagsOff.add('source-monitors')
    asked.length = 0
    expect((await runSourceMonitor(new Date(), { probe: probeSource, record: deps.record })).enabled).toBe(false)
    expect(asked).toEqual([])
    fixed.flagsOff.delete('source-monitors')

    const t0 = new Date()
    const baseline = await runSourceMonitor(t0, deps)
    expect(baseline.opened[recordId]).toBeUndefined()
    // The key went to the api tier for the fetch, and only there.
    expect(asked.find((call) => call.path === '/v1/public-sources/probe')?.body.credential).toBe('xa-key-0123456789')
    expect(runs.at(-1)?.lags.find((lag) => lag.recordId === recordId)?.days).toBe(0)

    served = PAGE_V2
    const later = new Date(t0.getTime() + 25 * 3_600_000)
    const changed = await runSourceMonitor(later, deps)
    const opened = changed.opened[recordId]
    expect(opened).toBeTruthy()

    const found = await ok(author, 'platform-knowledge-change-request-list', { query: { origin: 'monitor' } })
    const request = (found.changeRequests as { id: string; status: string; origin: string; sourceRecordId: string; monitorFinding: { needs: string[]; previous: { sha256: string } } }[]).find((row) => row.id === opened)
    expect(request).toMatchObject({ status: 'draft', origin: 'monitor', sourceRecordId: recordId, monitorFinding: { needs: ['recheck_records'], previous: { sha256: sha(PAGE_V1) } } })
    expect(await count(sql`SELECT count(*)::int AS n FROM knowledge_citation_captures WHERE change_request_id = ${opened} AND sha256 = ${sha(PAGE_V2)}`)).toBe(1)
    // Monitors only open: nothing of it is released.
    expect(await count(sql`SELECT count(*)::int AS n FROM knowledge_release_moves WHERE change_request_id = ${opened}`)).toBe(0)

    // A second change while that request is open goes into the same review: no second request.
    served = `${PAGE_V2}\n§ 3 Gardens`
    const again = await runSourceMonitor(new Date(later.getTime() + 25 * 3_600_000), deps)
    expect(again.opened[recordId]).toBeUndefined()
    expect(await count(sql`SELECT count(*)::int AS n FROM knowledge_change_requests WHERE source_record_id = ${recordId}`)).toBe(1)

    // A reviewer with nothing to do closes it (a draft may be rejected, the person's yes), and the next change files anew.
    const closed = await ok(expert, 'platform-knowledge-change-request-decide', { params: { changeRequestId: opened }, body: { decision: 'reject', role: 'domain_expert' } }, { person: 'yes' })
    expect(closed.status).toBe('rejected')
    served = `${PAGE_V2}\n§ 4 Fountains`
    const reopened = await runSourceMonitor(new Date(later.getTime() + 75 * 3_600_000), deps)
    expect(reopened.opened[recordId]).toBeTruthy()
  })
})
