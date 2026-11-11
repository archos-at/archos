/**
 * @vitest-environment node
 */
/**
 * The person's tape (ADR-0182, slice 8), driven through the TYPED CLIENT
 * (ADR-0055): the review view uses the same function.
 *
 * The document reader, the envelope signer and the backend are mocked; what is
 * under test is what the route holds between them: nothing without the
 * `drawing-measure` entitlement, nothing for a document the reader may not
 * see, nothing for a file that is no PDF; the call to the engine names the
 * document's own file, states the kind the engine's gate asks for and carries
 * the person's envelope; and the engine's value, interval and provenance reach
 * the caller unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = {
  userId: 'user_1',
  organizationId: 'org_1',
  email: 'a@example.test',
  name: 'Anna Berger',
  role: 'member',
  permissions: [],
  featureFlags: ['drawing-measure'],
}

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn(async () => session) }))
vi.mock('@/lib/authz/feature-flags', async (original) => ({
  ...(await original<typeof import('@/lib/authz/feature-flags')>()),
  isDrawingMeasureEnabled: vi.fn(),
}))
vi.mock('@/lib/documents/access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('@/lib/turns/signed-envelope', () => ({ signedEnvelopeHeaders: vi.fn() }))
vi.mock('@/lib/backend-url', () => ({ getBackendUrl: () => 'http://backend.internal:8000' }))
vi.mock('@/lib/internal-auth', () => ({
  InternalServiceUnavailableError: class InternalServiceUnavailableError extends Error {},
  internalServiceHeaders: vi.fn(() => ({ 'x-internal-token-for-test': 'token' })),
}))

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { isDrawingMeasureEnabled } from '@/lib/authz/feature-flags'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { measureOnDocument, TapeRequestError } from '@/lib/drawing-tape/client'
import type { MeasureRequest } from '@/lib/drawing-tape/wire'
import { signedEnvelopeHeaders } from '@/lib/turns/signed-envelope'
import { TurnBudgetExhaustedError } from '@/lib/turns/turn-context'

import { POST as measure } from './route'

const run = (path: string, init?: RequestInit) => {
  const url = new URL(path, 'https://app.test')
  const id = decodeURIComponent(/^\/api\/documents\/([^/]+)\/measure$/.exec(url.pathname)?.[1] ?? '')
  return measure(new Request(url, init), { params: Promise.resolve({ id }) })
}

const DOC = {
  id: 'doc_1',
  organizationId: 'org_1',
  scope: 'project',
  projectId: 'proj_1',
  filename: 'Floor EG.pdf',
  collectionName: 'p_proj_1',
  publishedVersionId: 'ver_2',
} as Partial<Document> as Document

const DISTANCE: MeasureRequest = { page: 2, operation: 'distance', points: [[0.21, 0.4], [0.36, 0.4]] }

/** What the engine answers: digits no rounding of ours would produce, so a pass-through is visible. */
const ENGINE_MEASUREMENT = {
  measurement: {
    quantity: 'distance',
    value: 4.000123456789,
    unit: 'm',
    low: 3.980122999999,
    high: 4.020123913579,
    provenance: 'vector_estimated',
    scaleState: 'estimated',
    scaleRatio: 100.00000000000001,
    verdict: null,
    reasons: [],
    points: [[0.21003, 0.39998], [0.36001, 0.39998]],
  },
}

const backend = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTERNAL_API_TOKEN', 'secret-for-test')
  vi.stubGlobal('fetch', backend)
  vi.mocked(isDrawingMeasureEnabled).mockReturnValue(true)
  vi.mocked(getAccessibleDocument).mockResolvedValue(DOC)
  vi.mocked(signedEnvelopeHeaders).mockResolvedValue({ 'x-request-context': 'ctx', 'x-request-context-sig': 'sig' })
  backend.mockImplementation(async () => Response.json(ENGINE_MEASUREMENT))
})

const refusal = async (act: Promise<unknown>): Promise<TapeRequestError> => {
  const error = await act.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(TapeRequestError)
  return error as TapeRequestError
}

