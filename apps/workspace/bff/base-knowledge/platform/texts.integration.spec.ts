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
 * - the reviewed bytes are the published bytes: a text's file is named after
 *   its bytes and never replaced by any path, the reviewer is served the pinned
 *   bytes or nothing, and other bytes under a named file fail the kit, refuse
 *   the approval and are never indexed;
 * - an uploaded text needs another person's source check before any approval,
 *   alone included (migration 0224), and a fetched one does not.
 *
 * The corpus itself is the backend's and stands in here, as in
 * `platform.integration.spec.ts`.
 */

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserSession } from '@/lib/auth/types'

const fixed = vi.hoisted(() => ({ platformOrg: `org_platform_texts_${Date.now().toString(36)}` }))
/** The base corpus: file name to the sha256 of its bytes, and what a re-ingest was told about each file. */
/** `countries` is the mark a release left on a file: its country's offices read it. */
const corpus = vi.hoisted(() => ({
  files: new Map<string, string>(),
  /** The bytes a real upload stored, by file name: what the corpus serves a reader. */
  bytes: new Map<string, Buffer>(),
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
    const bytes = Buffer.from(await file.arrayBuffer())
    const hash = createHash('sha256').update(bytes).digest('hex')
    // As the api tier: a name it keeps takes the same bytes and no others (`oib_sync.store_and_request`).
    if (corpus.files.has(file.name) && corpus.files.get(file.name) !== hash) throw Object.assign(new Error('NAME_TAKEN'), { status: 409, code: 'NAME_TAKEN' })
    corpus.bytes.set(file.name, bytes)
    corpus.files.set(file.name, hash)
    return { status: 'pending', kind: 'file', fileName: file.name, message: '' }
  },
  reingestKnowledgeBaseDocuments: async (names: string[], marks: Record<string, unknown> = {}) => {
    Object.assign(corpus.marks, marks)
    for (const [name, mark] of Object.entries(marks)) corpus.countries.set(name, String((mark as { countryId?: string }).countryId))
    return { status: 'pending', queued: names.filter((name) => corpus.files.has(name)), unknown: names.filter((name) => !corpus.files.has(name)), message: '' }
  },
  withdrawCorpusFile: async () => undefined,
}))
vi.mock('@/lib/knowledge/source-pdf', () => ({
  streamKnowledgeBaseDocumentAsPlatform: async (name: string) => new Response(new Uint8Array(corpus.bytes.get(name) ?? Buffer.from('')), { headers: { 'Content-Type': 'application/pdf' } }),
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
  let uploadHashes: typeof import('./upload-hashes')
  let knowledge: typeof import('@/lib/knowledge/service')
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
    uploadHashes = await import('./upload-hashes')
    knowledge = await import('@/lib/knowledge/service')
    store = await import('./store')
    release = await import('./release')
    indexing = await import('./indexing')
    wire = await import('./wire')
  })

  afterEach(() => {
    corpus.answers = true
    vi.unstubAllGlobals()
  })

  const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
  /** The name a text is kept under: its manifestation's key and twelve hex digits of its bytes' hash. */
  const nameOf = (manifestationKey: string, hash: string) => `${manifestationKey}-${hash.slice(0, 12)}.pdf`
  /** Put `bytes` under `name` behind everybody's back, as no path of the product does. */
  const tamper = (name: string, bytes: string) => {
    corpus.bytes.set(name, Buffer.from(bytes))
    corpus.files.set(name, sha256(bytes))
  }

  /**
   * A stand-in for the api tier's `corpus-text`: it keeps `content` under the name of its stem and hash, replaces
   * nothing it is not told to, and runs `during` while the fetch is in flight.
   */
  function fetcherKeeps(content: string, during: () => Promise<unknown> = async () => undefined) {
    const requested: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requested.push({ url: String(input), body })
      await during()
      const hash = sha256(content)
      // As the api tier once did, it would take a name and a leave to replace from the caller: this tier sends neither.
      const name = typeof body.fileName === 'string' ? body.fileName : nameOf(String(body.fileStem), hash)
      const held = corpus.files.get(name)
      if (held && held !== hash && body.replace !== true) return Response.json({ detail: `the base corpus keeps a different file as ${name}`, code: 'name_taken' }, { status: 409 })
      corpus.bytes.set(name, Buffer.from(content))
      corpus.files.set(name, hash)
      return Response.json({ fileName: name, stored: !held, url: body.url, finalUrl: body.url, contentType: 'application/pdf', sha256: hash, bytes: content.length, pages: 12, note: null, retrievedAt: '2026-11-11T09:00:00.000Z' })
    })
    return requested
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
  const approve = { decision: 'approve' as const, role: 'domain_expert' as const }

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
      const file = pdf('whatever the operator called it.pdf')
      const name = nameOf(manifestationKey, await sha(file))
      const attached = await texts.uploadPlatformText(AUTHOR, id, manifestationKey, file)
      // The file is named after the manifestation and its bytes, not after the upload.
      expect(attached).toMatchObject({ status: 'written', stored: true, text: { corpusFile: name, origin: 'upload', sha256: await sha(file), attachedBy: AUTHOR.userId } })

      // The reviewer reads the text beside the edition, on the request itself.
      const view = await service.getPlatformChangeRequest(EXPERT, id)
      expect(view.texts).toMatchObject([{ recordId: `manifestation:${manifestationKey}`, editionId: `edition:${key('published-rl-1-2019')}`, corpusFile: name, origin: 'upload' }])

      const outcome = await publish(id)
      expect(outcome.indexRuns).toHaveLength(1)
      await indexing.runPlatformTextIndex(fixed.platformOrg, { runId: outcome.indexRuns[0] as string }, { last: true })
      expect((await indexing.readIndexStatus(id)).texts).toMatchObject([{ corpusFile: name, state: 'queued', failure: null }])
      expect(corpus.marks[name]).toMatchObject({ countryId: 'AT', editionId: `edition:${key('published-rl-1-2019')}` })
    })
  })

  describe('a text from a URL', () => {
    it('is asked of the api tier’s corpus-text route and never fetched or parsed here', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('url')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const requested = fetcherKeeps('the publisher’s PDF')
      const hash = sha256('the publisher’s PDF')
      const fileName = nameOf(manifestationKey, hash)

      // A malformed percent escape in the path is no error of this tier: the name never comes from the URL.
      const odd = 'https://www.ris.bka.gv.at/Dokumente/100%zz/guideline-1.pdf'
      const attached = await texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: 'at-ris', url: odd })

      // One request left this tier: to the api tier, which alone reaches the fetcher. The PDF's own URL was never requested.
      expect(requested.map((request) => request.url)).toEqual([`${BACKEND}/v1/public-sources/corpus-text`])
      // The api tier is given what the file is named after, and no leave to replace anything.
      expect(requested[0]?.body).toEqual({ source: 'at-ris', url: odd, fileStem: manifestationKey })
      expect(attached).toMatchObject({ status: 'written', stored: true, text: { corpusFile: fileName, origin: 'url', sourceId: 'at-ris', url: odd, sha256: hash, pages: 12 } })
      expect((await onboarding.validatePlatformChangeRequest(AUTHOR, id)).valid).toBe(true)

      // A repaired proposal that still names the file keeps where the file came from.
      const repaired = wire.proposedRecordSchema.parse({ ...manifestation, corpusFile: fileName, language: 'de-AT' })
      await service.proposePlatformRecords(AUTHOR, id, { records: [repaired], dryRun: false })
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).texts).toMatchObject([{ corpusFile: fileName, origin: 'url', url: odd }])
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

    it('names nothing when the api tier kept the text under a name that is not its bytes’', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('misnamed')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      vi.stubGlobal('fetch', async () => Response.json({ fileName: `${manifestationKey}.pdf`, stored: true, url: PDF_URL, sha256: 'c'.repeat(64), bytes: 9, pages: 1 }))
      await expect(texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: 'at-ris', url: PDF_URL })).rejects.toMatchObject({ status: 502 })
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
      const held = corpus.files.size
      await expect(texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('late'), 'too late'))).rejects.toMatchObject({ status: 409 })
      expect(corpus.files.size).toBe(held)
    })

    it('takes the same bytes again, and refuses the file’s removal', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('owner')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const attached = await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('owner'), 'the first text'))
      // The same file again changes nothing, whatever it is called this time.
      expect(await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('renamed'), 'the first text'))).toMatchObject({ status: 'unchanged', stored: false })

      await expect(texts.refuseRemovingNamedText(attached.text.corpusFile)).rejects.toMatchObject({ status: 409 })
      // Under any spelling the removal would trim to that name: a leading or trailing space once passed the check
      // and then removed the named file.
      await expect(texts.refuseRemovingNamedText(` ${attached.text.corpusFile}`)).rejects.toMatchObject({ status: 409 })
      await expect(texts.refuseRemovingNamedText(`${attached.text.corpusFile}\t`)).rejects.toMatchObject({ status: 409 })
      // Positive control: a file no record names is removed freely.
      await expect(texts.refuseRemovingNamedText(pdfName('named-by-nobody'))).resolves.toBeUndefined()
    })

    it('refuses to name a text over a proposal made while it was being stored, and keeps that proposal', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('edited-meanwhile')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const edited = wire.proposedRecordSchema.parse({ ...manifestation, language: 'de-AT' })
      // While the fetch is in flight, somebody proposes the manifestation again.
      fetcherKeeps('the publisher’s PDF', () => service.proposePlatformRecords(AUTHOR, id, { records: [edited], dryRun: false }))
      await expect(texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: 'at-ris', url: PDF_URL })).rejects.toMatchObject({ status: 409 })
      const view = await service.getPlatformChangeRequest(AUTHOR, id)
      expect(view.texts).toEqual([])
      expect(view.revisions.find((revision) => revision.recordId === `manifestation:${manifestationKey}`)?.claims).toContainEqual(expect.objectContaining({ path: 'language', value: 'de-AT' }))

      // Attaching again names the bytes already stored, on the proposal as it now stands.
      fetcherKeeps('the publisher’s PDF')
      await expect(texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: 'at-ris', url: PDF_URL })).resolves.toMatchObject({ status: 'written', stored: false })
    })

    it('reads which country, edition and request a file belongs to, and whether it is released', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('placed')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const name = (await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('placed')))).text.corpusFile
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

    it('refuses a plain proposal that names another record’s file, in a batch and across requests', async () => {
      const first = await draft('named-first')
      await service.proposePlatformRecords(AUTHOR, first.id, { records: [...first.records, first.manifestation], dryRun: false })
      const name = (await texts.uploadPlatformText(AUTHOR, first.id, first.manifestationKey, pdf(pdfName('named-first')))).text.corpusFile

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
  })

  describe('the bytes under a named file never change', () => {
    it('keeps another text of the same manifestation as another file, from an upload and from a URL, and leaves the released one alone', async () => {
      const first = await draft('released')
      await service.proposePlatformRecords(AUTHOR, first.id, { records: [...first.records, first.manifestation], dryRun: false })
      const released = (await texts.uploadPlatformText(AUTHOR, first.id, first.manifestationKey, pdf(pdfName('released'), 'the released text'))).text.corpusFile
      const outcome = await publish(first.id)
      await indexing.runPlatformTextIndex(fixed.platformOrg, { runId: outcome.indexRuns[0] as string }, { last: true })
      const live = corpus.files.get(released)
      expect(corpus.countries.get(released)).toBe('AT')

      // A new draft proposes the same manifestation again and attaches a new text: a file of its own.
      const next = await redraft(first)
      const uploaded = await texts.uploadPlatformText(AUTHOR, next, first.manifestationKey, pdf(pdfName('released'), 'a newer text'))
      expect(uploaded).toMatchObject({ status: 'written', stored: true })
      expect(uploaded.text.corpusFile).not.toBe(released)
      fetcherKeeps('the publisher’s newer text')
      const fetched = await texts.importPlatformText(AUTHOR, next, { manifestationKey: first.manifestationKey, sourceId: 'at-ris', url: PDF_URL })
      expect(new Set([released, uploaded.text.corpusFile, fetched.text.corpusFile]).size).toBe(3)
      // What the country's offices read did not move, and no country reads the new files yet.
      expect(corpus.files.get(released)).toBe(live)
      expect(corpus.countries.has(uploaded.text.corpusFile)).toBe(false)
      expect(corpus.countries.has(fetched.text.corpusFile)).toBe(false)
    })

    it('replaces nothing when the name a text would take holds other bytes', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('collision')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const file = pdf(pdfName('collision'), 'the text')
      const name = nameOf(manifestationKey, await sha(file))
      tamper(name, 'somebody put other bytes here')
      const planted = corpus.files.get(name)
      await expect(texts.uploadPlatformText(AUTHOR, id, manifestationKey, file)).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
      expect(corpus.files.get(name)).toBe(planted)
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).texts).toEqual([])
    })

    it('refuses a plain corpus upload that would change a file any revision names, the pinned bytes included', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('plain-upload')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const file = pdf(pdfName('plain-upload'), 'the reviewed text')
      const name = (await texts.uploadPlatformText(AUTHOR, id, manifestationKey, file)).text.corpusFile
      const pinned = await sha(file)

      await expect(texts.refuseReplacingNamedTexts(new Map([[name, 'f'.repeat(64)]]))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
      // In a ZIP too: one named file with other bytes refuses the whole upload.
      await expect(texts.refuseReplacingNamedTexts(new Map([[pdfName('unnamed'), 'e'.repeat(64)], [name, 'f'.repeat(64)]]))).rejects.toMatchObject({ status: 409 })
      // Positive controls: the bytes the corpus keeps (a no-op), and a file no revision names.
      await expect(texts.refuseReplacingNamedTexts(new Map([[name, pinned]]))).resolves.toBeUndefined()
      await expect(texts.refuseReplacingNamedTexts(new Map([[pdfName('unnamed'), 'e'.repeat(64)]]))).resolves.toBeUndefined()

      // Once other bytes sit under the name, even the pinned ones do not go back in: that swap-back is how a
      // reviewer was shown one text and another was published.
      tamper(name, 'other bytes')
      await expect(texts.refuseReplacingNamedTexts(new Map([[name, pinned]]))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })

      // A revision the draft has since replaced still holds its file: any revision, not only the newest.
      tamper(name, 'the reviewed text')
      await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('plain-upload'), 'a later text'))
      await expect(texts.refuseReplacingNamedTexts(new Map([[name, 'f'.repeat(64)]]))).rejects.toMatchObject({ status: 409 })
    })

    it('reads a plain upload as the api tier does: a ZIP sent as a PDF, or holding a member with a NUL in its name, is refused before the corpus is asked', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('disguised')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const name = (await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('disguised'), 'the reviewed text'))).text.corpusFile
      const pinned = corpus.files.get(name)
      /** The plain upload's route: what it would store, the guard on named texts, then the corpus. */
      const plainUpload = async (file: File) => {
        await texts.refuseReplacingNamedTexts(await uploadHashes.uploadedPdfHashes(file))
        return knowledge.uploadKnowledgeBaseDocument(file)
      }
      const other = strToU8('%PDF-1.7\nthe attacker’s text\n%%EOF')

      // The reported attack: this tier read one file, `innocent.pdf`, that no record names; the api tier read the
      // content type, extracted the member and put its bytes under the named text.
      const disguised = new File([zipSync({ [name]: other })], 'innocent.pdf', { type: 'application/zip' })
      await expect(plainUpload(disguised)).rejects.toMatchObject({ status: 400 })
      // The second: fflate keeps the NUL, the api tier's reader cut the name to the named text's.
      const cut = new File([zipSync({ [`${name}\0y.pdf`]: other })], 'texts.zip', { type: 'application/zip' })
      await expect(plainUpload(cut)).rejects.toMatchObject({ status: 400 })
      // An honest ZIP of the same member is refused by the guard, as before.
      await expect(plainUpload(new File([zipSync({ [name]: other })], 'texts.zip'))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })

      expect(corpus.files.get(name)).toBe(pinned)
      expect([...corpus.files.keys()].filter((file) => file.includes('innocent') || file === 'texts.zip')).toEqual([])
      // Positive control: an honest PDF no record names goes through.
      await expect(plainUpload(pdf(pdfName('disguised-unnamed')))).resolves.toMatchObject({ status: 'pending' })
    })

    it('publishes what the reviewer read when a fetch of other bytes finishes after the submit (the reviewed race)', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('race')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      // 1. The author attaches their own PDF A, which pins A.
      const own = 'A: the author’s own PDF'
      const file = (await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('race'), own))).text.corpusFile
      const pinned = sha256(`%PDF-1.7\n${own}\n%%EOF`)

      // 2.–4. A URL import of the publisher's PDF B is in flight when the author submits; B is stored after it.
      const publishers = 'B: the publisher’s PDF'
      fetcherKeeps(publishers, () => service.submitPlatformChangeRequest(AUTHOR, id))
      await expect(texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: 'at-ris', url: PDF_URL })).rejects.toMatchObject({ status: 409 })
      vi.unstubAllGlobals()
      // B was kept, as a file of its own that no record names. The file the request names still holds A.
      expect(corpus.files.get(nameOf(manifestationKey, sha256(publishers)))).toBe(sha256(publishers))
      expect(corpus.files.get(file)).toBe(pinned)
      expect((await service.getPlatformChangeRequest(EXPERT, id)).texts).toMatchObject([{ corpusFile: file, sha256: pinned, origin: 'upload' }])

      // 5. The reviewer opens the text: the pinned bytes, A. They vouch for it and approve.
      const read = Buffer.from(await (await texts.readPlatformText(EXPERT, id, manifestationKey)).arrayBuffer())
      expect(sha256(read)).toBe(pinned)
      expect(read.toString()).toContain(own)
      await acceptAll(id, true)
      await service.decidePlatformChangeRequest(EXPERT, id, approve)

      // 6. The author plain-uploads A under the file's name: a no-op. B under it is refused.
      await expect(texts.refuseReplacingNamedTexts(new Map([[file, pinned]]))).resolves.toBeUndefined()
      await expect(texts.refuseReplacingNamedTexts(new Map([[file, sha256(publishers)]]))).rejects.toMatchObject({ status: 409 })

      // 7. Publish: what goes live under AT is the file the reviewer read, byte for byte.
      const actor = { by: EXPERT.userId, decisionSource: 'app' as const }
      await release.publishChangeRequest(id, 'preview', actor)
      const outcome = await release.publishChangeRequest(id, 'stable', actor)
      await indexing.runPlatformTextIndex(fixed.platformOrg, { runId: outcome.indexRuns[0] as string }, { last: true })
      expect((await indexing.readIndexStatus(id)).texts).toMatchObject([{ corpusFile: file, state: 'queued' }])
      expect(corpus.countries.get(file)).toBe('AT')
      expect(sha256(corpus.bytes.get(file) as Buffer)).toBe(sha256(read))
    })
  })

  describe('the reviewer sees the pinned bytes or nothing', () => {
    it('serves the text while the corpus keeps the bytes the revision names, and a problem once it does not', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('viewer')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      await expect(texts.readPlatformText(EXPERT, id, manifestationKey)).rejects.toMatchObject({ status: 404 })
      const file = (await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('viewer'), 'the text to review'))).text.corpusFile

      const served = await texts.readPlatformText(EXPERT, id, manifestationKey)
      expect(served.headers.get('Content-Type')).toBe('application/pdf')
      expect(await served.text()).toContain('the text to review')

      tamper(file, 'another text under the same name')
      await expect(texts.readPlatformText(EXPERT, id, manifestationKey)).rejects.toMatchObject({ status: 409, code: 'TEXT_CHANGED' })
      await expect(texts.readPlatformText(null, id, manifestationKey)).rejects.toMatchObject({ status: 403 })
    })
  })

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

    it('refuses the approval once other bytes sit under a text of the request', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('decide')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const attached = await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('decide'), 'the reviewed text'))
      await service.submitPlatformChangeRequest(AUTHOR, id)
      await acceptAll(id, true)

      corpus.files.set(attached.text.corpusFile, 'f'.repeat(64))
      await expect(service.decidePlatformChangeRequest(EXPERT, id, approve)).rejects.toMatchObject({
        status: 409,
        details: { problems: [expect.objectContaining({ code: 'KC-1', pointer: '/corpusFile' })] },
      })
      expect((await service.getPlatformChangeRequest(EXPERT, id)).status).toBe('submitted')

      // Positive control: with the pinned bytes there, the same approval is given.
      corpus.files.set(attached.text.corpusFile, attached.text.sha256 as string)
      await expect(service.decidePlatformChangeRequest(EXPERT, id, approve)).resolves.toMatchObject({ status: 'approved' })
    })

    it('indexes nothing and marks no country when the bytes changed between approval and publish', async () => {
      const { id, records, manifestation, manifestationKey } = await draft('late-swap')
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      const name = (await texts.uploadPlatformText(AUTHOR, id, manifestationKey, pdf(pdfName('late-swap'), 'the reviewed text'))).text.corpusFile
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
  })

  describe('an upload does not get around four eyes (migration 0224)', () => {
    const alone = { ...approve, override: { reason: 'Only platform owner on call this week; counsel is back on Monday.' } }

    /** A submitted request whose records cite a fetched page only, so nothing but the manifestation's text can be unchecked. */
    async function submittedWithText(name: string, attach: (id: string, manifestationKey: string) => Promise<unknown>, corpusFile: string | null = null) {
      const { id, records, manifestation, manifestationKey } = await draft(name, corpusFile, true)
      await service.proposePlatformRecords(AUTHOR, id, { records: [...records, manifestation], dryRun: false })
      await attach(id, manifestationKey)
      await service.submitPlatformChangeRequest(AUTHOR, id)
      return id
    }

    it('refuses to approve alone, or at all, over an uploaded text nobody else checked against its source', async () => {
      const id = await submittedWithText('own-pdf', (request, key) => texts.uploadPlatformText(AUTHOR, request, key, pdf(pdfName('own-pdf'), 'my own OIB-RL 6')))
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked).toBe(true)
      await expect(service.decidePlatformChangeRequest(AUTHOR, id, alone)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('text nobody fetched from a reviewed source') })
      // Verdicts that do not vouch for the source change nothing, for the expert's own approval either.
      await acceptAll(id, false)
      await expect(service.decidePlatformChangeRequest(EXPERT, id, approve)).rejects.toMatchObject({ status: 409 })
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).status).toBe('submitted')

      // Positive control: once another person checked the text against its source, the request is approved.
      await acceptAll(id, true)
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked).toBe(false)
      await expect(service.decidePlatformChangeRequest(EXPERT, id, approve)).resolves.toMatchObject({ status: 'approved' })
    })

    it('holds a text a record only names in the corpus like an uploaded one', async () => {
      const name = pdfName('named-only-eyes')
      corpus.files.set(name, 'a'.repeat(64))
      const id = await submittedWithText('named-only-eyes', async () => undefined, name)
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked).toBe(true)
      await expect(service.decidePlatformChangeRequest(AUTHOR, id, alone)).rejects.toMatchObject({ status: 409 })
    })

    it('takes an uploaded text for fetched once the same bytes are imported from a reviewed source', async () => {
      const content = 'the publisher’s PDF, uploaded first'
      const id = await submittedWithText('upload-then-import', async (request, key) => {
        await texts.uploadPlatformText(AUTHOR, request, key, new File([content], 'mine.pdf', { type: 'application/pdf' }))
        expect((await service.getPlatformChangeRequest(AUTHOR, request)).texts).toMatchObject([{ origin: 'upload', countsAsFetched: false }])
        fetcherKeeps(content)
        // The same bytes and the same proposal, and still a new revision: where the text came from changed.
        await expect(texts.importPlatformText(AUTHOR, request, { manifestationKey: key, sourceId: 'at-ris', url: PDF_URL })).resolves.toMatchObject({ status: 'written', stored: false })
        vi.unstubAllGlobals()
      })
      const view = await service.getPlatformChangeRequest(AUTHOR, id)
      expect(view.texts).toMatchObject([{ origin: 'url', sourceOrigin: 'built_in', countsAsFetched: true, sha256: sha256(content) }])
      expect(view.sourcesUnchecked).toBe(false)
    })

    it('counts a text fetched from a configured source as fetched: the author approves alone', async () => {
      const id = await submittedWithText('fetched', async (request, key) => {
        fetcherKeeps('the publisher’s PDF, fetched')
        await texts.importPlatformText(AUTHOR, request, { manifestationKey: key, sourceId: 'at-ris', url: PDF_URL })
        vi.unstubAllGlobals()
      })
      const view = await service.getPlatformChangeRequest(AUTHOR, id)
      expect(view.texts).toMatchObject([{ origin: 'url', sha256: sha256('the publisher’s PDF, fetched') }])
      expect(view.sourcesUnchecked).toBe(false)
      await expect(service.decidePlatformChangeRequest(AUTHOR, id, alone)).resolves.toMatchObject({ status: 'approved' })
    })
  })

  describe('a fetch counts only through a source somebody else has seen (migration 0224)', () => {
    const alone = { ...approve, override: { reason: 'Only platform owner on call this week; counsel is back on Monday.' } }
    const OWN_HOST = 'attacker.example'
    const OWN_TERRITORY = 'AT-TXS'
    const OWN_URL = `https://${OWN_HOST}/oib-rl-6.pdf`
    const OWN_PAGE = 'OIB-Richtlinie 6 Energieeinsparung und Wärmeschutz, as its author wrote it on a host of their own'

    /** A source record whose one host is its author's own. */
    const ownSource = (sourceKey: string, captureId: string, title = 'A host of the author’s own') =>
      wire.proposedRecordSchema.parse({
        type: 'source',
        key: sourceKey,
        title,
        territoryId: OWN_TERRITORY,
        protocol: 'web_document',
        format: 'pdf_document',
        hosts: [OWN_HOST],
        terms: { url: `https://${OWN_HOST}/terms`, licence: 'public_open', checked: '2026-11-01' },
        monitor: { kind: 'none' },
        access: { documents: [{ id: 'rl-6', url: OWN_URL, title: 'OIB-Richtlinie 6' }] },
        engine: { title: 'OIB-Richtlinie 6' },
        fixtures: [
          {
            name: 'rl-6',
            operation: 'document',
            args: { id: 'rl-6' },
            responses: { [OWN_URL]: { contentType: 'application/pdf', encoding: 'base64', body: Buffer.from('%PDF-1.7 rl-6').toString('base64') } },
            expect: { contains: ['OIB-Richtlinie 6'] },
          },
        ],
        citations: [{ captureId, quote: 'herausgegeben vom OIB' }],
      })

    /**
     * The api tier, for the three routes a fetch through a source asks: KC-7's check passes, a capture answers
     * `OWN_PAGE`, a text is kept as the fetcher's stand-in keeps it. `asked` is every body it was sent. It stays up
     * until the case ends: a submit runs KC-7 on the request's sources again.
     */
    function apiTier(content: string) {
      const asked: { path: string; body: Record<string, unknown> }[] = []
      vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        asked.push({ path, body })
        if (path === '/v1/public-sources/check') return Response.json({ valid: true, problems: [], fixtures: [] })
        const facts = { url: body.url, finalUrl: body.url, note: null, retrievedAt: '2026-11-11T09:00:00.000Z' }
        if (path === '/v1/public-sources/capture') {
          return Response.json({ ...facts, contentType: 'text/html', sha256: sha256(OWN_PAGE), bytes: OWN_PAGE.length, text: OWN_PAGE, pages: null })
        }
        const hash = sha256(content)
        const name = nameOf(String(body.fileStem), hash)
        corpus.bytes.set(name, Buffer.from(content))
        corpus.files.set(name, hash)
        return Response.json({ ...facts, fileName: name, stored: true, contentType: 'application/pdf', sha256: hash, bytes: content.length, pages: 12 })
      })
      return asked
    }

    /** A draft with the usual records (their masthead fetched from the built-in at-ris) and a source of the author's own. */
    async function draftWithOwnSource(name: string) {
      const drafted = await draft(name, null, true)
      const sourceKey = `at-own-${name}-${RUN}`
      const [capture] = (await service.getPlatformChangeRequest(AUTHOR, drafted.id)).captures
      apiTier('')
      // A source lies in a territory (KC-1): a code of this suite's own, so no other suite's territory is touched.
      const territory = wire.proposedRecordSchema.parse({
        type: 'territory',
        id: OWN_TERRITORY,
        kind: 'state',
        name: 'Standsicherheit',
        citations: [{ captureId: capture!.captureId, quote: 'Mechanische Festigkeit und Standsicherheit' }],
      })
      await service.proposePlatformRecords(AUTHOR, drafted.id, {
        records: [...drafted.records, drafted.manifestation, territory, ownSource(sourceKey, capture!.captureId)],
        dryRun: false,
      })
      return { ...drafted, sourceKey }
    }

    it('holds a text fetched through a source its own draft proposes: the author does not approve it alone', async () => {
      const { id, manifestationKey, sourceKey } = await draftWithOwnSource('own-host-text')
      const asked = apiTier('my own OIB-RL 6, served from my own host')
      await texts.importPlatformText(AUTHOR, id, { manifestationKey, sourceId: sourceKey, url: OWN_URL })
      // The draft's source is usable for the test fetch (ADR-0174): the api tier was handed its configuration.
      expect(asked.find((call) => call.path === '/v1/public-sources/corpus-text')?.body).toMatchObject({ source: sourceKey, config: expect.objectContaining({ hosts: [OWN_HOST] }) })
      await service.submitPlatformChangeRequest(AUTHOR, id)

      const view = await service.getPlatformChangeRequest(AUTHOR, id)
      expect(view.texts).toMatchObject([{ origin: 'url', sourceId: sourceKey, sourceOrigin: 'draft', countsAsFetched: false }])
      expect(view.sourcesUnchecked).toBe(true)
      await expect(service.decidePlatformChangeRequest(AUTHOR, id, alone)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('reviewed source') })
      await acceptAll(id, false)
      await expect(service.decidePlatformChangeRequest(EXPERT, id, approve)).rejects.toMatchObject({ status: 409 })
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).status).toBe('submitted')

      // Positive control: another person compared the text with the publisher's, and approves.
      await acceptAll(id, true)
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked).toBe(false)
      await expect(service.decidePlatformChangeRequest(EXPERT, id, approve)).resolves.toMatchObject({ status: 'approved' })
    })

    it('holds a page captured through a source its own draft proposes, as it holds a pasted one', async () => {
      const { id, sourceKey } = await draftWithOwnSource('own-host-page')
      apiTier('')
      const capture = await onboarding.capturePlatformCitation(AUTHOR, id, { basis: 'fetched', sourceId: sourceKey, url: `https://${OWN_HOST}/law` })
      expect(capture).toMatchObject({ basis: 'fetched', sourceId: sourceKey, sourceOrigin: 'draft', countsAsFetched: false })
      const cited = wire.proposedRecordSchema.parse({
        type: 'work',
        key: key('own-host-page-rl-6'),
        kind: 'guideline',
        title: 'Energieeinsparung und Wärmeschutz',
        designation: 'OIB-Richtlinie 6',
        citations: [{ captureId: capture.captureId, quote: 'OIB-Richtlinie 6 Energieeinsparung und Wärmeschutz' }],
      })
      await service.proposePlatformRecords(AUTHOR, id, { records: [cited], dryRun: false })
      await service.submitPlatformChangeRequest(AUTHOR, id)

      const view = await service.getPlatformChangeRequest(AUTHOR, id)
      // Positive control inside the same request: the masthead, fetched from the built-in at-ris, counts.
      expect(view.captures.map((entry) => [entry.sourceOrigin, entry.countsAsFetched])).toEqual([
        ['built_in', true],
        ['draft', false],
      ])
      expect(view.sourcesUnchecked).toBe(true)
      await expect(service.decidePlatformChangeRequest(AUTHOR, id, alone)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('reviewed source') })

      await acceptAll(id, true)
      expect((await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked).toBe(false)
      await expect(service.decidePlatformChangeRequest(EXPERT, id, approve)).resolves.toMatchObject({ status: 'approved' })
    })

    it('counts a fetch through a source record once two people released it, and not while one person released it alone', async () => {
      // Released by four eyes: the author proposed it, the expert approved and published.
      const reviewed = await draftWithOwnSource('reviewed-source')
      await publish(reviewed.id)

      const next = await draft('through-reviewed', null, true)
      await service.proposePlatformRecords(AUTHOR, next.id, { records: [...next.records, next.manifestation], dryRun: false })
      apiTier('the publisher’s PDF, fetched through a released source')
      await texts.importPlatformText(AUTHOR, next.id, { manifestationKey: next.manifestationKey, sourceId: reviewed.sourceKey, url: OWN_URL })
      const page = await onboarding.capturePlatformCitation(AUTHOR, next.id, { basis: 'fetched', sourceId: reviewed.sourceKey, url: `https://${OWN_HOST}/law` })
      expect(page).toMatchObject({ sourceOrigin: 'released', countsAsFetched: true })
      await service.submitPlatformChangeRequest(AUTHOR, next.id)
      const view = await service.getPlatformChangeRequest(AUTHOR, next.id)
      expect(view.texts).toMatchObject([{ origin: 'url', sourceOrigin: 'released', countsAsFetched: true }])
      expect(view.sourcesUnchecked).toBe(false)
      await expect(service.decidePlatformChangeRequest(AUTHOR, next.id, alone)).resolves.toMatchObject({ status: 'approved' })

      // Released by its author alone, its second review still owed: the two steps do not add up to one person's publish.
      const lone = await draftWithOwnSource('lone-source')
      await service.submitPlatformChangeRequest(AUTHOR, lone.id)
      await service.decidePlatformChangeRequest(AUTHOR, lone.id, alone)
      const actor = { by: AUTHOR.userId, decisionSource: 'app' as const }
      await release.publishChangeRequest(lone.id, 'preview', actor)
      await release.publishChangeRequest(lone.id, 'stable', actor)

      const after = await draft('through-lone', null, true)
      await service.proposePlatformRecords(AUTHOR, after.id, { records: [...after.records, after.manifestation], dryRun: false })
      apiTier('my own text again, through the source I released alone')
      await texts.importPlatformText(AUTHOR, after.id, { manifestationKey: after.manifestationKey, sourceId: lone.sourceKey, url: OWN_URL })
      await service.submitPlatformChangeRequest(AUTHOR, after.id)
      expect((await service.getPlatformChangeRequest(AUTHOR, after.id)).texts).toMatchObject([{ sourceOrigin: 'released', countsAsFetched: false }])
      await expect(service.decidePlatformChangeRequest(AUTHOR, after.id, alone)).rejects.toMatchObject({ status: 409 })
    })

    it('holds a fetch again once the release of its source is rolled back, and not when a newer release supersedes it', async () => {
      /** A submitted request whose text was fetched through the released source `sourceKey`. */
      const submittedThrough = async (name: string, sourceKey: string) => {
        const drafted = await draft(name, null, true)
        await service.proposePlatformRecords(AUTHOR, drafted.id, { records: [...drafted.records, drafted.manifestation], dryRun: false })
        apiTier(`the publisher’s PDF for ${name}`)
        await texts.importPlatformText(AUTHOR, drafted.id, { manifestationKey: drafted.manifestationKey, sourceId: sourceKey, url: OWN_URL })
        await service.submitPlatformChangeRequest(AUTHOR, drafted.id)
        return drafted.id
      }
      const unchecked = async (id: string) => (await service.getPlatformChangeRequest(AUTHOR, id)).sourcesUnchecked

      // The source's first release, by four eyes, and a fetch through it.
      const first = await draftWithOwnSource('standing-source')
      await publish(first.id)
      const throughFirst = await submittedThrough('through-first-release', first.sourceKey)
      expect(await unchecked(throughFirst)).toBe(false)

      // A newer release of the same source supersedes that revision and takes nothing back.
      const again = await draft('standing-source-again', null, true)
      const [capture] = (await service.getPlatformChangeRequest(AUTHOR, again.id)).captures
      apiTier('')
      await service.proposePlatformRecords(AUTHOR, again.id, {
        records: [...again.records, again.manifestation, ownSource(first.sourceKey, capture!.captureId, 'The same host, retitled')],
        dryRun: false,
      })
      await publish(again.id)
      expect(await unchecked(throughFirst)).toBe(false)
      const throughSecond = await submittedThrough('through-second-release', first.sourceKey)
      expect(await unchecked(throughSecond)).toBe(false)

      // The newer release is rolled back: what was fetched through it is nobody's fetch again, already submitted or not.
      await release.rollbackChangeRequest(again.id, 'The retitled source was wrong.', { by: EXPERT.userId, decisionSource: 'app' })
      expect((await service.getPlatformChangeRequest(AUTHOR, throughSecond)).texts).toMatchObject([{ sourceOrigin: 'released', countsAsFetched: false }])
      expect(await unchecked(throughSecond)).toBe(true)
      await expect(service.decidePlatformChangeRequest(AUTHOR, throughSecond, alone)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('reviewed source') })
      // The first release stands again and was never rolled back itself: its fetch still counts, and is approved alone.
      expect(await unchecked(throughFirst)).toBe(false)
      await expect(service.decidePlatformChangeRequest(AUTHOR, throughFirst, alone)).resolves.toMatchObject({ status: 'approved' })
    })
  })
})
