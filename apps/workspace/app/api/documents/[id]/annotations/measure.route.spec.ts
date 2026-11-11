/**
 * @vitest-environment node
 */
/**
 * A measurement kept on the sheet (ADR-0182, slice 8), through the TYPED
 * CLIENT of the Anmerkungen routes: the number a kept measurement stores is
 * the engine's answer for the mark's own points, asked by the server when the
 * mark is set, never a caller's; where the engine gives none, nothing is kept;
 * a pin asks nothing; and a measurement is not offered to carry onto another
 * Fassung. The engine is mocked at its seam (`lib/drawing-tape/service`), the
 * repository and the document reader as in `route.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
// The engine, at its seam: what a kept measurement stores is what this answers.
vi.mock('@/lib/drawing-tape/service', () => ({ measureOnReadDocument: vi.fn(), mayMeasure: vi.fn(() => false) }))
vi.mock('@/lib/annotations/repository', () => ({
  AnnotationLimitReachedError: class AnnotationLimitReachedError extends Error {},
  ReplyLimitReachedError: class ReplyLimitReachedError extends Error {},
  listDocumentAnnotations: vi.fn(),
  findDocumentAnnotation: vi.fn(),
  insertDocumentAnnotations: vi.fn(),
}))

import { ForbiddenError } from '@/lib/api/errors'
import { createAnnotation, listAnnotations } from '@/lib/annotations/client'
import {
  findDocumentAnnotation,
  insertDocumentAnnotations,
  listDocumentAnnotations,
  type AnnotationRecord,
} from '@/lib/annotations/repository'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { mayMeasure, measureOnReadDocument } from '@/lib/drawing-tape/service'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'

import { GET as list, POST as create } from './route'

const run = async (path: string, init?: RequestInit) => {
  const url = new URL(path, 'https://app.test')
  const id = decodeURIComponent(/^\/api\/documents\/([^/]+)\/annotations$/.exec(url.pathname)?.[1] ?? '')
  const handler = (init?.method ?? 'GET') === 'POST' ? create : list
  return handler(new Request(url, init), { params: Promise.resolve({ id }) })
}

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
  measurement: null,
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccessibleDocument).mockResolvedValue(DOC)
  vi.mocked(findDocumentAnnotation).mockResolvedValue(RECORD)
  vi.mocked(insertDocumentAnnotations).mockResolvedValue([RECORD])
  vi.mocked(loadOrganizationDirectory).mockResolvedValue(new Map())
  vi.mocked(mayMeasure).mockReturnValue(false)
})

describe('keeping a measurement on the sheet (ADR-0182, slice 8)', () => {
  const LINE = { page: 3, shape: 'line' as const, x: 0.21, y: 0.4, points: [[0.21, 0.4], [0.36, 0.4]] as [number, number][], kind: 'hint' as const, body: 'Distance' }
  const ENGINE = {
    quantity: 'distance',
    value: 4.000123456789,
    unit: 'm' as const,
    low: 3.980122999999,
    high: 4.020123913579,
    provenance: 'vector_estimated' as const,
    scaleState: 'estimated' as const,
    scaleRatio: 100,
    verdict: null,
    reasons: [],
    points: LINE.points,
  }
  const KEPT = { value: ENGINE.value, unit: 'm', low: ENGINE.low, high: ENGINE.high, provenance: 'vector_estimated', scaleState: 'estimated' }

  it('asks the engine for the mark’s own points and stores what it answers, unchanged', async () => {
    vi.mocked(measureOnReadDocument).mockResolvedValue({ measurement: ENGINE })
    vi.mocked(findDocumentAnnotation).mockResolvedValue({ ...RECORD, shape: 'line', points: LINE.points, measurement: KEPT as AnnotationRecord['measurement'] })

    const kept = await createAnnotation('doc_1', LINE, { run })

    expect(measureOnReadDocument).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user_1' }), DOC, {
      page: 3,
      operation: 'distance',
      points: LINE.points,
    })
    expect(insertDocumentAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ marks: [expect.objectContaining({ shape: 'line', points: LINE.points, measurement: KEPT, w: null, h: null })] })
    )
    expect(kept).toMatchObject({ shape: 'line', points: LINE.points, measurement: KEPT })
  })

  it.each([
    ['path', 'path', [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3]]],
    ['polygon', 'area', [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3]]],
  ] as const)('measures a %s as the engine’s %s', async (shape, operation, points) => {
    vi.mocked(measureOnReadDocument).mockResolvedValue({ measurement: { ...ENGINE, unit: shape === 'polygon' ? 'm2' : 'm' } })

    await createAnnotation('doc_1', { ...LINE, shape, x: 0.1, y: 0.1, points: points as unknown as [number, number][] }, { run })

    expect(measureOnReadDocument).toHaveBeenCalledWith(expect.anything(), DOC, { page: 3, operation, points })
  })

  it('keeps nothing where the engine gives no number, and says its reason and remedy', async () => {
    vi.mocked(measureOnReadDocument).mockResolvedValue({
      noNumber: { reason: 'this region has no usable scale', remedy: 'ask a person to confirm the scale', scaleState: 'uncalibrated', candidates: [] },
    })

    await expect(createAnnotation('doc_1', LINE, { run })).rejects.toMatchObject({
      status: 422,
      reason: 'no-number',
      message: expect.stringContaining('no usable scale'),
    })
    expect(insertDocumentAnnotations).not.toHaveBeenCalled()
  })

  it('keeps nothing where the tape is refused (no entitlement, no PDF): the refusal is the tape’s own', async () => {
    vi.mocked(measureOnReadDocument).mockRejectedValue(new ForbiddenError('feature disabled'))

    await expect(createAnnotation('doc_1', LINE, { run })).rejects.toMatchObject({ status: 403 })
    expect(insertDocumentAnnotations).not.toHaveBeenCalled()
  })

  it('does not ask the engine for a pin, and stores no reading with it', async () => {
    await createAnnotation('doc_1', { page: 3, shape: 'point', x: 0.2, y: 0.5, kind: 'hint', body: 'x' }, { run })

    expect(measureOnReadDocument).not.toHaveBeenCalled()
    expect(insertDocumentAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ marks: [expect.objectContaining({ shape: 'point', points: null, measurement: null })] })
    )
  })

  it('tells the review whether this reader gets the tape on this document', async () => {
    vi.mocked(listDocumentAnnotations).mockResolvedValue([])
    expect((await listAnnotations('doc_1', run)).canMeasure).toBe(false)

    vi.mocked(mayMeasure).mockReturnValueOnce(true)
    expect((await listAnnotations('doc_1', run)).canMeasure).toBe(true)
  })

  it('is not offered to carry: a measurement is true of the Fassung it was measured on', async () => {
    vi.mocked(listDocumentAnnotations).mockResolvedValue([
      { ...RECORD, id: 'm', shape: 'line', points: LINE.points, measurement: KEPT as AnnotationRecord['measurement'], versionId: 'ver_1', revisionNumber: 1 },
      { ...RECORD, id: 'p', number: 2, versionId: 'ver_1', revisionNumber: 1 },
    ])

    const { annotations } = await listAnnotations('doc_1', run)

    expect(annotations.find((a) => a.id === 'm')).toMatchObject({ onCurrentRevision: false, carryTarget: null })
    expect(annotations.find((a) => a.id === 'p')?.carryTarget).not.toBeNull()
  })
})
