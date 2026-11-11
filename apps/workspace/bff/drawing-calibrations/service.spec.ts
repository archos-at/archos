/**
 * @vitest-environment node
 */
/**
 * The calibration service's rules, with the document reader and the
 * repository mocked: the entitlement refuses all three operations when off,
 * reading follows the document and writing needs the write intent, only a PDF
 * with a version can be calibrated, and a lost race or a row that is not
 * active is a conflict.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/documents/access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({
  shelfReaderFor: vi.fn(async (session: { userId: string }) => ({ kind: 'member', userId: session.userId })),
}))
vi.mock('./page-read', () => ({
  toPageCalibration: (row: DrawingCalibrationRow) => ({
    id: row.id,
    region: { x: row.regionX, y: row.regionY, w: row.regionW, h: row.regionH },
    from: { x: row.pointAX, y: row.pointAY },
    to: { x: row.pointBX, y: row.pointBY },
    lengthM: row.referenceLengthM,
  }),
}))
vi.mock('./repository', () => ({
  CalibrationSetConflictError: class CalibrationSetConflictError extends Error {},
  listDrawingCalibrations: vi.fn(),
  findDrawingCalibration: vi.fn(),
  setDrawingCalibration: vi.fn(),
  withdrawDrawingCalibration: vi.fn(),
}))

import { captureServer } from '@/lib/analytics/posthog-server'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import type { DrawingCalibrationRow } from '@/lib/db/schema/drawing-calibrations'
import { getAccessibleDocument } from '@/lib/documents/access'
import {
  CalibrationSetConflictError,
  findDrawingCalibration,
  listDrawingCalibrations,
  setDrawingCalibration,
  withdrawDrawingCalibration,
} from './repository'
import { isPdfDocument, listCalibrations, setCalibration, withdrawCalibration } from './service'

const DOC_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '22222222-2222-4222-8222-222222222222'
const CALIBRATION_ID = '33333333-3333-4333-8333-333333333333'

const session = (featureFlags: string[] | null = ['drawing-measure']) =>
  ({ userId: 'user_1', organizationId: 'org_1', role: 'member', permissions: [], featureFlags }) as Partial<AuthorizedSession> as AuthorizedSession

const doc = (overrides: Partial<Document> = {}) =>
  ({
    id: DOC_ID,
    organizationId: 'org_1',
    scope: 'project',
    projectId: 'proj_1',
    filename: 'EG_Grundriss.pdf',
    contentType: 'application/pdf',
    publishedVersionId: VERSION_ID,
    ...overrides,
  }) as Partial<Document> as Document

const row = (overrides: Partial<DrawingCalibrationRow> = {}): DrawingCalibrationRow => ({
  id: CALIBRATION_ID,
  organizationId: 'org_1',
  documentId: DOC_ID,
  versionId: VERSION_ID,
  page: 1,
  regionX: 0.1,
  regionY: 0.1,
  regionW: 0.5,
  regionH: 0.4,
  pointAX: 0.2,
  pointAY: 0.2,
  pointBX: 0.5,
  pointBY: 0.2,
  referenceLengthM: 5.4,
  status: 'active',
  createdBy: 'user_1',
  createdAt: new Date('2026-11-11T10:00:00Z'),
  withdrawnAt: null,
  withdrawnBy: null,
  ...overrides,
})

const INPUT = {
  page: 1,
  region: { x: 0.1, y: 0.1, w: 0.5, h: 0.4 },
  from: { x: 0.2, y: 0.2 },
  to: { x: 0.5, y: 0.2 },
  lengthM: 5.4,
}

/** `getAccessibleDocument` as a reader who may read and, when `writable`, write. */
function reads(document: Document, writable = true) {
  vi.mocked(getAccessibleDocument).mockImplementation(async (_session, _id, intent) => {
    if (intent === 'write' && !writable) throw new ForbiddenError()
    return document
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  reads(doc())
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the drawing-measure entitlement', () => {
  it.each([
    ['list', () => listCalibrations(session([]), DOC_ID, {})],
    ['set', () => setCalibration(session([]), DOC_ID, INPUT)],
    ['withdraw', () => withdrawCalibration(session([]), DOC_ID, CALIBRATION_ID)],
  ])('refuses %s with the feature-disabled problem when the organization does not hold it', async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ status: 403, code: 'feature_disabled', feature: 'drawing-measure' })
    expect(getAccessibleDocument).not.toHaveBeenCalled()
    expect(setDrawingCalibration).not.toHaveBeenCalled()
  })

  it('refuses a session whose token carries no flags at all', async () => {
    await expect(listCalibrations(session(null), DOC_ID, {})).rejects.toMatchObject({ code: 'feature_disabled' })
  })
})

