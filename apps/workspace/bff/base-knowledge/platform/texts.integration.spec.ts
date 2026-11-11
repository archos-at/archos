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
 *   country, edition and request it belongs to;
 * - the reviewed bytes are the published bytes: other bytes under a named
 *   file fail the kit, are refused by the plain upload, and are never indexed;
 * - a draft replaces nothing that is released or that a country reads;
 * - an uploaded text needs another person's source check before any approval,
 *   alone included (migration 0222), and a fetched one does not.
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
/** `countries` is the mark a release left on a file: its country's offices read it. */
const corpus = vi.hoisted(() => ({
  files: new Map<string, string>(),
  marks: {} as Record<string, unknown>,
  countries: new Map<string, string>(),
  answers: true,
}))

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
    return { files: [...corpus.files].map(([fileName, currentSha256]) => ({ fileName, state: 'pending', currentSha256, countryId: corpus.countries.get(fileName) ?? null })) }
  },
  uploadKnowledgeBaseDocument: async (file: File) => {
    corpus.files.set(file.name, createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'))
    return { status: 'pending', kind: 'file', fileName: file.name, message: '' }
  },
  reingestKnowledgeBaseDocuments: async (names: string[], marks: Record<string, unknown> = {}) => {
    Object.assign(corpus.marks, marks)
    for (const [name, mark] of Object.entries(marks)) corpus.countries.set(name, String((mark as { countryId?: string }).countryId))
    return { status: 'pending', queued: names.filter((name) => corpus.files.has(name)), unknown: names.filter((name) => !corpus.files.has(name)), message: '' }
  },
  markCorpusFileCountry: async () => undefined,
}))

const url = process.env.TEST_DATABASE_URL
const RUN = Date.now().toString(36)
const BACKEND = 'http://localhost:8000'
const PDF_URL = 'https://www.ris.bka.gv.at/Dokumente/guideline-1.pdf'
const MASTHEAD = 'OIB-Richtlinie 1 Mechanische Festigkeit und Standsicherheit, Ausgabe April 2019, herausgegeben vom OIB'