describe('POST /api/documents/{id}/measure', () => {
  it('hands the engine’s value, interval and provenance on unchanged', async () => {
    const answer = await measureOnDocument('doc_1', DISTANCE, run)

    expect(answer).toEqual(ENGINE_MEASUREMENT)
    if (!('measurement' in answer)) throw new Error('no measurement')
    expect(answer.measurement.value).toBe(4.000123456789)
    expect([answer.measurement.low, answer.measurement.high]).toEqual([3.980122999999, 4.020123913579])
    expect(answer.measurement.provenance).toBe('vector_estimated')
    expect(answer.measurement.verdict).toBeNull()
  })

  it('asks the engine about the document’s own file, as the person, stating the kind its gate asks for', async () => {
    await measureOnDocument('doc_1', DISTANCE, run)

    expect(getAccessibleDocument).toHaveBeenCalledWith(session, 'doc_1', 'read')
    expect(signedEnvelopeHeaders).toHaveBeenCalledWith(session, 'proj_1', 'secret-for-test')
    expect(backend).toHaveBeenCalledTimes(1)
    const [url, init] = backend.mock.calls[0]
    expect(url).toBe('http://backend.internal:8000/v1/internal/drawing-tape')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(init?.headers).toMatchObject({
      'x-request-context': 'ctx',
      'x-request-context-sig': 'sig',
      'x-internal-token-for-test': 'token',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      file_name: 'Floor EG.pdf',
      collection: 'p_proj_1',
      page: 2,
      operation: 'distance',
      points: [[0.21, 0.4], [0.36, 0.4]],
      stated_kinds: ['pdf'],
    })
  })

  it('answers a snap with where each point lands, or why it lands nowhere', async () => {
    const snap = {
      snap: [
        { snapped: [0.21003, 0.39998], movedPt: 1.4, reason: null, detail: null, candidates: [] },
        { snapped: null, movedPt: null, reason: 'several', detail: '2 line ends in reach', candidates: [[0.3, 0.4], [0.31, 0.4]] },
        { snapped: null, movedPt: null, reason: 'none', detail: 'no line end in reach', candidates: [] },
      ],
    }
    backend.mockImplementation(async () => Response.json(snap))

    expect(await measureOnDocument('doc_1', { page: 1, operation: 'snap', points: [[0.21, 0.4], [0.3, 0.4], [0.9, 0.9]] }, run)).toEqual(snap)
  })

  it('answers no number with the engine’s reason and remedy', async () => {
    const refused = { noNumber: { reason: 'this region has no usable scale (no hint)', remedy: 'ask a person to confirm the scale', scaleState: 'uncalibrated', candidates: [] } }
    backend.mockImplementation(async () => Response.json(refused))

    expect(await measureOnDocument('doc_1', DISTANCE, run)).toEqual(refused)
  })

  it('refuses without the drawing-measure entitlement, before any document is read', async () => {
    vi.mocked(isDrawingMeasureEnabled).mockReturnValue(false)

    const error = await refusal(measureOnDocument('doc_1', DISTANCE, run))

    expect(error.status).toBe(403)
    expect(getAccessibleDocument).not.toHaveBeenCalled()
    expect(backend).not.toHaveBeenCalled()
  })

  it.each([
    ['a document that is not there for this reader', new NotFoundError(), 404],
    ['a document the reader may not open', new ForbiddenError(), 403],
  ])('refuses %s, and asks the engine nothing', async (_name, thrown, status) => {
    vi.mocked(getAccessibleDocument).mockRejectedValue(thrown)

    const error = await refusal(measureOnDocument('doc_other', DISTANCE, run))

    expect(error.status).toBe(status)
    expect(signedEnvelopeHeaders).not.toHaveBeenCalled()
    expect(backend).not.toHaveBeenCalled()
  })

  it('refuses a file that is no PDF', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue({ ...DOC, filename: 'site.dxf' })

    expect((await refusal(measureOnDocument('doc_1', DISTANCE, run))).status).toBe(422)
    expect(backend).not.toHaveBeenCalled()
  })

  it.each([
    ['a distance of three points', { ...DISTANCE, points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] }],
    ['an area of two points', { ...DISTANCE, operation: 'area' }],
    ['a point off the page', { ...DISTANCE, points: [[0.1, 0.1], [1.2, 0.2]] }],
    ['an operation it does not have', { ...DISTANCE, operation: 'clearance' }],
    ['a field it does not take', { ...DISTANCE, threshold_min: 1 }],
  ])('refuses %s as a bad request', async (_name, body) => {
    const error = await refusal(measureOnDocument('doc_1', body as MeasureRequest, run))

    expect(error.status).toBe(400)
    expect(backend).not.toHaveBeenCalled()
  })

  it('says so when the person may not use the project, or its budget is spent', async () => {
    vi.mocked(signedEnvelopeHeaders).mockRejectedValueOnce(new ForbiddenError())
    expect((await refusal(measureOnDocument('doc_1', DISTANCE, run))).status).toBe(403)

    vi.mocked(signedEnvelopeHeaders).mockRejectedValueOnce(new TurnBudgetExhaustedError('project'))
    expect((await refusal(measureOnDocument('doc_1', DISTANCE, run))).status).toBe(429)
    expect(backend).not.toHaveBeenCalled()
  })

  it.each([
    ['refuses the call', async () => Response.json({ detail: { error: 'not_enabled' } }, { status: 403 })],
    ['answers in a form this build does not read', async () => Response.json({ measurement: { value: 'four' } })],
    ['cannot be reached', async () => Promise.reject(new TypeError('fetch failed'))],
  ])('is a 502 when the engine %s', async (_name, answer) => {
    backend.mockImplementation(answer as typeof fetch)

    expect((await refusal(measureOnDocument('doc_1', DISTANCE, run))).status).toBe(502)
  })
})
