/**
 * @vitest-environment node
 */
/**
 * The calibration routes as thin adapters: the query and the body are parsed
 * with the wire's schemas before the service runs, a set answers 201, and the
 * service's refusals (the switched-off entitlement, a conflict) reach the
 * caller with their own status. The rules themselves are held in
 * `bff/drawing-calibrations/service.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION = { userId: 'user_1', organizationId: 'org_1', role: 'member', permissions: [], featureFlags: ['drawing-measure'] }

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn(async () => SESSION) }))
vi.mock('@/lib/drawing-calibrations/service', () => ({
  listCalibrations: vi.fn(),
  setCalibration: vi.fn(),
  withdrawCalibration: vi.fn(),
}))

import { ConflictError } from '@/lib/api/errors'
import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { listCalibrations, setCalibration, withdrawCalibration } from '@/lib/drawing-calibrations/service'
import { GET, POST } from './route'
import { POST as WITHDRAW } from './[calibrationId]/withdraw/route'

const DOC_ID = '11111111-1111-4111-8111-111111111111'
const CALIBRATION_ID = '33333333-3333-4333-8333-333333333333'
const BODY = {
  page: 1,
  region: { x: 0.1, y: 0.1, w: 0.5, h: 0.4 },
  from: { x: 0.2, y: 0.2 },
  to: { x: 0.5, y: 0.2 },
  lengthM: 5.4,
}

const context = (params: Record<string, string>) => ({ params: Promise.resolve(params) })
const url = (suffix = '') => `https://workspace.test/api/documents/${DOC_ID}/calibrations${suffix}`
const post = (body: unknown) =>
  POST(
    new Request(url(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    context({ id: DOC_ID })
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/documents/[id]/calibrations', () => {
  it('lists with the parsed query', async () => {
    const answer = { calibrations: [], nextCursor: null, versionId: null, canCalibrate: false }
    vi.mocked(listCalibrations).mockResolvedValue(answer)
    const res = await GET(new Request(url('?page=2&status=withdrawn&limit=10&cursor=10')), context({ id: DOC_ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(answer)
    expect(listCalibrations).toHaveBeenCalledWith(SESSION, DOC_ID, { page: 2, status: 'withdrawn', limit: 10, cursor: '10' })
  })

  it('400s an unknown status or query field before the service runs', async () => {
    expect((await GET(new Request(url('?status=deleted')), context({ id: DOC_ID }))).status).toBe(400)
    expect((await GET(new Request(url('?version=3')), context({ id: DOC_ID }))).status).toBe(400)
    expect(listCalibrations).not.toHaveBeenCalled()
  })

  it('answers the feature-disabled problem (403) when the entitlement is off', async () => {
    vi.mocked(listCalibrations).mockRejectedValue(new FeatureDisabledError('drawing-measure'))
    const res = await GET(new Request(url()), context({ id: DOC_ID }))
    expect(res.status).toBe(403)
    expect(res.headers.get('Content-Type')).toContain('application/problem+json')
    expect(await res.json()).toMatchObject({ code: 'feature_disabled', feature: 'drawing-measure' })
  })
})

describe('POST /api/documents/[id]/calibrations', () => {
  it('sets the calibration and answers 201', async () => {
    vi.mocked(setCalibration).mockResolvedValue({ calibration: { id: CALIBRATION_ID } } as Awaited<ReturnType<typeof setCalibration>>)
    const res = await post(BODY)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ calibration: { id: CALIBRATION_ID } })
    expect(setCalibration).toHaveBeenCalledWith(SESSION, DOC_ID, BODY)
  })

  it('400s a point outside the region, equal points and a missing region before the service runs', async () => {
    expect((await post({ ...BODY, to: { x: 0.9, y: 0.2 } })).status).toBe(400)
    expect((await post({ ...BODY, to: BODY.from })).status).toBe(400)
    expect((await post({ page: 1, from: BODY.from, to: BODY.to, lengthM: 5.4 })).status).toBe(400)
    expect(setCalibration).not.toHaveBeenCalled()
  })

  it('passes a conflict on as 409', async () => {
    vi.mocked(setCalibration).mockRejectedValue(new ConflictError('Somebody calibrated this region a moment ago. Look again.'))
    expect((await post(BODY)).status).toBe(409)
  })
})

describe('POST /api/documents/[id]/calibrations/[calibrationId]/withdraw', () => {
  const withdraw = () =>
    WITHDRAW(new Request(url(`/${CALIBRATION_ID}/withdraw`), { method: 'POST' }), context({ id: DOC_ID, calibrationId: CALIBRATION_ID }))

  it('withdraws the named calibration of the named document', async () => {
    vi.mocked(withdrawCalibration).mockResolvedValue({ calibration: { id: CALIBRATION_ID, status: 'withdrawn' } } as Awaited<ReturnType<typeof withdrawCalibration>>)
    const res = await withdraw()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ calibration: { status: 'withdrawn' } })
    expect(withdrawCalibration).toHaveBeenCalledWith(SESSION, DOC_ID, CALIBRATION_ID)
  })

  it('passes a calibration that is not active on as 409', async () => {
    vi.mocked(withdrawCalibration).mockRejectedValue(new ConflictError())
    expect((await withdraw()).status).toBe(409)
  })
})