const PERMISSIONS = [
  'platform:settings:view',
  'platform:knowledge:write',
  'platform:knowledge:review',
  'platform:knowledge:approve_as_domain_expert',
  'platform:knowledge:approve_alone',
]
const person = (userId: string) => ({ userId, email: `${userId}@example.com`, organizationId: fixed.platformOrg, permissions: PERMISSIONS }) as unknown as UserSession
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

  /** The masthead as a capture of `id`: pasted by the operator, or fetched from a configured source (the api tier stands in). */
  async function masthead(id: string, fetched: boolean) {
    if (!fetched) return onboarding.capturePlatformCitation(AUTHOR, id, { basis: 'operator_supplied', url: 'https://www.oib.or.at/', text: MASTHEAD })
    const page = { url: PDF_URL, finalUrl: PDF_URL, contentType: 'text/html', sha256: 'e'.repeat(64), bytes: MASTHEAD.length, text: MASTHEAD, pages: null, note: null, retrievedAt: '2026-11-11T09:00:00.000Z' }
    vi.stubGlobal('fetch', async () => Response.json(page))
    try {
      return await onboarding.capturePlatformCitation(AUTHOR, id, { basis: 'fetched', sourceId: 'at-ris', url: PDF_URL })
    } finally {
      vi.unstubAllGlobals()
    }
  }

  /** A draft with a captured masthead, and a work, an edition and a manifestation citing it; the manifestation names `corpusFile`. */
  async function draft(name: string, corpusFile: string | null = null, fetched = false) {
    const { id } = await service.createPlatformChangeRequest(AUTHOR, { title: `Texts ${name}`, countryId: 'AT' })
    const capture = await masthead(id, fetched)
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

  /** A new draft that proposes the records of `first` again, citing its own capture of the masthead. */
  async function redraft(first: Awaited<ReturnType<typeof draft>>) {
    const { id } = await service.createPlatformChangeRequest(AUTHOR, { title: 'Texts, proposed again', countryId: 'AT' })
    const capture = await masthead(id, false)
    const records = [...first.records, first.manifestation].map((record) =>
      wire.proposedRecordSchema.parse({ ...record, citations: record.citations.map((citation) => ({ ...citation, captureId: capture.captureId })) }),
    )
    await service.proposePlatformRecords(AUTHOR, id, { records, dryRun: false })
    return id
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

  /** A stand-in for the api tier's `corpus-text`: it keeps `sha256` as `fileName` unless the name is held and may not be replaced. */
  function fetcherKeeps(sha256: string) {
    const requested: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requested.push(body)
      const name = String(body.fileName)
      const held = corpus.files.get(name)
      if (held && held !== sha256 && (!body.replace || corpus.countries.has(name))) {
        return Response.json({ detail: `the base corpus keeps a different file as ${name}`, code: 'name_taken' }, { status: 409 })
      }
      corpus.files.set(name, sha256)
      return Response.json({ fileName: name, stored: held !== sha256, url: body.url, finalUrl: body.url, contentType: 'application/pdf', sha256, bytes: 1_000, pages: 3, note: null, retrievedAt: '2026-11-11T09:00:00.000Z' })
    })
    return requested
  }

  describe('the reviewed bytes are the published bytes', () => {
    it('fails the kit and refuses the submit once other bytes sit under the attached file', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('swapped')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const attached = await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('swapped'), 'the reviewed text'))
      expect((await onboarding.validatePlatformChangeRequest(AUTHOR, id)).valid).toBe(true)

      // The bytes are swapped under the name, behind the request's back.
      corpus.files.set(attached.text.corpusFile, 'f'.repeat(64))
      const validation = await onboarding.validatePlatformChangeRequest(AUTHOR, id)
      expect(validation.valid).toBe(false)
      expect(validation.problems).toMatchObject([{ code: 'KC-1', pointer: '/corpusFile', detail: expect.stringContaining('other bytes') }])
      await expect(service.submitPlatformChangeRequest(AUTHOR, id)).rejects.toMatchObject({ status: 422 })

      // Positive control: with the reviewed bytes back, the request validates and submits.
      corpus.files.set(attached.text.corpusFile, attached.text.sha256 as string)
      await expect(service.submitPlatformChangeRequest(AUTHOR, id)).resolves.toEqual({ status: 'submitted' })
    })

    it('indexes nothing and marks no country when the bytes changed between approval and publish', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('late-swap')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const name = pdfName('late-swap')
      await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(name, 'the reviewed text'))
      const outcome = await publish(id)

      corpus.files.set(name, 'f'.repeat(64))
      await indexing.runPlatformTextIndex(fixed.platformOrg, { runId: outcome.indexRuns[0] as string }, { last: true })
      expect((await indexing.readIndexStatus(id)).texts).toMatchObject([{ corpusFile: name, state: 'failed', failure: expect.stringContaining('other bytes') }])
      expect(corpus.marks[name]).toBeUndefined()
      expect(corpus.countries.has(name)).toBe(false)
    })

    it('pins a file a record only names to the bytes the corpus held, and holds it to them', async () => {
      const name = pdfName('only-named')
      corpus.files.set(name, 'a'.repeat(64))
      const { id, records, manifestation } = await draft('only-named', name)
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).texts).toMatchObject([{ corpusFile: name, origin: null, sha256: 'a'.repeat(64) }])

      corpus.files.set(name, 'f'.repeat(64))
      expect((await onboarding.validatePlatformChangeRequest(AUTHOR, id)).problems).toMatchObject([{ code: 'KC-1', detail: expect.stringContaining('other bytes') }])
      // Proposing it again does not quietly take the new bytes for the reviewed ones.
      const again = wire.proposedRecordSchema.parse({ ...manifestation, language: 'de-AT' })
      await expect(service.proposePlatformRecords(AUTHOR, id, { records: [again], dryRun: false })).rejects.toMatchObject({ status: 422 })
    })

    it('refuses a plain corpus upload of other bytes under a file a record names', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('plain-upload')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const file = pdf(pdfName('plain-upload'), 'the reviewed text')
      await texts.uploadPlatformText(AUTHOR, id, manifestationKey, file)

      await expect(texts.refuseReplacingNamedTexts(new Map([[file.name, 'f'.repeat(64)]]))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
      // In a ZIP too: one named file with other bytes refuses the whole upload.
      await expect(texts.refuseReplacingNamedTexts(new Map([[pdfName('unnamed'), 'e'.repeat(64)], [file.name, 'f'.repeat(64)]]))).rejects.toMatchObject({ status: 409 })
      // Positive controls: the same bytes again, and a file no record names.
      await expect(texts.refuseReplacingNamedTexts(new Map([[file.name, await sha(file)]]))).resolves.toBeUndefined()
      await expect(texts.refuseReplacingNamedTexts(new Map([[pdfName('unnamed'), 'e'.repeat(64)]]))).resolves.toBeUndefined()
    })
  })

  describe('a draft replaces nothing that is released', () => {
    it('refuses other bytes under a released file, from an upload and from a URL, also for the record that names it', async () => {
      const first = await draft('released')
      await service.proposePlatformRecords(AUTHOR, first.id, { records: [...first.records, first.manifestation], dryRun: false })
      const name = pdfName('released')
      await texts.uploadPlatformText(AUTHOR, first.id, first.manifestationKey, pdf(name, 'the released text'))
      const outcome = await publish(first.id)
      await indexing.runPlatformTextIndex(fixed.platformOrg, { runId: outcome.indexRuns[0] as string }, { last: true })
      const live = corpus.files.get(name)
      expect(corpus.countries.get(name)).toBe('AT')

      // A new draft of the same country proposes the same manifestation again and tries to put a new text under its file.
      const next = { id: await redraft(first) }
      await expect(texts.uploadPlatformText(AUTHOR, next.id, first.manifestationKey, pdf(name, 'an unreviewed text'))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
      const requested = fetcherKeeps('d'.repeat(64))
      await expect(texts.importPlatformText(AUTHOR, next.id, { manifestationKey: first.manifestationKey, sourceId: 'at-ris', url: PDF_URL, fileName: name })).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
      // This tier already said the name may not be replaced: a release names it.
      expect(requested[0]).toMatchObject({ fileName: name, replace: false })
      expect(corpus.files.get(name)).toBe(live)

      // Positive control: the new text under a new name is attached, and the released file is untouched.
      const renamed = pdf(pdfName('released-2026'), 'an unreviewed text')
      await expect(texts.uploadPlatformText(AUTHOR, next.id, first.manifestationKey, renamed)).resolves.toMatchObject({ status: 'written', stored: true })
      expect(corpus.files.get(name)).toBe(live)
    })

    it('refuses other bytes under a file a country reads although no record names it', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('legacy')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const name = pdfName('legacy-oib')
      corpus.files.set(name, 'a'.repeat(64))
      corpus.countries.set(name, 'AT')
      await expect(texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(name, 'an unreviewed text'))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
      expect(corpus.files.get(name)).toBe('a'.repeat(64))

      // Positive control: a file a rollback left unreleased (ZZ) is read by nobody, and a draft may take its name.
      corpus.countries.set(name, 'ZZ')
      await expect(texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(name, 'an unreviewed text'))).resolves.toMatchObject({ stored: true })
    })

    it('refuses other bytes under a file a submitted request of the same record still names', async () => {
      const first = await draft('in-review')
      await service.proposePlatformRecords(AUTHOR, first.id, { records: [...first.records, first.manifestation], dryRun: false })
      const name = pdfName('in-review')
      await texts.uploadPlatformText(AUTHOR, first.id, first.manifestationKey, pdf(name, 'the text under review'))
      await service.submitPlatformChangeRequest(AUTHOR, first.id)
      const reviewed = corpus.files.get(name)

      const second = { id: await redraft(first) }
      await expect(texts.uploadPlatformText(AUTHOR, second.id, first.manifestationKey, pdf(name, 'another text'))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
      expect(corpus.files.get(name)).toBe(reviewed)
    })
  })

  describe('an upload does not get around four eyes (migration 0222)', () => {
    const alone = { decision: 'approve' as const, role: 'domain_expert' as const, override: { reason: 'Only platform owner on call this week; counsel is back on Monday.' } }

    /** A submitted request whose records cite a fetched page only, so nothing but the manifestation's text can be unchecked. */
    async function submittedWithText(name: string, attach: (id: string, manifestationKey: string) => Promise<unknown>, corpusFile: string | null = null) {
      const { id, records, manifestation, manifestationKey } = await draft(name, corpusFile, true)
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      await attach(id, manifestationKey)
      await service.submitPlatformChangeRequest(AUTHOR, id)
      return id
    }
    /** The expert accepts every claim of the request, vouching for the sources or not. */
    const acceptAll = async (id: string, sourceChecked: boolean) => {
      const view = await service.getPlatformChangeRequest(EXPERT, id)
      await service.reviewPlatformChangeRequest(
        EXPERT,
        id,
        view.revisions.flatMap((revision) => revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const, sourceChecked }))),
      )
    }

    it('refuses to approve alone, or at all, over an uploaded text nobody else checked against its source', async () => {
      const id = await submittedWithText('own-pdf', (request, key) => texts.uploadPlatformText(AUTHOR, request, key, pdf(pdfName('own-pdf'), 'my own OIB-RL 6')))
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked).toBe(true)
      await expect(service.decidePlatformChangeRequest(AUTHOR, id, alone)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('text nobody fetched') })
      // Verdicts that do not vouch for the source change nothing, for the expert's own approval either.
      await acceptAll(id, false)
      await expect(service.decidePlatformChangeRequest(EXPERT, id, { decision: 'approve', role: 'domain_expert' })).rejects.toMatchObject({ status: 409 })
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).status).toBe('submitted')

      // Positive control: once another person checked the text against its source, the request is approved.
      await acceptAll(id, true)
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked).toBe(false)
      await expect(service.decidePlatformChangeRequest(EXPERT, id, { decision: 'approve', role: 'domain_expert' })).resolves.toMatchObject({ status: 'approved' })
    })

    it('holds a text a record only names in the corpus like an uploaded one', async () => {
      const name = pdfName('named-only-eyes')
      corpus.files.set(name, 'a'.repeat(64))
      const id = await submittedWithText('named-only-eyes', async () => undefined, name)
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked).toBe(true)
      await expect(service.decidePlatformChangeRequest(AUTHOR, id, alone)).rejects.toMatchObject({ status: 409 })
    })

    it('counts a text fetched from a configured source as fetched: the author approves alone', async () => {
      const id = await submittedWithText('fetched', async (request, key) => {
        fetcherKeeps('c'.repeat(64))
        await texts.importPlatformText(AUTHOR, request, { manifestationKey: key, sourceId: 'at-ris', url: PDF_URL })
        vi.unstubAllGlobals()
      })
      const view = await service.getPlatformChangeRequest(AUTHOR, id)
      expect(view.texts).toMatchObject([{ origin: 'url', sha256: 'c'.repeat(64) }])
      expect(view.sourcesUnchecked).toBe(false)
      await expect(service.decidePlatformChangeRequest(AUTHOR, id, alone)).resolves.toMatchObject({ status: 'approved' })
    })
  })

  describe('a file name is one record’s', () => {
    it('refuses a plain proposal that names another record’s file, in a batch and across requests', async () => {
      const first = await draft('named-first')
      await service.proposePlatformRecords(AUTHOR, first.id, { records: [...first.records, first.manifestation], dryRun: false })
      const name = pdfName('named-first')
      await texts.uploadPlatformText(AUTHOR, first.id, first.manifestationKey, pdf(name))

      // Another request names the same file: its publish would mark the file for its own record and country.
      const second = await draft('named-second', name)
      const dry = await service.proposePlatformRecords(AUTHOR, second.id, { records: [...second.records, second.manifestation], dryRun: true })
      expect(dry.valid).toBe(false)
      expect(dry.results[2]?.problems).toMatchObject([{ code: 'KC-1', pointer: '/corpusFile', detail: expect.stringContaining('NAME_TAKEN') }])
      await expect(service.proposePlatformRecords(AUTHOR, second.id, { records: [...second.records, second.manifestation], dryRun: false })).rejects.toMatchObject({ status: 422 })

      // Two records of one batch on one file: the second is the problem.
      const free = pdfName('named-in-batch')
      corpus.files.set(free, 'a'.repeat(64))
      const batch = await draft('named-batch', free)
      const twin = wire.proposedRecordSchema.parse({ ...batch.manifestation, key: `${batch.manifestationKey}-twin` })
      const twins = await service.proposePlatformRecords(AUTHOR, batch.id, { records: [...batch.records, batch.manifestation, twin], dryRun: true })
      expect(twins.results[2]?.problems).toEqual([])
      expect(twins.results[3]?.problems).toMatchObject([{ code: 'KC-1', detail: expect.stringContaining('NAME_TAKEN') }])
    })

    it('keeps a fetched text as <manifestationKey>.pdf by default, whatever the URL’s last segment is', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('default-name')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const requested = fetcherKeeps('c'.repeat(64))
      // A malformed percent escape in the path is no error of this tier: the name never comes from the URL.
      const attached = await texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: 'at-ris', url: 'https://www.ris.bka.gv.at/Dokumente/100%zz/richtlinie-1.pdf' })
      expect(requested[0]).toMatchObject({ fileName: `${manifestationKey}.pdf`, replace: true })
      expect(attached.text.corpusFile).toBe(`${manifestationKey}.pdf`)
    })
  })
})
