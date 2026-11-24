/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ measuring: true }))

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    email: 'a@example.test',
    name: 'Anna Berger',
    role: 'member',
    permissions: [],
  }),
}))
vi.mock('@/lib/authz/feature-flags', async (original) => ({
  ...(await original<typeof import('@/lib/authz/feature-flags')>()),
  isDrawingMeasureEnabled: vi.fn(() => flags.measuring),
}))
vi.mock('@/lib/documents/access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('@/lib/authz/project-membership', () => ({ PERMISSION_CHECKS_AT_ONCE: 8, userHoldsProjectPermission: vi.fn(), resolveSubjectMembership: vi.fn() }))
vi.mock('@/lib/sharing/directory', () => ({ loadOrganizationDirectory: vi.fn() }))
vi.mock('@/lib/realtime/document-channel', () => ({ publishToDocumentRoom: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/annotations/attention', async (original) => ({
  ...(await original<typeof import('@/lib/annotations/attention')>()),
  onMarksSet: vi.fn(async () => undefined),
}))
vi.mock('@/lib/drawing-tape/service', () => ({ measureOnReadDocument: vi.fn() }))
vi.mock('@/lib/annotations/repository', () => ({
  AnnotationLimitReachedError: class AnnotationLimitReachedError extends Error {},
  ReplyLimitReachedError: class ReplyLimitReachedError extends Error {},
  AlreadyCarriedError: class AlreadyCarriedError extends Error {},
  listDocumentAnnotations: vi.fn(),
  findDocumentAnnotation: vi.fn(),
  insertDocumentAnnotations: vi.fn(),
  updateDocumentAnnotation: vi.fn(),
  carryAnnotationToDocument: vi.fn(),
}))

import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { createAnnotation, listAnnotations, updateAnnotation } from '@/lib/annotations/client'
import { AGENT_KIND } from '@/lib/agent-kind'
import {
  carryAnnotationToDocument,
  findDocumentAnnotation,
  insertDocumentAnnotations,
  listDocumentAnnotations,
  updateDocumentAnnotation,
  type AnnotationRecord,
} from '@/lib/annotations/repository'
import { proposeAnnotations } from '@/lib/annotations/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { measureOnReadDocument } from '@/lib/drawing-tape/service'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'

import { GET as list, POST as create } from './route'
import { PATCH as patch } from './[annotationId]/route'

const run = async (path: string, init?: RequestInit) => {
  const url = new URL(path, 'https://app.test')
  const [, id, annotationId] = /^\/api\/documents\/([^/]+)\/annotations(?:\/([^/]+))?$/.exec(url.pathname) ?? []
  const method = init?.method ?? 'GET'
  if (method === 'PATCH') return patch(new Request(url, init), { params: Promise.resolve({ id, annotationId }) })
  const handler = method === 'POST' ? create : list
  return handler(new Request(url, init), { params: Promise.resolve({ id }) })
}

const SESSION = { userId: 'user_1', organizationId: 'org_1', permissions: [] } as unknown as AuthorizedSession

const DOC = {
  id: 'doc_1',
  organizationId: 'org_1',
  scope: 'project',
  projectId: 'proj_1',
  filename: 'Floor EG.pdf',
  publishedVersionId: 'ver_2',
} as Partial<Document> as Document

const RECORD: AnnotationRecord = {
  id: 'ann_1',
  organizationId: 'org_1',
  documentId: 'doc_1',
  versionId: 'ver_2',
  number: 1,
  page: 3,
  shape: 'point',
  x: 0.25,
  y: 0.5,
  w: null,
  h: null,
  points: null,
  reading: null,
  kind: 'hint',
  body: 'Distance',
  basis: null,
  authorKind: 'person',
  status: 'open',
  assigneeUserId: null,
  dueOn: null,
  createdBy: 'user_1',
  createdAt: new Date('2026-10-01T08:00:00Z'),
  updatedAt: new Date('2026-10-01T08:00:00Z'),
  acceptedBy: null,
  acceptedAt: null,
  closedBy: null,
  closedAt: null,
  delegatedBy: null,
  delegatedAt: null,
  carriedFromId: null,
  mentions: [],
  revisionNumber: 2,
  replies: [],
}

const LINE = {
  page: 3,
  shape: 'line' as const,
  x: 0.21,
  y: 0.4,
  points: [[0.21, 0.4], [0.36, 0.4]] as [number, number][],
  kind: 'hint' as const,
  body: 'Distance',
}
const ENGINE = {
  quantity: 'distance',
  value: 4.000123456789,
  unit: 'm' as const,
  low: 3.980122999999,
  high: 4.020123913579,
  provenance: 'vector_estimated' as const,
  scaleState: 'estimated' as const,
  scaleRatio: 100,
  printed: null,
  verdict: null,
  reasons: [],
  points: LINE.points,
}
const KEPT = {
  value: ENGINE.value,
  unit: 'm' as const,
  low: ENGINE.low,
  high: ENGINE.high,
  provenance: 'vector_estimated' as const,
  scaleState: 'estimated' as const,
  scaleRatio: 100,
  printed: null,
}
const KEPT_LINE: AnnotationRecord = { ...RECORD, shape: 'line', x: 0.21, y: 0.4, points: LINE.points, reading: KEPT }

beforeEach(() => {
  vi.clearAllMocks()
  flags.measuring = true
  vi.mocked(getAccessibleDocument).mockResolvedValue(DOC)
  vi.mocked(findDocumentAnnotation).mockResolvedValue(RECORD)
  vi.mocked(insertDocumentAnnotations).mockResolvedValue([RECORD])
  vi.mocked(listDocumentAnnotations).mockResolvedValue([])
  vi.mocked(loadOrganizationDirectory).mockResolvedValue(new Map())
})

describe('keeping a measurement on the sheet', () => {
  it('asks the engine for the mark’s own points and stores what it answers, unchanged', async () => {
    vi.mocked(measureOnReadDocument).mockResolvedValue({ measurement: ENGINE })
    vi.mocked(findDocumentAnnotation).mockResolvedValue(KEPT_LINE)

    const kept = await createAnnotation('doc_1', LINE, { run })

    expect(measureOnReadDocument).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user_1' }), DOC, {
      page: 3,
      operation: 'distance',
      points: LINE.points,
    })
    expect(insertDocumentAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({
        marks: [expect.objectContaining({ shape: 'line', points: LINE.points, reading: KEPT, w: null, h: null })],
      })
    )
    expect(kept).toMatchObject({ shape: 'line', points: LINE.points, reading: KEPT })
  })

  it.each([
    ['path', 'path', [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3]]],
    ['polygon', 'area', [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3]]],
  ] as const)('measures a %s as the engine’s %s', async (shape, operation, points) => {
    vi.mocked(measureOnReadDocument).mockResolvedValue({ measurement: { ...ENGINE, unit: shape === 'polygon' ? 'm2' : 'm' } })

    await createAnnotation('doc_1', { ...LINE, shape, x: 0.1, y: 0.1, points: points as unknown as [number, number][] }, { run })

    expect(measureOnReadDocument).toHaveBeenCalledWith(expect.anything(), DOC, { page: 3, operation, points })
  })

  it('refuses a reading the caller sends: the number is the server’s to ask the engine for', async () => {
    const sent = { ...LINE, reading: KEPT } as unknown as typeof LINE

    await expect(createAnnotation('doc_1', sent, { run })).rejects.toMatchObject({ status: 400 })
    expect(measureOnReadDocument).not.toHaveBeenCalled()
    expect(insertDocumentAnnotations).not.toHaveBeenCalled()
  })

  it('keeps nothing where the engine gives no number, and says why by its code', async () => {
    vi.mocked(measureOnReadDocument).mockResolvedValue({
      noNumber: { code: 'uncalibrated', reason: 'no usable scale', remedy: 'confirm the scale', scaleState: 'uncalibrated', candidates: [] },
    })

    await expect(createAnnotation('doc_1', LINE, { run })).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('(uncalibrated)'),
    })
    expect(insertDocumentAnnotations).not.toHaveBeenCalled()
  })

  it('keeps nothing where the tape is refused: the refusal is the tape’s own', async () => {
    vi.mocked(measureOnReadDocument).mockRejectedValue(new FeatureDisabledError('drawing-measure'))

    await expect(createAnnotation('doc_1', LINE, { run })).rejects.toMatchObject({ status: 403 })
    expect(insertDocumentAnnotations).not.toHaveBeenCalled()
  })

  it('does not ask the engine for a pin, and stores no reading with it', async () => {
    await createAnnotation('doc_1', { page: 3, shape: 'point', x: 0.2, y: 0.5, kind: 'hint', body: 'x' }, { run })

    expect(measureOnReadDocument).not.toHaveBeenCalled()
    expect(insertDocumentAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ marks: [expect.objectContaining({ shape: 'point', points: null, reading: null })] })
    )
  })
})