describe('listCalibrations', () => {
  it('lists the active calibrations of the current version, and says the reader may calibrate', async () => {
    vi.mocked(listDrawingCalibrations).mockResolvedValue([row()])
    const answer = await listCalibrations(session(), DOC_ID, {})
    expect(vi.mocked(getAccessibleDocument).mock.calls[0]).toEqual([expect.anything(), DOC_ID, 'read'])
    expect(vi.mocked(listDrawingCalibrations).mock.calls[0]).toEqual([
      { organizationId: 'org_1', documentId: DOC_ID, versionId: VERSION_ID, page: undefined, status: 'active' },
      { kind: 'member', userId: 'user_1' },
      { limit: 50, offset: 0 },
    ])
    expect(answer).toEqual({
      calibrations: [
        {
          id: CALIBRATION_ID,
          documentId: DOC_ID,
          versionId: VERSION_ID,
          page: 1,
          region: INPUT.region,
          from: INPUT.from,
          to: INPUT.to,
          lengthM: 5.4,
          status: 'active',
          createdBy: 'user_1',
          createdAt: '2026-11-11T10:00:00.000Z',
          withdrawnAt: null,
          withdrawnBy: null,
        },
      ],
      nextCursor: null,
      versionId: VERSION_ID,
      canCalibrate: true,
    })
  })

  it('pages: one row past the limit becomes the next cursor', async () => {
    vi.mocked(listDrawingCalibrations).mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })])
    const answer = await listCalibrations(session(), DOC_ID, { limit: 2, cursor: '4', page: 3, status: 'withdrawn' })
    expect(vi.mocked(listDrawingCalibrations).mock.calls[0][0]).toMatchObject({ page: 3, status: 'withdrawn' })
    expect(vi.mocked(listDrawingCalibrations).mock.calls[0][2]).toEqual({ limit: 2, offset: 4 })
    expect(answer.calibrations.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(answer.nextCursor).toBe('6')
  })

  it('shows a reader without the write permission the list, without the control', async () => {
    reads(doc(), false)
    vi.mocked(listDrawingCalibrations).mockResolvedValue([row()])
    const answer = await listCalibrations(session(), DOC_ID, {})
    expect(answer.calibrations).toHaveLength(1)
    expect(answer.canCalibrate).toBe(false)
  })

  it('answers none for a document with no version, and reads nothing', async () => {
    reads(doc({ publishedVersionId: null }))
    expect(await listCalibrations(session(), DOC_ID, {})).toEqual({
      calibrations: [],
      nextCursor: null,
      versionId: null,
      canCalibrate: false,
    })
    expect(listDrawingCalibrations).not.toHaveBeenCalled()
  })

  it('answers none for a file that is not a PDF', async () => {
    reads(doc({ filename: 'EG.dwg', contentType: 'application/acad' }))
    expect(await listCalibrations(session(), DOC_ID, {})).toMatchObject({ calibrations: [], canCalibrate: false })
  })

  it('passes on the refusal of a document the reader may not open', async () => {
    vi.mocked(getAccessibleDocument).mockRejectedValue(new NotFoundError())
    await expect(listCalibrations(session(), DOC_ID, {})).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a malformed cursor', async () => {
    await expect(listCalibrations(session(), DOC_ID, { cursor: 'abc' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('setCalibration', () => {
  it('sets it on the current version as the person, after reading the document for writing', async () => {
    vi.mocked(setDrawingCalibration).mockResolvedValue(row())
    const answer = await setCalibration(session(), DOC_ID, INPUT)
    expect(vi.mocked(getAccessibleDocument).mock.calls[0]).toEqual([expect.anything(), DOC_ID, 'write'])
    expect(setDrawingCalibration).toHaveBeenCalledWith({
      organizationId: 'org_1',
      documentId: DOC_ID,
      versionId: VERSION_ID,
      ...INPUT,
      createdBy: 'user_1',
    })
    expect(answer.calibration).toMatchObject({ id: CALIBRATION_ID, status: 'active', lengthM: 5.4 })
    expect(captureServer).toHaveBeenCalledWith({
      event: 'drawing_calibration_set',
      distinctId: 'user_1',
      organizationId: 'org_1',
      properties: { document_id: DOC_ID, page: row().page },
    })
  })

  it('needs the write permission', async () => {
    reads(doc(), false)
    await expect(setCalibration(session(), DOC_ID, INPUT)).rejects.toMatchObject({ status: 403 })
    expect(setDrawingCalibration).not.toHaveBeenCalled()
  })

  it('refuses a document with no version (409)', async () => {
    reads(doc({ publishedVersionId: null }))
    await expect(setCalibration(session(), DOC_ID, INPUT)).rejects.toMatchObject({
      status: 409,
      message: 'This document has no version yet, so it cannot be calibrated.',
    })
    expect(setDrawingCalibration).not.toHaveBeenCalled()
  })

  it('refuses a file that is not a PDF (422)', async () => {
    reads(doc({ filename: 'EG.ifc', contentType: null }))
    await expect(setCalibration(session(), DOC_ID, INPUT)).rejects.toMatchObject({
      status: 422,
      message: 'Only a PDF drawing can be calibrated.',
    })
    expect(setDrawingCalibration).not.toHaveBeenCalled()
  })

  it('answers the loser of two sets at once with a conflict, not a 500', async () => {
    vi.mocked(setDrawingCalibration).mockRejectedValue(new CalibrationSetConflictError())
    await expect(setCalibration(session(), DOC_ID, INPUT)).rejects.toMatchObject({ status: 409 })
  })
})

describe('withdrawCalibration', () => {
  it('withdraws an active calibration as the person', async () => {
    const withdrawnAt = new Date('2026-11-11T11:00:00Z')
    vi.mocked(findDrawingCalibration).mockResolvedValue(row())
    vi.mocked(withdrawDrawingCalibration).mockResolvedValue(row({ status: 'withdrawn', withdrawnAt, withdrawnBy: 'user_1' }))
    const answer = await withdrawCalibration(session(), DOC_ID, CALIBRATION_ID)
    expect(vi.mocked(getAccessibleDocument).mock.calls[0]).toEqual([expect.anything(), DOC_ID, 'write'])
    expect(withdrawDrawingCalibration).toHaveBeenCalledWith('org_1', DOC_ID, CALIBRATION_ID, 'user_1')
    expect(answer.calibration).toMatchObject({
      status: 'withdrawn',
      withdrawnAt: '2026-11-11T11:00:00.000Z',
      withdrawnBy: 'user_1',
    })
    expect(captureServer).toHaveBeenCalledWith(expect.objectContaining({ event: 'drawing_calibration_withdrawn' }))
  })

  it('needs the write permission', async () => {
    reads(doc(), false)
    await expect(withdrawCalibration(session(), DOC_ID, CALIBRATION_ID)).rejects.toMatchObject({ status: 403 })
    expect(withdrawDrawingCalibration).not.toHaveBeenCalled()
  })

  it('does not find a calibration of another document, or an id that is no uuid', async () => {
    vi.mocked(findDrawingCalibration).mockResolvedValue(null)
    await expect(withdrawCalibration(session(), DOC_ID, CALIBRATION_ID)).rejects.toMatchObject({ status: 404 })
    await expect(withdrawCalibration(session(), DOC_ID, 'not-a-uuid')).rejects.toMatchObject({ status: 404 })
    expect(findDrawingCalibration).toHaveBeenCalledTimes(1)
  })

  it.each(['superseded', 'withdrawn'] as const)('refuses a %s calibration (409) and moves nothing', async (status) => {
    vi.mocked(findDrawingCalibration).mockResolvedValue(row({ status }))
    await expect(withdrawCalibration(session(), DOC_ID, CALIBRATION_ID)).rejects.toMatchObject({ status: 409 })
    expect(withdrawDrawingCalibration).not.toHaveBeenCalled()
  })

  it('answers a conflict when a colleague ended it between the read and the write', async () => {
    vi.mocked(findDrawingCalibration).mockResolvedValue(row())
    vi.mocked(withdrawDrawingCalibration).mockResolvedValue(null)
    await expect(withdrawCalibration(session(), DOC_ID, CALIBRATION_ID)).rejects.toMatchObject({ status: 409 })
  })
})

describe('isPdfDocument', () => {
  it('reads the stored type first, then the name', () => {
    expect(isPdfDocument({ contentType: 'application/pdf', filename: 'scan' })).toBe(true)
    expect(isPdfDocument({ contentType: null, filename: 'EG.PDF' })).toBe(true)
    expect(isPdfDocument({ contentType: 'application/octet-stream', filename: 'EG.pdf' })).toBe(true)
    expect(isPdfDocument({ contentType: 'image/png', filename: 'EG.png' })).toBe(false)
  })
})
