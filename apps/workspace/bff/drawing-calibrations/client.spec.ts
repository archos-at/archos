import { describe, expect, it, vi } from 'vitest'
import {
  CalibrationRequestError,
  listActiveCalibrations,
  setCalibration,
  withdrawCalibration,
  type CalibrationFetch,
} from './client'
import type { CalibrationView, SetCalibrationRequest } from './wire'

const DOCUMENT = '11111111-1111-4111-8111-111111111111'
const VERSION = '22222222-2222-4222-8222-222222222222'

const calibration = (id: string, page = 1): CalibrationView => ({
  id,
  documentId: DOCUMENT,
  versionId: VERSION,
  page,
  region: { x: 0.1, y: 0.1, w: 0.6, h: 0.7 },
  from: { x: 0.2, y: 0.5 },
  to: { x: 0.6, y: 0.5 },
  lengthM: 12.5,
  status: 'active',
  createdBy: 'user_1',
  createdAt: '2026-11-02T09:00:00.000Z',
  withdrawnAt: null,
  withdrawnBy: null,
})

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the calibrations client', () => {
  it('lists the active calibrations and follows the cursor', async () => {
    const first = calibration('33333333-3333-4333-8333-333333333333')
    const second = calibration('44444444-4444-4444-8444-444444444444', 2)
    const run = vi
      .fn<CalibrationFetch>()
      .mockResolvedValueOnce(answer({ calibrations: [first], nextCursor: 'c1', versionId: VERSION, canCalibrate: true }))
      .mockResolvedValueOnce(answer({ calibrations: [second], nextCursor: null, versionId: VERSION, canCalibrate: true }))

    const listed = await listActiveCalibrations(DOCUMENT, { run })

    expect(run.mock.calls.map(([path]) => path)).toEqual([
      `/api/documents/${DOCUMENT}/calibrations?status=active`,
      `/api/documents/${DOCUMENT}/calibrations?status=active&cursor=c1`,
    ])
    expect(listed).toEqual({ calibrations: [first, second], nextCursor: null, versionId: VERSION, canCalibrate: true })
  })

  it('asks for one page of the document when one is named', async () => {
    const run = vi
      .fn<CalibrationFetch>()
      .mockResolvedValue(answer({ calibrations: [], nextCursor: null, versionId: null, canCalibrate: false }))
    await listActiveCalibrations(DOCUMENT, { page: 3, run })
    expect(run.mock.calls[0]?.[0]).toBe(`/api/documents/${DOCUMENT}/calibrations?status=active&page=3`)
  })

  it('sets one with the request as its body and answers the calibration', async () => {
    const made = calibration('55555555-5555-4555-8555-555555555555')
    const run = vi.fn<CalibrationFetch>().mockResolvedValue(answer({ calibration: made }, 201))
    const input: SetCalibrationRequest = { page: 1, region: made.region, from: made.from, to: made.to, lengthM: 12.5 }

    await expect(setCalibration(DOCUMENT, input, { run })).resolves.toEqual(made)

    expect(run).toHaveBeenCalledTimes(1)
    const [path, init] = run.mock.calls[0] ?? []
    expect(path).toBe(`/api/documents/${DOCUMENT}/calibrations`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })

  it('withdraws one by its id', async () => {
    const gone = { ...calibration('66666666-6666-4666-8666-666666666666'), status: 'withdrawn' as const }
    const run = vi.fn<CalibrationFetch>().mockResolvedValue(answer({ calibration: gone }))
    await expect(withdrawCalibration(DOCUMENT, gone.id, { run })).resolves.toEqual(gone)
    expect(run.mock.calls[0]?.[0]).toBe(`/api/documents/${DOCUMENT}/calibrations/${gone.id}/withdraw`)
    expect(run.mock.calls[0]?.[1]?.method).toBe('POST')
  })

  it('throws a refusal with its status and code', async () => {
    const run = vi
      .fn<CalibrationFetch>()
      .mockResolvedValue(answer({ code: 'feature_disabled', error: 'The drawing-measure feature is not switched on.' }, 403))
    const refused = await listActiveCalibrations(DOCUMENT, { run }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(CalibrationRequestError)
    expect(refused).toMatchObject({ status: 403, code: 'feature_disabled' })
  })

  it('refuses an answer that is not the wire shape', async () => {
    const run = vi.fn<CalibrationFetch>().mockResolvedValue(answer({ calibration: { id: 'not-a-uuid' } }))
    await expect(withdrawCalibration(DOCUMENT, 'x', { run })).rejects.toThrow()
  })
})
