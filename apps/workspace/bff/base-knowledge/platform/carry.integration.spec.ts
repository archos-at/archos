/**
 * @vitest-environment node
 *
 * The promotion's carry of reviewed releases (ADR-0181) against a REAL Postgres database, a fresh copy of the
 * migrated schema as `scripts/rls-test-db.sh` makes it (the deployment the releases are carried to):
 *
 *   TEST_CARRY_DATABASE_URL=postgres://app_rw@host:port/<the copy> \
 *     npx vitest run bff/base-knowledge/platform/carry.integration.spec.ts
 *
 * Two bundles as a source deployment exports them, the synthetic union XB and country XA (whose territory lies
 * in XB, and whose edition has one text): a bundle whose digest is not the manifest's is refused before anything
 * is written; a text whose fetched bytes are not the released ones stops XA in a draft, with nothing of XA
 * published; the right bytes then carry both to stable, decided `carried`, approved alone with no second review
 * due, the texts ingested with the country's mark and labelled, the legacy copy of a released text deleted. A
 * second run, and a run on the source deployment, change nothing.
 *
 * Faked, because they are outside the database: the audit trail, the platform organization's id, the public-source
 * fetcher (which serves the PDF's bytes for its URL), the job queue (which runs the index job in place), and the base
 * corpus (the backend's), which holds files by name, sha256, mark, class and title.
 */

import { createHash, webcrypto } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

type CorpusFile = { sha256: string; countryId: string | null; state: string; docClass: string | null; displayTitle: string | null }

const fixed = vi.hoisted(() => ({ platformOrg: 'org_platform_carry' }))
const corpus = vi.hoisted(() => new Map<string, CorpusFile>())
/** The bytes the fetcher serves for a URL: a test swaps them to see other bytes refused. */
const served = vi.hoisted(() => new Map<string, Buffer>())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/authz/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz/platform')>()),
  getPlatformOrganizationId: async () => fixed.platformOrg,
}))
vi.mock('@/lib/audit/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit/service')>()),
  recordAuditEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseStatus: async () => ({
    files: [...corpus].map(([fileName, file]) => ({ fileName, currentSha256: file.sha256, ...file })),
  }),
  reingestKnowledgeBaseDocuments: async (names: string[], marks: Record<string, { countryId: string | null }>) => {
    for (const name of names) {
      const file = corpus.get(name)
      if (file) corpus.set(name, { ...file, state: 'ingested', countryId: marks[name]?.countryId ?? file.countryId })
    }
    return { queued: names.filter((name) => corpus.has(name)), unknown: names.filter((name) => !corpus.has(name)) }
  },
  updateKnowledgeBaseDisplayTitle: async (name: string, displayTitle: string | null) => {
    corpus.set(name, { ...corpus.get(name)!, displayTitle })
  },
  updateKnowledgeBaseDocClass: async (name: string, docClass: string) => {
    corpus.set(name, { ...corpus.get(name)!, docClass })
  },
  deleteKnowledgeBaseDocument: async (name: string) => {
    corpus.delete(name)
  },
  withdrawCorpusFile: async () => undefined,
  uploadKnowledgeBaseDocument: async () => ({ status: 'pending', message: '' }),
}))
vi.mock('./capture-fetch', async (importOriginal) => {
  const real = await importOriginal<typeof import('./capture-fetch')>()
  const { textFileName } = await import('./text-wire')
  return {
    ...real,
    importSourceText: async (text: { url: string; fileStem: string }) => {
      const bytes = served.get(text.url)
      if (!bytes) throw new real.CaptureFetchError(`nothing at ${text.url}`, 404)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const fileName = textFileName(text.fileStem, sha256)
      const stored = !corpus.has(fileName)
      if (stored) corpus.set(fileName, { sha256, countryId: null, state: 'pending', docClass: 'other', displayTitle: null })
      return { url: text.url, finalUrl: text.url, contentType: 'application/pdf', sha256, bytes: bytes.length, pages: 1, note: null, retrievedAt: new Date().toISOString(), fileName, stored }
    },
  }
})
vi.mock('@/lib/jobs-queue/enqueue', () => ({
  // The index job, run in place: the pool would run the same step.
  enqueueJob: async (job: { kind: string; organizationId: string; payload: { runId: string } }) => {
    const { runPlatformTextIndex } = await import('./indexing')
    await runPlatformTextIndex(job.organizationId, job.payload, { last: true })
  },
}))

