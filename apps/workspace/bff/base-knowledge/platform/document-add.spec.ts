import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'

/**
 * "Add a document" as a service (`document-add.ts`): the order of the steps and what each refusal says, with the
 * store, the capture and the text calls stubbed. What each step checks itself is the spec of that step.
 */

vi.mock('server-only', () => ({}))

const PDF_SHA = 'a'.repeat(64)
const TEXT = 'Guideline RL 1 Mechanical resistance and stability, edition April 2019 issued by the institute'
const db = { works: [] as unknown[], editions: [] as unknown[], drafts: [] as unknown[], held: null as unknown, captures: [] as { captureId: string; text: string | null }[] }

/** A drizzle query that answers rows whatever it is chained with: works when it selects a kind, editions otherwise. */
function rows(answer: unknown[]): object {
  const query: object = new Proxy({}, { get: (_target, key) => (key === 'then' ? (resolve: (value: unknown[]) => void) => resolve(answer) : () => query) })
  return query
}
const tx = { select: (fields: Record<string, unknown>) => rows('kind' in fields ? db.works : db.editions) }

const calls = vi.hoisted(() => ({
  create: vi.fn(),
  propose: vi.fn(),
  capture: vi.fn(),
  importText: vi.fn(),
  uploadText: vi.fn(),
  listDrafts: vi.fn(),
}))

vi.mock('./service-gate', () => ({ requirePlatform: async (session: UserSession) => session }))
vi.mock('./store', () => ({ platformTransaction: async (run: (value: unknown) => unknown) => run(tx), listChangeRequests: calls.listDrafts }))
vi.mock('./service', () => ({ createPlatformChangeRequest: calls.create, proposePlatformRecords: calls.propose }))
vi.mock('./onboarding', () => ({ capturePlatformCitation: calls.capture }))
vi.mock('./texts', () => ({ importPlatformText: calls.importText, uploadPlatformText: calls.uploadText }))
vi.mock('./text-store', () => ({ draftManifestation: async () => db.held }))
vi.mock('./source-service', () => ({
  platformSourceStatus: async () => ({
    sources: [{ countryId: 'XX', state: 'active', sourceKey: 'xx-publisher', hosts: [{ host: 'publisher.example', state: 'active' }] }],
  }),
}))
vi.mock('./captures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./captures')>()),
  captureViews: async () => db.captures.map(({ text: _text, ...view }) => view),
  capturesOf: async (_tx: unknown, _id: string, ids: string[]) => new Map(db.captures.filter((one) => ids.includes(one.captureId)).map((one) => [one.captureId, { text: one.text, basis: 'fetched' }])),
}))

const { addPlatformDocument, uploadPlatformDocument } = await import('./document-add')

const session = { userId: 'user_1' } as UserSession
const RL1 = { id: 'work:xx-rl-1', title: 'Mechanical resistance', kind: 'model_code', identifiers: { designation: 'RL 1' } }
const URL_BODY = { url: 'https://publisher.example/files/rl-1-2019.pdf', work: { workKey: 'xx-rl-1' }, label: 'April 2019', inForceFrom: null, licenceClass: 'public_open' as const }

/** The capture the platform takes: the PDF at the URL, with `text`; it lands in the draft as a later call finds it. */
function captures(text: string | null = TEXT, contentType = 'application/pdf') {
  calls.capture.mockImplementation(async (_session: unknown, changeRequestId: string, body: { url: string; basis: string; sourceId?: string }) => {
    const view = { captureId: `11111111-1111-4111-8111-11111111111${db.captures.length}`, changeRequestId, basis: body.basis, sourceId: body.sourceId ?? null, url: body.url, finalUrl: null, contentType, sha256: PDF_SHA }
    db.captures.push({ ...view, text })
    return view
  })
}

const refusal = async (run: Promise<unknown>) => run.then(() => null, (error: unknown) => error as ApiError)

beforeEach(() => {
  Object.assign(db, { works: [RL1], editions: [], drafts: [], held: null, captures: [] })
  for (const call of Object.values(calls)) call.mockReset()
  calls.listDrafts.mockImplementation(async () => db.drafts)
  calls.create.mockResolvedValue({ id: 'cr-new' })
  calls.importText.mockResolvedValue({ text: { sha256: PDF_SHA } })
  calls.uploadText.mockResolvedValue({ text: { sha256: 'b'.repeat(64) } })
  captures()
})

