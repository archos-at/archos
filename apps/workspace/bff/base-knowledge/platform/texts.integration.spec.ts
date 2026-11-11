/**
 * @vitest-environment node
 *
 * Texts attached in the change request (ADR-0165, "Texts are attached in the
 * request") against a REAL Postgres, through the services the routes and the
 * door call:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/platform/texts.integration.spec.ts
 *
 * The outcomes, each with its positive control:
 * - the ordering trap is gone: a manifestation naming a file the base corpus
 *   does not hold is never written, validated or submitted, and one whose text
 *   was attached is published with an indexing run the corpus accepts, marked
 *   with the request's country;
 * - a text from a URL is asked of the api tier's `corpus-text` route, the one
 *   that fetches and reads through the fetcher: this tier requests nothing
 *   else and never the URL itself;
 * - a file is one record's text: another record cannot replace it, nobody
 *   removes it while a record names it, and the corpus page reads which
 *   country, edition and request it belongs to.
 *
 * The corpus itself is the backend's and stands in here, as in
 * `platform.integration.spec.ts`.
 */

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserSession } from '@/lib/auth/types'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_texts_${Date.now().toString(36)}` }))
/** The base corpus: file name to the sha256 of its bytes, and what a re-ingest was told about each file. */
const corpus = vi.hoisted(() => ({ files: new Map<string, string>(), marks: {} as Record<string, unknown>, answers: true }))

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
vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseStatus: async () => {
    if (!corpus.answers) throw new Error('Knowledge backend unreachable')
    return { files: [...corpus.files].map(([fileName, currentSha256]) => ({ fileName, state: 'pending', currentSha256 })) }
  },
  uploadKnowledgeBaseDocument: async (file: File) => {
    corpus.files.set(file.name, createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'))
    return { status: 'pending', kind: 'file', fileName: file.name, message: '' }
  },
  reingestKnowledgeBaseDocuments: async (names: string[], marks: Record<string, unknown> = {}) => {
    Object.assign(corpus.marks, marks)
    return { status: 'pending', queued: names.filter((name) => corpus.files.has(name)), unknown: names.filter((name) => !corpus.files.has(name)), message: '' }
  },
  markCorpusFileCountry: async () => undefined,
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const BACKEND = 'http://localhost:8000'
const PDF_URL = 'https://www.ris.bka.gv.at/Dokumente/guideline-1.pdf'
const MASTHEAD = 'OIB-Richtlinie 1 Mechanische Festigkeit und Standsicherheit, Ausgabe April 2019, herausgegeben vom OIB'

const person = (userId: string) =>
  ({ userId, email: `${userId}@example.com`, organizationId: fixed.platformOrg, permissions: ['platform:settings:view', 'platform:knowledge:write', 'platform:knowledge:review'] }) as unknown as UserSession
const AUTHOR = person(`user_texts_author_${RUN}`)
const EXPERT = person(`user_texts_expert_${RUN}`)

const pdf = (name: string, body = 'guideline 1') => new File([`%PDF-1.7\n${body}\n%%EOF`], name, { type: 'application/pdf' })
const sha = async (file: File) => createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')

describe('the texts suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('texts attached in the change request (ADR-0165)', () => {
  let service: typeof import('./service')
  let onboarding: typeof import('./onboarding')
  let texts: typeof import('./texts')
  let store: typeof import('./store')
  let release: typeof import('./release')
  let indexing: typeof import('./indexing')
  let wire: typeof import('./wire')
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const key = (name: string) => `${name}-${RUN}`
  const pdfName = (name: string) => `${name}-${RUN}.pdf`

  /** A draft with a captured masthead, and a work, an edition and a manifestation citing it; the manifestation names `corpusFile`. */
  async function draft(name: string, corpusFile: string | null = null) {
    const { id } = await service.createPlatformChangeRequest(AUTHOR, { title: `Texts ${name}`, countryId: 'AT' })
    const capture = await onboarding.capturePlatformCitation(AUTHOR, id, { basis: 'operator_supplied', url: 'https://www.oib.or.at/', text: MASTHEAD })
    const cite = (quote: string) => [{ captureId: capture.captureId, quote }]
    const records = [
      { type: 'work', key: key(`${name}-rl-1`), kind: 'guideline', title: 'Mechanische Festigkeit und Standsicherheit', designation: 'OIB-Richtlinie 1', citations: cite('OIB-Richtlinie 1 Mechanische Festigkeit') },
      { type: 'edition', key: key(`${name}-rl-1-2019`), workKey: key(`${name}-rl-1`), label: 'April 2019', citations: cite('Ausgabe April 2019, herausgegeben') },
    ].map((record) => wire.proposedRecordSchema.parse(record))
    const manifestation = wire.proposedRecordSchema.parse({
      type: 'manifestation',
      key: key(`${name}-rl-1-2019-text`),
      editionKey: key(`${name}-rl-1-2019`),
      licenceClass: 'public_open',
      corpusFile,
      citations: cite('herausgegeben vom OIB'),
    })
    return { id, records, manifestation, manifestationKey: key(`${name}-rl-1-2019-text`) }
  }

  /** Submitted, every claim accepted and approved by the expert, then published to preview and stable. */
  async function publish(id: string) {
    await service.submitPlatformChangeRequest(AUTHOR, id)
    const view = await store.readChangeRequest(id)
    await store.platformTransaction(async (tx) => {
      const decisions = view!.revisions.flatMap((revision) =>
        revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const, sourceChecked: true })),
      )
      await store.insertReviewDecisions(tx, id, { by: EXPERT.userId, decisionSource: 'app' }, decisions)
      await store.insertApproval(tx, { changeRequestId: id, approver: EXPERT.userId, role: 'domain_expert', decisionSource: 'app' })
      await store.setChangeRequestStatus(tx, id, 'approved', 'decidedAt')
    })
    const actor = { by: EXPERT.userId, decisionSource: 'app' as const }
    await release.publishChangeRequest(id, 'preview', actor)
    return release.publishChangeRequest(id, 'stable', actor)
  }

  const revisionsOf = (id: string) =>
    withPlatformAccess('texts spec', () => db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM knowledge_revisions WHERE change_request_id = ${id}::uuid`))

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    process.env.BACKEND_URL = BACKEND
    process.env.INTERNAL_API_TOKEN = 'texts-spec-internal-token'
    withPlatformAccess = (await import('@/lib/db/tenant-context')).withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    service = await import('./service')
    onboarding = await import('./onboarding')
    texts = await import('./texts')
    store = await import('./store')
    release = await import('./release')
    indexing = await import('./indexing')
    wire = await import('./wire')
  })

  afterEach(() => {
    corpus.answers = true
    vi.unstubAllGlobals()
  })

  describe('the ordering trap', () => {
    it('never writes a manifestation that names a file the base corpus does not hold', async () => {
      const { id, records, manifestation } = await draft('trap', pdfName('never-uploaded'))
      const dry = await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: true })
      expect(dry.valid).toBe(false)
      expect(dry.results[2]?.problems).toMatchObject([{ code: 'KC-1', pointer: '/corpusFile', hint: expect.stringContaining('platform-knowledge-text-import') }])
      expect(dry.results.slice(0, 2).every((result) => result.status === 'valid')).toBe(true)

      await expect(service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })).rejects.toMatchObject({ status: 422 })
      expect((await revisionsOf(id))[0]?.n).toBe(0)
    })

    it('fails closed when the corpus cannot say whether it holds the file', async () => {
      corpus.files.set(pdfName('held'), 'a'.repeat(64))
      const { id, records, manifestation } = await draft('closed', pdfName('held'))
      corpus.answers = false
      const dry = await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: true })
      expect(dry.results[2]?.problems).toMatchObject([{ code: 'KC-1', pointer: '/corpusFile', detail: expect.stringContaining('could not be checked') }])
      // Positive control: with the corpus answering, the same batch is clean.
      corpus.answers = true
      expect((await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: true })).valid).toBe(true)
    })

    it('refuses to validate or submit a request whose text has left the corpus since', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('left')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const attached = await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('left')))
      expect((await onboarding.validatePlatformChangeRequest(AUTHOR, id)).valid).toBe(true)

      corpus.files.delete(attached.text.corpusFile)
      const validation = await onboarding.validatePlatformChangeRequest(AUTHOR, id)
      expect(validation.valid).toBe(false)
      expect(validation.problems).toMatchObject([{ code: 'KC-1', pointer: '/corpusFile' }])
      await expect(service.submitPlatformChangeRequest(AUTHOR, id)).rejects.toMatchObject({ status: 422 })
    })

    it('publishes an attached text with an indexing run the corpus accepts, under the request’s country', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('published')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const file = pdf(pdfName('oib-rl-1-2019'))
      const attached = await texts.uploadPlatformText(AUTHOR, id, manifestationKey, file)
      expect(attached).toMatchObject({ status: 'written', stored: true, text: { corpusFile: file.name, origin: 'upload', sha256: await sha(file), attachedBy: AUTHOR.userId } })

      // The reviewer reads the text beside the edition, on the request itself.
      const view = await service.getPlatformChangeRequest(EXPERT, id)
      expect(view.texts).toMatchObject([{ recordId: `manifestation:${manifestationKey}`, editionId: `edition:${key('published-rl-1-2019')}`, corpusFile: file.name, origin: 'upload' }])

      const outcome = await publish(id)
      expect(outcome.indexRuns).toHaveLength(1)
      await indexing.runPlatformTextIndex(fixed.platformOrg, { runId: outcome.indexRuns[0] as string }, { last: true })
      expect((await indexing.readIndexStatus(id)).texts).toMatchObject([{ corpusFile: file.name, state: 'queued', failure: null }])
      expect(corpus.marks[file.name]).toMatchObject({ countryId: 'AT', editionId: `edition:${key('published-rl-1-2019')}` })
    })
  })

  describe('a text from a URL', () => {
    it('is asked of the api tier’s corpus-text route and never fetched or parsed here', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('url')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const fileName = pdfName('guideline-1')
      const requested: { url: string; body: Record<string, unknown> }[] = []
      vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        requested.push({ url: String(input), body })
        corpus.files.set(String(body.fileName), 'c'.repeat(64))
        return Response.json({ fileName: body.fileName, stored: true, url: body.url, finalUrl: body.url, contentType: 'application/pdf', sha256: 'c'.repeat(64), bytes: 1_400_000, pages: 12, note: null, retrievedAt: '2026-11-11T09:00:00.000Z' })
      })

      const attached = await texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: 'at-ris', url: PDF_URL, fileName })

      // One request left this tier: to the api tier, which alone reaches the fetcher. The PDF's own URL was never requested.
      expect(requested.map((request) => request.url)).toEqual([`${BACKEND}/v1/public-sources/corpus-text`])
      expect(requested[0]?.body).toMatchObject({ source: 'at-ris', url: PDF_URL, fileName, replace: true })
      expect(attached).toMatchObject({ status: 'written', stored: true, text: { corpusFile: fileName, origin: 'url', sourceId: 'at-ris', url: PDF_URL, sha256: 'c'.repeat(64), pages: 12, bytes: 1_400_000 } })
      expect((await onboarding.validatePlatformChangeRequest(AUTHOR, id)).valid).toBe(true)

      // A repaired proposal that still names the file keeps where the file came from.
      const repaired = wire.proposedRecordSchema.parse({ ...manifestation, corpusFile: fileName, language: 'de-AT' })
      await service.proposePlatformRecords(AUTHOR, id, { records: [repaired], dryRun: false })
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).texts).toMatchObject([{ corpusFile: fileName, origin: 'url', url: PDF_URL }])
    })

    it('answers the api tier’s refusal by its code and writes nothing', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('refused')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const before = (await revisionsOf(id))[0]?.n
      vi.stubGlobal('fetch', async () => Response.json({ detail: 'the URL answers no PDF', code: 'not_a_pdf' }, { status: 422 }))
      await expect(texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: 'at-ris', url: PDF_URL })).rejects.toMatchObject({ status: 422, code: 'NOT_A_PDF' })
      expect((await revisionsOf(id))[0]?.n).toBe(before)
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).texts).toEqual([])
    })
  })

  describe('a file is one record’s text', () => {
    it('attaches only to a manifestation of a draft', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('draft-only')
      await expect(texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('early')))).rejects.toMatchObject({ status: 404 })
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      await expect(texts.uploadPlatformText(AUTHOR, id, manifestationKey, new File(['x'], 'notes.txt'))).rejects.toMatchObject({ status: 422 })
      await service.submitPlatformChangeRequest(AUTHOR, id)
      await expect(texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('late')))).rejects.toMatchObject({ status: 409 })
      expect(corpus.files.has(pdfName('late'))).toBe(false)
    })

    it('does not let another record replace it, takes the same bytes again, and refuses its removal', async () => {
      const first = await draft('owner')
      await service.proposePlatformRecords(AUTHOR, first.id, { records: [...first.records, first.manifestation], dryRun: false })
      const name = pdfName('shared-name')
      await texts.uploadPlatformText(AUTHOR, first.id, first.manifestationKey, pdf(name, 'the first text'))
      const kept = corpus.files.get(name)

      // The same file again changes nothing.
      expect(await texts.uploadPlatformText(AUTHOR, first.id, first.manifestationKey, pdf(name, 'the first text'))).toMatchObject({ status: 'unchanged', stored: false })

      const second = await draft('other')
      await service.proposePlatformRecords(AUTHOR, second.id, { records: [...second.records, second.manifestation], dryRun: false })
      await expect(texts.uploadPlatformText(AUTHOR, second.id, second.manifestationKey, pdf(name, 'another text'))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
      expect(corpus.files.get(name)).toBe(kept)

      await expect(texts.refuseRemovingNamedText(name)).rejects.toMatchObject({ status: 409 })
      // Positive control: a file no record names is removed freely, and the record's own text is replaced by its own request.
      await expect(texts.refuseRemovingNamedText(pdfName('named-by-nobody'))).resolves.toBeUndefined()
      expect(await texts.uploadPlatformText(AUTHOR, first.id, first.manifestationKey, pdf(name, 'the corrected text'))).toMatchObject({ status: 'written', stored: true })
    })

    it('reads which country, edition and request a file belongs to, and whether it is released', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('placed')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const name = pdfName('placed')
      await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(name))
      const placed = async () => (await texts.listPlatformTexts(EXPERT, { countryId: 'AT', limit: 500 })).texts.find((text) => text.corpusFile === name)

      expect(await placed()).toMatchObject({
        countryId: 'AT',
        recordId: `manifestation:${manifestationKey}`,
        editionLabel: 'April 2019',
        workTitle: 'Mechanische Festigkeit und Standsicherheit',
        released: false,
        changeRequestId: id,
        changeRequestStatus: 'draft',
      })
      await publish(id)
      expect(await placed()).toMatchObject({ released: true, changeRequestId: id, changeRequestStatus: 'published' })
      expect((await texts.listPlatformTexts(EXPERT, { countryId: 'DE' })).texts.some((text) => text.corpusFile === name)).toBe(false)
    })
  })
})
