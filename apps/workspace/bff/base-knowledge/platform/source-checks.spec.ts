/**
 * @vitest-environment node
 *
 * A source fixture's response as a capture the platform took (ADR-0174,
 * amendment 2026-11-11): which capture may stand for a document, what the
 * check is handed, and when a response that names none yet is a problem.
 * The door's own run of the three calls, on Postgres, is
 * `agent-api/pdf-source-door.integration.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingCapture } from './captures'

const stub = vi.hoisted(() => ({
  captures: [] as (RecordingCapture & { changeRequestId: string })[],
  asked: [] as Record<string, unknown>[],
  problems: [] as { fixture: string | null; detail: string }[],
}))

vi.mock('server-only', () => ({}))
vi.mock('./store', () => ({ platformTransaction: async <T>(run: (tx: unknown) => Promise<T>) => run({}) }))
vi.mock('./captures', () => ({
  isPdf: (contentType: string | null) => (contentType ?? '').split(';')[0].trim().toLowerCase() === 'application/pdf',
  isCut: (note: string | null) => (note ?? '').includes('read only in part'),
  recordingCapturesOf: async (_tx: unknown, changeRequestId: string | null, ids: readonly string[]) =>
    new Map(
      stub.captures
        .filter((capture) => ids.includes(capture.id) && (changeRequestId === null || capture.changeRequestId === changeRequestId))
        .map((capture) => [capture.id, capture]),
    ),
}))
vi.mock('./capture-fetch', () => ({
  CaptureFetchError: class extends Error {},
  refusalDetail: () => '',
  callPublicSources: async (_path: string, payload: { config: Record<string, unknown> }) => {
    stub.asked.push(payload.config)
    return { status: 200, body: { valid: stub.problems.length === 0, problems: stub.problems, fixtures: [] } }
  },
}))

import { sourceFixtureSchema } from '@/lib/base-knowledge/wire/source'
import { recordedConfig, sourceChecksOf, withRecordings } from './source-checks'
import { proposedRecordSchema } from './wire'

const REQUEST = '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'
const OTHER_REQUEST = '1c9f7e3f-7b62-4e7d-8b1f-5c3fa02d3e4f'
const CAPTURE = '7d3c1f0a-4b7e-4c58-9a51-0c2f6a1b9e11'
const CITED = '6f0c1a7e-2b7d-4c55-9a3e-6d1f0b2a9c11'
const KEY = 'xq-register'
const URL = 'https://register.xq.example/ordinance.pdf'
const POINTER = '/fixtures/0/responses/https:~1~1register.xq.example~1ordinance.pdf/captureId'
const TEXT = 'Ordinance on building\fSection 1 Scope'

const capture = (overrides: Partial<RecordingCapture & { changeRequestId: string }> = {}) => ({
  id: CAPTURE,
  changeRequestId: REQUEST,
  basis: 'fetched' as const,
  sourceId: KEY,
  url: URL,
  contentType: 'application/pdf',
  text: TEXT as string | null,
  note: null,
  ...overrides,
})

const source = (captureId: string | null) =>
  proposedRecordSchema.parse({
    type: 'source',
    key: KEY,
    title: 'Register of XQ',
    territoryId: 'XQ',
    protocol: 'web_document',
    format: 'pdf_document',
    hosts: ['register.xq.example'],
    terms: { url: 'https://register.xq.example/terms', licence: 'public_open', checked: '2026-11-01' },
    access: { documents: [{ id: 'ordinance', url: URL }] },
    fixtures: [{ name: 'ordinance', operation: 'document', args: { id: 'ordinance' }, responses: { [URL]: { captureId } }, expect: { contains: ['Section 1'] } }],
    citations: [{ captureId: CITED, quote: 'the register is published under an open licence' }],
  })

const checked = async (captureId: string | null, changeRequestId: string | null = REQUEST, draft = false) => {
  const answer = await sourceChecksOf([source(captureId)], changeRequestId, draft)
  return { problems: answer.checks.get(`source:${KEY}`) ?? [], awaiting: answer.awaiting.get(`source:${KEY}`) ?? [] }
}
const handedOver = () => (stub.asked.at(-1)?.fixtures as { responses: Record<string, unknown> }[])[0]!.responses[URL]

beforeEach(() => {
  stub.captures = [capture()]
  stub.asked = []
  stub.problems = []
})

describe('a source fixture names the capture the platform took', () => {
  it('hands the check the capture’s content type and text, and keeps neither in the record', async () => {
    const { problems, awaiting } = await checked(CAPTURE)

    expect(problems).toEqual([])
    expect(awaiting).toEqual([])
    expect(handedOver()).toEqual({ capture_id: CAPTURE, content_type: 'application/pdf', text: TEXT })
    // What the revision keeps is the id alone.
    const stored = { fixtures: [{ responses: { [URL]: { capture_id: CAPTURE } } }] }
    expect(JSON.stringify(withRecordings(stored, new Map()))).not.toContain(TEXT)
  })

  it.each([
    ['a text an operator pasted', { basis: 'operator_supplied' as const, sourceId: null }, 'an operator supplied'],
    ['a capture of another request', { changeRequestId: OTHER_REQUEST }, 'no capture of this change request'],
    ['a capture of another page', { url: 'https://register.xq.example/other.pdf' }, `not of ${URL}`],
    ['a fetch through another source', { sourceId: 'xq-gazette' }, `not through ${KEY}`],
    ['a scan that kept no text', { text: null, note: 'no text layer on all of its pages' }, 'kept no text (no text layer on all of its pages)'],
    ['an HTML page', { contentType: 'text/html; charset=utf-8' }, 'not a PDF'],
    ['a capture with no content type', { contentType: null }, 'not a PDF'],
    ['a text cut at a page boundary', { note: 'read only in part, up to page 40 of 90: a capture keeps at most 400,000 characters' }, 'cut at a page boundary'],
  ])('refuses %s, and does not hand it to the check', async (_name, overrides, detail) => {
    stub.captures = [capture(overrides)]

    const { problems } = await checked(CAPTURE)

    expect(problems).toEqual([expect.objectContaining({ code: 'KC-7', pointer: POINTER, detail: expect.stringContaining(detail) })])
    expect(problems[0]?.hint).toContain(`sourceId: "${KEY}"`)
    expect(handedOver()).toEqual({ capture_id: CAPTURE })
  })

  it('refuses a named capture when no request is known to hold it', async () => {
    const { problems } = await checked(CAPTURE, null)

    expect(problems).toEqual([expect.objectContaining({ code: 'KC-7', pointer: POINTER })])
  })

  it('reports what the check finds in the capture at the fixture', async () => {
    stub.problems = [{ fixture: 'ordinance', detail: "text does not contain 'Section 1'" }]

    const { problems } = await checked(CAPTURE)

    expect(problems).toEqual([expect.objectContaining({ code: 'KC-7', pointer: '/fixtures/0' })])
  })
})

describe('a fixture that names no capture yet', () => {
  it('is written into a draft, which is told what it waits for', async () => {
    const { problems, awaiting } = await checked(null, REQUEST, true)

    expect(problems).toEqual([])
    expect(awaiting).toEqual([expect.stringContaining(`awaits its capture of ${URL}`)])
    expect(awaiting[0]).toContain('platform-knowledge-citation-capture')
    expect(handedOver()).toEqual({ capture_id: null })
  })

  it('is a problem once the request is validated or submitted', async () => {
    const { problems, awaiting } = await checked(null, REQUEST, false)

    expect(awaiting).toEqual([])
    expect(problems).toEqual([expect.objectContaining({ code: 'KC-7', pointer: POINTER, detail: expect.stringContaining('awaits its capture') })])
  })
})

describe('a stored source’s recordings, for source-test', () => {
  const stored = { fixtures: [{ name: 'ordinance', responses: { [URL]: { capture_id: CAPTURE } } }] }
  const response = (config: Record<string, unknown>) => (config.fixtures as { responses: Record<string, unknown> }[])[0]!.responses[URL]

  it('reads a published source’s captures wherever they are, and a testing one’s from its own request', async () => {
    expect(response(await recordedConfig(stored, null))).toEqual({ capture_id: CAPTURE, content_type: 'application/pdf', text: TEXT })
    expect(response(await recordedConfig(stored, REQUEST))).toMatchObject({ text: TEXT })
    expect(response(await recordedConfig(stored, OTHER_REQUEST))).toEqual({ capture_id: CAPTURE })
  })

  it('leaves a capture that kept no text unrecorded, so its fixture waits and never passes', async () => {
    stub.captures = [capture({ text: null })]

    expect(response(await recordedConfig(stored, null))).toEqual({ capture_id: CAPTURE })
  })
})

describe('a fixture’s response on the wire', () => {
  const fixture = (response: unknown) => sourceFixtureSchema.safeParse({ name: 'ordinance', operation: 'document', responses: { [URL]: response }, expect: {} })

  it('is a body or a capture, never both and never neither', () => {
    expect(fixture({ captureId: CAPTURE }).success).toBe(true)
    expect(fixture({ captureId: null }).success).toBe(true)
    expect(fixture({ contentType: 'text/html', body: '<p>x</p>' }).success).toBe(true)
    expect(fixture({ captureId: CAPTURE, contentType: 'application/pdf', body: 'JVBERi0=' }).success).toBe(false)
    expect(fixture({ captureId: 'not-an-id' }).success).toBe(false)
    expect(fixture({}).success).toBe(false)
  })
})