describe('a measurement is true of one Fassung', () => {
  const OLDER: AnnotationRecord = { ...KEPT_LINE, id: 'm', versionId: 'ver_1', revisionNumber: 1 }

  it('is not offered to carry onto the current one', async () => {
    vi.mocked(listDocumentAnnotations).mockResolvedValue([OLDER, { ...RECORD, id: 'p', number: 2, versionId: 'ver_1', revisionNumber: 1 }])

    const { annotations } = await listAnnotations('doc_1', run)

    expect(annotations.find((a) => a.id === 'm')).toMatchObject({ onCurrentRevision: false, carryTarget: null })
    expect(annotations.find((a) => a.id === 'p')?.carryTarget).not.toBeNull()
  })

  it('refuses a carry asked for anyway, and moves nothing', async () => {
    vi.mocked(findDocumentAnnotation).mockResolvedValue(OLDER)

    await expect(updateAnnotation('doc_1', 'm', { carryToCurrent: true }, { run })).rejects.toMatchObject({ status: 422 })
    expect(updateDocumentAnnotation).not.toHaveBeenCalled()
    expect(carryAnnotationToDocument).not.toHaveBeenCalled()
  })
})

describe('whether the review view offers the tape', () => {
  it('offers it on a PDF where the organization holds drawing measurement', async () => {
    expect((await listAnnotations('doc_1', run)).canMeasure).toBe(true)
  })

  it('does not without the entitlement, nor on a file that is no PDF', async () => {
    flags.measuring = false
    expect((await listAnnotations('doc_1', run)).canMeasure).toBe(false)

    flags.measuring = true
    vi.mocked(getAccessibleDocument).mockResolvedValue({ ...DOC, filename: 'site.dxf' })
    expect((await listAnnotations('doc_1', run)).canMeasure).toBe(false)
  })
})