describe('addPlatformDocument', () => {
  test('with no draft open, it opens one titled for the document and proposes a new work, its edition and manifestation', async () => {
    db.works = []
    const added = await addPlatformDocument(session, 'XX', { ...URL_BODY, work: { title: 'Mechanical resistance and stability', designation: 'RL 1', kind: 'model_code' } })
    expect(calls.create).toHaveBeenCalledWith(session, { title: 'RL 1 April 2019', countryId: 'XX' })
    expect(added).toMatchObject({ changeRequestId: 'cr-new', opened: true, workKey: 'xx-rl-1', editionKey: 'xx-rl-1-april-2019', manifestationKey: 'xx-rl-1-april-2019-text', sha256: PDF_SHA })
    const [, , batch] = calls.propose.mock.calls[0] as [unknown, string, { records: { type: string; citations: { quote: string }[] }[] }]
    expect(batch.records.map((record) => record.type)).toEqual(['work', 'edition', 'manifestation'])
    expect(batch.records[1].citations[0].quote).toContain('April 2019')
    expect(calls.importText).toHaveBeenCalledWith(session, 'cr-new', { manifestationKey: 'xx-rl-1-april-2019-text', sourceId: 'xx-publisher', url: URL_BODY.url }, 'person')
  })

  test('with a draft open, the newest operator draft takes it, and an existing work is not proposed again', async () => {
    db.drafts = [{ id: 'cr-open', title: 'Open draft' }]
    const added = await addPlatformDocument(session, 'XX', URL_BODY)
    expect(calls.listDrafts).toHaveBeenCalledWith({ status: 'draft', countryId: 'XX', origin: 'operator' }, { offset: 0, limit: 1 })
    expect(calls.create).not.toHaveBeenCalled()
    expect(added).toMatchObject({ changeRequestId: 'cr-open', changeRequestTitle: 'Open draft', opened: false })
    const [, , batch] = calls.propose.mock.calls[0] as [unknown, string, { records: { type: string }[] }]
    expect(batch.records.map((record) => record.type)).toEqual(['edition', 'manifestation'])
  })

  test('EDITION_EXISTS when the work already has that edition: nothing is captured or written', async () => {
    db.editions = [{ id: 'edition:xx-rl-1-2019', workId: 'work:xx-rl-1', label: 'april 2019' }]
    expect(await refusal(addPlatformDocument(session, 'XX', URL_BODY))).toMatchObject({ status: 409, code: 'EDITION_EXISTS' })
    expect(calls.capture).not.toHaveBeenCalled()
    expect(calls.create).not.toHaveBeenCalled()
  })

  test('HOST_NOT_ON_SOURCE when the URL is on no source of the country', async () => {
    expect(await refusal(addPlatformDocument(session, 'XX', { ...URL_BODY, url: 'https://elsewhere.example/rl-1.pdf' }))).toMatchObject({ status: 422, code: 'HOST_NOT_ON_SOURCE' })
    expect(calls.listDrafts).not.toHaveBeenCalled()
  })

  test('NOT_A_PDF when the URL answers a page, and NOT_PRINTED when the PDF does not print the label: nothing is proposed', async () => {
    captures('<html>', 'text/html')
    expect(await refusal(addPlatformDocument(session, 'XX', URL_BODY))).toMatchObject({ status: 422, code: 'NOT_A_PDF' })
    captures()
    expect(await refusal(addPlatformDocument(session, 'XX', { ...URL_BODY, label: 'May 2020' }))).toMatchObject({ status: 422, code: 'NOT_PRINTED' })
    expect(calls.propose).not.toHaveBeenCalled()
  })

  test('a text step that fails says where the records are; the same call again reuses the capture and the records', async () => {
    db.drafts = [{ id: 'cr-open', title: 'Open draft' }]
    calls.importText.mockRejectedValueOnce(new ApiError(503, 'SOURCE_UNAVAILABLE', 'The source did not answer.'))
    const failed = await refusal(addPlatformDocument(session, 'XX', URL_BODY))
    expect(failed).toMatchObject({ status: 503, code: 'SOURCE_UNAVAILABLE', details: { changeRequestId: 'cr-open' } })
    expect(failed?.message).toContain('call again to attach the text')

    db.held = { proposal: {}, text: null }
    const added = await addPlatformDocument(session, 'XX', URL_BODY)
    expect(added).toMatchObject({ changeRequestId: 'cr-open', sha256: PDF_SHA })
    expect(calls.capture).toHaveBeenCalledTimes(1)
    expect(calls.propose).toHaveBeenCalledTimes(1)
    expect(calls.importText).toHaveBeenCalledTimes(2)
  })

  test('TEXT_CHANGED when the text fetched is other bytes than the capture the records quote', async () => {
    calls.importText.mockResolvedValue({ text: { sha256: 'f'.repeat(64) } })
    expect(await refusal(addPlatformDocument(session, 'XX', URL_BODY))).toMatchObject({ status: 409, code: 'TEXT_CHANGED', details: { changeRequestId: 'cr-new' } })
  })
})

describe('uploadPlatformDocument', () => {
  const fields = { work: { workKey: 'xx-rl-1' }, label: 'April 2019', inForceFrom: null, publishedAt: 'https://publisher.example/guidelines', titleText: TEXT }
  const pdf = (size = 0) => new File([`%PDF-1.7${' '.repeat(size)}`], 'upload.pdf', { type: 'application/pdf' })

  test('quotes the title lines and attaches the bytes under the manifestation’s name', async () => {
    const added = await uploadPlatformDocument(session, 'XX', fields, pdf())
    expect(calls.capture).toHaveBeenCalledWith(session, 'cr-new', expect.objectContaining({ basis: 'operator_supplied', url: fields.publishedAt, text: TEXT }))
    expect((calls.uploadText.mock.calls[0] as [unknown, string, string, File])[3].name).toBe('xx-rl-1-april-2019-text.pdf')
    expect(added.sha256).toBe('b'.repeat(64))
  })

  test('refuses a file over the advertised limit and one that is not a PDF before anything is written', async () => {
    expect(await refusal(uploadPlatformDocument(session, 'XX', fields, pdf(32 * 1024 * 1024)))).toMatchObject({ status: 413 })
    expect(await refusal(uploadPlatformDocument(session, 'XX', fields, new File(['<html>'], 'x.pdf')))).toMatchObject({ status: 422 })
    expect(calls.listDrafts).not.toHaveBeenCalled()
  })
})
