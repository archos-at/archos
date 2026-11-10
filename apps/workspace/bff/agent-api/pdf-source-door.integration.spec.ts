// @disk-inputs: ../../packages/public-sources/testing/public_sources_testing/fixtures/urhg-7.pdf, ../../packages/public-sources/testing/public_sources_testing/fixtures/urhg-7.txt
/**
 * @vitest-environment node
 *
 * A public PDF on the platform door: an operator's agent proposes a source
 * whose documents are PDFs (`pdf_document`, its fixture recorded as base64),
 * captures a PDF through it, and proposes a record quoting a sentence from
 * page 2 that passes KC-6. Every call goes through the real MCP door handler,
 * catalog, dispatcher and route handlers, against a REAL Postgres:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/agent-api/pdf-source-door.integration.spec.ts
 *
 * Faked, because they are outside the door: WorkOS, the flags, the audit
 * trail, and the api tier's public-source routes. Those answer with the
 * committed fixture of `packages/public-sources`: § 7 UrhG as a two-page PDF
 * and the text ingestion's text pass reads from it (`urhg-7.txt`, pages joined
 * by a form feed). `packages/public-sources/tests/test_pdf.py` fails when the
 * two drift, so the text this spec quotes is the text the corpus would index.
 *
 * Each guard has its positive control beside it: the quote the capture does not
 * hold is refused and the one from page 2 passes; the body that is no base64 is
 * refused and the PDF's base64 is written; the PDF behind a password stores
 * nothing and names its code.
 */

import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import { doorScript, platformOperator, platformSession } from './testing/platform-door-script'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_pdf_${Date.now().toString(36)}` }))

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

const FIXTURES = join(process.cwd(), '../../packages/public-sources/testing/public_sources_testing/fixtures')
const PDF = readFileSync(join(FIXTURES, 'urhg-7.pdf'))
const PDF_TEXT = readFileSync(join(FIXTURES, 'urhg-7.txt'), 'utf8').replace(/\n$/, '')

/** A synthetic country, its own so this spec shares no territory with another on the same database. */
const COUNTRY = 'XP'
const SOURCE = `xp-gazette-${RUN}`
const HOST = 'gazette.xp.example'
const PDF_URL = `https://${HOST}/urhg-7.pdf`
const LOCKED_URL = `https://${HOST}/locked.pdf`
const SCAN_URL = `https://${HOST}/scan.pdf`
const TERMS_URL = `https://${HOST}/terms`
const TERMS = 'Terms of use of the Gazette of XP: the gazette is published under an open licence.'
const ISO_LIST = 'XP Republic of XP (a user-assigned code, for testing)'

/** Page 2 of the PDF, Abs. 2 of § 7, as a person copies it from the page: line breaks and all. */
const PAGE_TWO_QUOTE =
  'Die vom Bundesamt für Eich- und Vermessungswesen hergestellten oder bearbeiteten (§ 5, Absatz 1) und zur Verbreitung (§ 16) bestimmten Landkarten sind keine freien Werke.'

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

const sourceRecord = (captureId: string, body = PDF.toString('base64')) => ({
  type: 'source',
  key: SOURCE,
  title: 'Gazette of XP',
  territoryId: COUNTRY,
  protocol: 'web_document',
  format: 'pdf_document',
  hosts: [HOST],
  terms: { url: TERMS_URL, licence: 'public_open', checked: '2026-11-01' },
  monitor: { kind: 'sha256', intervalHours: 24, probe: { operation: 'document', args: { id: 'urhg' } } },
  access: { documents: [{ id: 'urhg', url: PDF_URL, title: 'Urheberrechtsgesetz' }] },
  engine: { title: 'Urheberrechtsgesetz, § 7 Freie Werke' },
  fixtures: [
    {
      name: 'urhg',
      operation: 'document',
      args: { id: 'urhg' },
      responses: { [PDF_URL]: { contentType: 'application/pdf', encoding: 'base64', body } },
      expect: { anchors: ['page_1', 'page_2'], contains: ['keine freien Werke'] },
    },
  ],
  citations: [{ captureId, quote: 'the gazette is published under an open licence' }],
})