const URL_ = process.env.TEST_CARRY_DATABASE_URL

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const PDF = Buffer.from('%PDF-1.7 Building Code of Xanadu, edition 2026')
const PDF_SHA = sha(PDF)
const TEXT_KEY = 'xa-building-code-2026-pdf'
const TEXT_FILE = `${TEXT_KEY}-${PDF_SHA.slice(0, 12)}.pdf`
const TEXT_URL = 'https://gazette.xa.example/building-code-2026.pdf'
const PAGE = 'XA Republic of Xanadu\nBuilding Code of Xanadu, edition 2026\n§ 1 This code applies to every building in Xanadu.'
const UNION_PAGE = 'XB Union of Xanadu and Beyond (a user-assigned code, for testing)'
const LEGACY = 'building-code-xanadu-2026.pdf'
const UNRELATED = 'xanadu-handbook.pdf'

const capture = (id: string, text: string) => ({
  captureId: id,
  basis: 'operator_supplied' as const,
  url: 'https://gazette.xa.example/',
  finalUrl: null,
  contentType: 'text/plain; charset=utf-8',
  sha256: sha(text),
  bytes: Buffer.byteLength(text),
  text,
  retrievedAt: '2026-11-12T10:00:00.000Z',
})
const UNION_CAPTURE = '11111111-1111-4111-8111-111111111111'
const COUNTRY_CAPTURE = '22222222-2222-4222-8222-222222222222'

const unionBundle = {
  format: 'knowledge-release/1',
  countryId: 'XB',
  releaseSeq: 7,
  records: [{ type: 'territory', id: 'XB', kind: 'union', name: 'Union of Xanadu and Beyond', citations: [{ captureId: UNION_CAPTURE, quote: UNION_PAGE }] }],
  captures: [capture(UNION_CAPTURE, UNION_PAGE)],
  texts: [],
  requires: [],
}
const countryBundle = {
  format: 'knowledge-release/1',
  countryId: 'XA',
  releaseSeq: 12,
  records: [
    { type: 'territory', id: 'XA', kind: 'country', name: 'Republic of Xanadu', parents: [{ id: 'XB' }], citations: [{ captureId: COUNTRY_CAPTURE, quote: 'XA Republic of Xanadu' }] },
    { type: 'work', key: 'xa-building-code', kind: 'statute', title: 'Building Code of Xanadu', territoryIds: ['XA'], citations: [{ captureId: COUNTRY_CAPTURE, quote: 'Building Code of Xanadu' }] },
    { type: 'edition', key: 'xa-building-code-2026', workKey: 'xa-building-code', label: 'edition 2026', citations: [{ captureId: COUNTRY_CAPTURE, quote: 'Building Code of Xanadu, edition 2026' }] },
    {
      type: 'manifestation',
      key: TEXT_KEY,
      editionKey: 'xa-building-code-2026',
      language: 'en',
      licenceClass: 'public_open',
      corpusFile: TEXT_FILE,
      citations: [{ captureId: COUNTRY_CAPTURE, quote: 'This code applies to every building in Xanadu.' }],
    },
  ],
  captures: [capture(COUNTRY_CAPTURE, PAGE)],
  texts: [{ manifestationKey: TEXT_KEY, fileName: TEXT_FILE, sha256: PDF_SHA, url: TEXT_URL, sourceId: 'xa-gazette' }],
  requires: [{ recordId: 'XB', countryId: 'XB' }],
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value))
const FILES: Record<string, Buffer> = { 'xb-7.json.gz': gzipSync(json(unionBundle)), 'xa-12.json.gz': gzipSync(json(countryBundle)) }
const manifestWith = (overrides: { unionSha?: string } = {}) => ({
  format: 'knowledge-carry/1',
  sourceDeployment: 'dev',
  bundles: [
    { file: 'xb-7.json.gz', countryId: 'XB', seq: 7, sha256: overrides.unionSha ?? sha(json(unionBundle)), records: 1, captures: 1, texts: {} },
    { file: 'xa-12.json.gz', countryId: 'XA', seq: 12, sha256: sha(json(countryBundle)), records: 4, captures: 1, texts: { [TEXT_FILE]: { docClass: 'law', displayTitle: 'Building Code of Xanadu, edition 2026' } } },
  ],
})