describe('a measurement the agent sets', () => {
  it('is measured again by the server, like a person’s', async () => {
    vi.mocked(measureOnReadDocument).mockResolvedValue({ measurement: ENGINE })
    vi.mocked(insertDocumentAnnotations).mockResolvedValue([{ ...KEPT_LINE, authorKind: AGENT_KIND, status: 'proposed' }])

    await proposeAnnotations(SESSION, 'doc_1', [LINE, { page: 3, shape: 'point', x: 0.2, y: 0.5, kind: 'hint', body: 'Tür' }])

    expect(measureOnReadDocument).toHaveBeenCalledTimes(1)
    expect(measureOnReadDocument).toHaveBeenCalledWith(SESSION, DOC, { page: 3, operation: 'distance', points: LINE.points })
    expect(insertDocumentAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({
        marks: [
          expect.objectContaining({ shape: 'line', reading: KEPT }),
          expect.objectContaining({ shape: 'point', reading: null, points: null }),
        ],
      })
    )
  })

  it('cannot carry a reading of its own', async () => {
    await expect(proposeAnnotations(SESSION, 'doc_1', [{ ...LINE, reading: KEPT } as typeof LINE])).rejects.toThrow()
    expect(insertDocumentAnnotations).not.toHaveBeenCalled()
  })

  it('is refused where the organization does not hold drawing measurement', async () => {
    vi.mocked(measureOnReadDocument).mockRejectedValue(new FeatureDisabledError('drawing-measure'))

    await expect(proposeAnnotations(SESSION, 'doc_1', [LINE])).rejects.toMatchObject({ status: 403 })
    expect(insertDocumentAnnotations).not.toHaveBeenCalled()
  })
})