describe('the PDF source suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('an operator’s agent proposes a PDF source, captures a PDF and quotes its page 2 through the platform door', () => {
  let handler: ReturnType<typeof import('./mcp-server').createAgentDoorHandler>
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess

  const session = (userId: string, permissions: string[]): AuthorizedSession => platformSession(fixed.platformOrg, userId, permissions)
  const author = platformOperator(session(`user_pdf_author_${RUN}`, ['platform:settings:view', 'platform:settings:manage']))
  const { door, ok } = doorScript(() => handler)

  /** What the api tier was asked, so a test can say what left this tier. */
  const asked: { path: string; body: Record<string, unknown> }[] = []

  /** The api tier's public-source routes, answered as `packages/public-sources` answers them for the fixture. */
  function stubPublicSources() {
    vi.stubGlobal('fetch', async (target: string | URL | Request, init?: RequestInit) => {
      const address = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url
      if (address.startsWith('https://') && address.includes('langfuse')) return Response.json({})
      const path = address.replace(BACKEND, '')
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      asked.push({ path, body })
      if (path === '/v1/public-sources/check') {
        return Response.json({ valid: true, problems: [], fixtures: [{ name: 'urhg', ok: true, requested: [PDF_URL] }] })
      }
      if (path !== '/v1/public-sources/capture') throw new Error(`no network in this spec: ${address}`)
      const page = String(body.url)
      const base = { url: page, finalUrl: page, contentType: 'application/pdf', retrievedAt: new Date().toISOString() }
      if (page === LOCKED_URL) {
        return Response.json({ detail: "the PDF needs a password to open; a source's text must be readable without one", code: 'pdf_encrypted' }, { status: 422 })
      }
      if (page === SCAN_URL) {
        const note = 'no text layer on all of its pages (a scan?): nothing there can be quoted; OCR is not done for a capture'
        return Response.json({ ...base, sha256: sha('scan'), bytes: 4, text: null, pages: 2, note })
      }
      if (page === TERMS_URL) return Response.json({ ...base, contentType: 'text/html', sha256: sha(TERMS), bytes: TERMS.length, text: TERMS, pages: null, note: null })
      return Response.json({ ...base, sha256: sha(PDF), bytes: PDF.length, text: PDF_TEXT, pages: 2, note: null })
    })
  }

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    process.env.APP_DATABASE_URL = url
    vi.stubEnv('INTERNAL_API_TOKEN', 'a-real-internal-token-for-the-pdf-spec')
    vi.stubEnv('BACKEND_URL', BACKEND)
    db = (await import('@/lib/db')).getDb()
    withPlatformAccess = (await import('@/lib/db/tenant-context')).withPlatformAccess
    handler = (await import('./mcp-server')).createAgentDoorHandler(() => undefined)
    stubPublicSources()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const capturesOfRequest = async () =>
    withPlatformAccess('pdf spec count', async () =>
      Number((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM knowledge_citation_captures WHERE change_request_id = ${requestId}`))[0]?.n ?? 0),
    )

  let requestId = ''
  const captures = new Map<string, string>()
  const capture = async (name: string, body: Record<string, unknown>) => {
    const captured = await ok(author, 'platform-knowledge-citation-capture', { params: { changeRequestId: requestId }, body })
    captures.set(name, String(captured.captureId))
    return captured
  }

  it('offers pdf_document and a base64 response body in the source shape', async () => {
    const shapes = await ok(author, 'platform-knowledge-schema-get', { query: { type: 'source' } })
    const shape = JSON.stringify(shapes.recordTypes)
    expect(shape).toContain('pdf_document')
    expect(shape).toContain('base64')
    requestId = String((await ok(author, 'platform-knowledge-change-request-create', { body: { title: 'XP, from PDFs', countryId: COUNTRY } })).id)
  })

  it('proposes a pdf_document source whose fixture carries the PDF as base64, and refuses a body that is none', async () => {
    await capture('iso', { basis: 'operator_supplied', url: 'https://www.iso.org/obp/ui/#iso:code:3166:XP', text: ISO_LIST })
    await capture('terms', { basis: 'operator_supplied', url: TERMS_URL, text: TERMS })
    await ok(author, 'platform-territory-import', {
      params: { changeRequestId: requestId },
      body: { format: 'iso3166', captureId: captures.get('iso'), rows: [{ code: COUNTRY, name: 'Republic of XP' }] },
    })

    const notBase64 = await door(author, 'platform-knowledge-records-propose', {
      params: { changeRequestId: requestId },
      body: { dryRun: true, records: [sourceRecord(captures.get('terms')!, 'not base64!')] },
    })
    expect(notBase64.problem).toMatchObject({ status: 400 })
    expect(JSON.stringify(notBase64.problem)).toContain('base64')

    asked.length = 0
    const written = await ok(author, 'platform-knowledge-records-propose', { params: { changeRequestId: requestId }, body: { records: [sourceRecord(captures.get('terms')!)] } })
    expect((written.results as { status: string }[])[0]?.status).toBe('written')
    // What KC-7 hands the api tier is the PDF's own bytes, as public_sources.source.InlineResponse decodes them.
    const config = asked.find((call) => call.path === '/v1/public-sources/check')?.body.config as {
      format: string
      fixtures: { responses: Record<string, { content_type: string; encoding: string; text: string }> }[]
    }
    expect(config.format).toBe('pdf_document')
    const recorded = config.fixtures[0]!.responses[PDF_URL]!
    expect(recorded).toMatchObject({ content_type: 'application/pdf', encoding: 'base64' })
    expect(sha(Buffer.from(recorded.text, 'base64'))).toBe(sha(PDF))
  })

  it('captures the PDF through its source: the text of its pages, and how many', async () => {
    const captured = await capture('urhg', { basis: 'fetched', sourceId: SOURCE, url: PDF_URL })
    expect(captured).toMatchObject({ contentType: 'application/pdf', sha256: sha(PDF), bytes: PDF.length, pages: 2, note: null, textChars: PDF_TEXT.length })
    expect((asked.at(-1)?.body.config as { id: string }).id).toBe(SOURCE)

    const view = await ok(author, 'platform-knowledge-change-request-get', { params: { changeRequestId: requestId } })
    const listed = (view.captures as { captureId: string; pages: number | null }[]).find((entry) => entry.captureId === captures.get('urhg'))
    expect(listed?.pages).toBe(2)
  })

  it('refuses a quote the PDF does not hold, and passes KC-6 with a sentence from its page 2', async () => {
    const authority = (quote: string) => ({
      type: 'authority',
      key: `xp-bev-${RUN}`,
      name: 'Bundesamt für Eich- und Vermessungswesen',
      functionCodes: ['surveying'],
      seatTerritoryId: COUNTRY,
      competenceTerritoryIds: [COUNTRY],
      citations: [{ captureId: captures.get('urhg'), quote }],
    })
    const madeUp = await ok(author, 'platform-knowledge-records-propose', {
      params: { changeRequestId: requestId },
      body: { dryRun: true, records: [authority('Das Bundesamt für Eich- und Vermessungswesen erlässt Bauordnungen.')] },
    })
    expect(madeUp.valid).toBe(false)
    expect((madeUp.results as { problems: { code: string; pointer: string }[] }[])[0]?.problems).toEqual([
      expect.objectContaining({ code: 'KC-6', pointer: '/citations/0/quote' }),
    ])

    // The sentence sits on page 2, after the form feed that ends page 1, and runs over three lines there.
    expect(PDF_TEXT.split('\f')[1]).toContain('bestimmten Landkarten sind keine freien Werke')
    await ok(author, 'platform-knowledge-records-propose', { params: { changeRequestId: requestId }, body: { records: [authority(PAGE_TWO_QUOTE)] } })
    const validation = await ok(author, 'platform-knowledge-validate', { params: { changeRequestId: requestId } })
    expect(validation).toMatchObject({ valid: true, problems: [] })
  })

  it('stores nothing of a PDF behind a password, and names the problem by its code', async () => {
    const before = await capturesOfRequest()
    const locked = await door(author, 'platform-knowledge-citation-capture', {
      params: { changeRequestId: requestId },
      body: { basis: 'fetched', sourceId: SOURCE, url: LOCKED_URL },
    })
    expect(locked.problem).toMatchObject({ status: 422, code: 'PDF_ENCRYPTED' })
    expect(await capturesOfRequest()).toBe(before)
  })

  it('keeps a scan with no text, and says why nothing on it can be quoted', async () => {
    const scan = await capture('scan', { basis: 'fetched', sourceId: SOURCE, url: SCAN_URL })
    expect(scan).toMatchObject({ textChars: 0, pages: null })
    expect(String(scan.note)).toContain('no text layer')
  })
})