describe('the carry suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(URL_, 'TEST_CARRY_DATABASE_URL unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!URL_)('a reviewed release carried to this deployment by the promotion', () => {
  let carry: typeof import('./carry')
  let manifests: typeof import('./carry-manifest')
  let db: typeof import('@/lib/db')
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  const logged: string[] = []
  const ctx = (deployment = 'prod') => ({ deployment, promotion: 'image sha-test', log: (step: string) => void logged.push(step), waitMs: 5_000, pollMs: 10 })
  const read = async (file: string) => FILES[file]!

  const rows = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    withPlatformAccess('carry spec', async () => [...(await db.getDb().execute<T>(query))])

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    process.env.APP_DATABASE_URL = URL_
    process.env.KNOWLEDGE_SINGLE_OPERATOR = 'true'
    db = await import('@/lib/db')
    withPlatformAccess = (await import('@/lib/db/tenant-context')).withPlatformAccess
    carry = await import('./carry')
    manifests = await import('./carry-manifest')
    // The legacy copy of the released text (same bytes, its old name), and a file no release has.
    corpus.set(LEGACY, { sha256: PDF_SHA, countryId: 'XA', state: 'ingested', docClass: 'law', displayTitle: null })
    corpus.set(UNRELATED, { sha256: sha('another document'), countryId: 'XA', state: 'ingested', docClass: 'other', displayTitle: null })
  })

  afterAll(async () => {
    delete process.env.KNOWLEDGE_SINGLE_OPERATOR
    await db.closeDb()
  })

  it('refuses a bundle whose digest is not the manifest’s, before anything is written', async () => {
    const manifest = manifests.parseManifest(manifestWith({ unionSha: 'f'.repeat(64) }))
    await expect(carry.runCarry(manifest, read, ctx())).rejects.toThrow(manifests.CarryRefused)
    await expect(carry.runCarry(manifest, read, ctx())).rejects.toThrow(/has sha256 .* the manifest names f{64}/)
    expect(await rows(sql`SELECT id FROM knowledge_change_requests`)).toEqual([])
  })

  it('stops a country whose fetched text is not the released bytes in a draft, with nothing of it published', async () => {
    served.set(TEXT_URL, Buffer.from('%PDF-1.7 another text'))
    await expect(carry.runCarry(manifests.parseManifest(manifestWith()), read, ctx())).rejects.toMatchObject({ code: 'TEXT_NOT_RELEASED' })
    // The union went first and is out; the country is a draft no office reads.
    expect(await rows(sql`SELECT country_id, status FROM knowledge_change_requests ORDER BY country_id`)).toEqual([
      { country_id: 'XA', status: 'draft' },
      { country_id: 'XB', status: 'published' },
    ])
    expect(await rows(sql`SELECT id FROM knowledge_records WHERE country_id = 'XA' AND head_revision_id IS NOT NULL`)).toEqual([])
  })

  it('carries both to stable, decided `carried`, once the right bytes are fetched', async () => {
    served.set(TEXT_URL, PDF)
    const outcomes = await carry.runCarry(manifests.parseManifest(manifestWith()), read, ctx())
    expect(outcomes.map((outcome) => [outcome.countryId, outcome.status])).toEqual([
      ['XB', 'skipped'],
      ['XA', 'carried'],
    ])
    const requests = await rows<{ country_id: string; status: string; approval: string; second_review: string | null; carried_from: Record<string, unknown> }>(
      sql`SELECT country_id, status, approval, second_review, carried_from FROM knowledge_change_requests ORDER BY country_id`,
    )
    expect(requests).toEqual([
      expect.objectContaining({ country_id: 'XA', status: 'published', approval: 'single', second_review: null }),
      expect.objectContaining({ country_id: 'XB', status: 'published', approval: 'single', second_review: null }),
    ])
    expect(requests[0]!.carried_from).toEqual({ sha256: sha(json(countryBundle)), sourceDeployment: 'dev', sourceSeq: 12, promotion: 'image sha-test' })
    expect(await rows(sql`SELECT DISTINCT decision_source FROM knowledge_approvals`)).toEqual([{ decision_source: 'carried' }])
    expect(await rows(sql`SELECT DISTINCT decision_source FROM knowledge_release_moves`)).toEqual([{ decision_source: 'carried' }])
    expect(await rows(sql`SELECT DISTINCT decision_source, reviewer FROM knowledge_review_decisions`)).toEqual([{ decision_source: 'carried', reviewer: 'system:knowledge-carry' }])
    const [approval] = await rows<{ override_reason: string }>(sql`
      SELECT a.override_reason FROM knowledge_approvals a JOIN knowledge_change_requests c ON c.id = a.change_request_id WHERE c.country_id = 'XA'`)
    expect(approval!.override_reason).toMatch(/dev release of XA \(seq 12, bundle sha256 [0-9a-f]{64}\) by the promotion image sha-test/)
    expect(await rows(sql`SELECT id FROM knowledge_records WHERE country_id IN ('XA', 'XB') AND head_revision_id IS NOT NULL`)).toHaveLength(5)
    // Ingested with the country's mark, labelled as on the source; the legacy copy gone, the unrelated file kept.
    expect(corpus.get(TEXT_FILE)).toMatchObject({ state: 'ingested', countryId: 'XA', docClass: 'law', displayTitle: 'Building Code of Xanadu, edition 2026' })
    expect(corpus.has(LEGACY)).toBe(false)
    expect(corpus.has(UNRELATED)).toBe(true)
  })

  it('changes nothing when it runs again, or on the deployment the bundles came from', async () => {
    const counts = sql`SELECT (SELECT count(*) FROM knowledge_change_requests)::int AS requests, (SELECT count(*) FROM knowledge_release_moves)::int AS moves`
    const before = await rows(counts)
    const again = await carry.runCarry(manifests.parseManifest(manifestWith()), read, ctx())
    expect(again.map((outcome) => outcome.status)).toEqual(['skipped', 'skipped'])
    const onSource = await carry.runCarry(manifests.parseManifest(manifestWith()), read, ctx('dev'))
    expect(onSource.map((outcome) => outcome.status)).toEqual(['skipped', 'skipped'])
    expect(await rows(counts)).toEqual(before)
  })

  it('refuses `carried` on a request nobody carried', async () => {
    const [request] = await rows<{ id: string }>(sql`
      INSERT INTO knowledge_change_requests (id, title, country_id, created_by) VALUES (gen_random_uuid(), 'own', 'XC', 'user_x') RETURNING id`)
    const refused = await rows(
      sql`INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source) VALUES (gen_random_uuid(), ${request!.id}::uuid, 'user_y', 'domain_expert', 'carried')`,
    ).catch((error: unknown) => String((error as { cause?: unknown }).cause ?? error))
    expect(refused).toMatch(/carried only on a change request carried/)
  })
})
