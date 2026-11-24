/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documents/access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('@/lib/drawing-calibrations/repository', () => ({ listDrawingCalibrations: vi.fn() }))
vi.mock('@/lib/drawing-calibrations/service', () => ({
  isPdfDocument: (doc: { filename: string }) => doc.filename.endsWith('.pdf'),
}))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({
  shelfReaderFor: vi.fn(async () => ({ kind: 'reader' })),
}))
vi.mock('@/lib/turns/signed-envelope', () => ({
  signedEnvelopeHeaders: vi.fn(async () => ({
    'x-request-context': 'ctx',
    'x-request-context-sig': 'sig',
  })),
}))
vi.mock('@/lib/internal-auth', () => ({
  InternalServiceUnavailableError: class extends Error {},
  internalServiceHeaders: vi.fn(() => ({ 'x-internal-token': 'token' })),
}))
vi.mock('@/lib/backend-url', () => ({ getBackendUrl: () => 'http://backend.test' }))

import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { getAccessibleDocument } from '@/lib/documents/access'
import { listDrawingCalibrations } from '@/lib/drawing-calibrations/repository'
import type { AuthorizedSession } from '@/lib/auth/types'
import { snapTargetsOfDocument } from './snap-targets'

const SESSION = {
  userId: 'u1',
  organizationId: 'org_1',
  featureFlags: ['drawing-measure'],
} as unknown as AuthorizedSession
const DOC = {
  id: 'doc-1',
  filename: 'plan.pdf',
  collectionName: 'p_1',
  projectId: 'proj-1',
  publishedVersionId: 'ver-1',
  contentType: 'application/pdf',
}
const TARGETS = {
  documentId: 'doc-1',
  versionId: 'ver-1',
  page: 2,
  widthPt: 100,
  heightPt: 50,
  widthMm: 35,
  heightMm: 17,
  rotation: 0,
  scan: false,
  vertices: [0.1, 0.2],
  segments: [],
  totalSegments: 0,
  truncated: false,
  scales: [],
}
const ROW = {
  id: 'cal-1',
  regionX: 0,
  regionY: 0,
  regionW: 0.5,
  regionH: 0.5,
  pointAX: 0.1,
  pointAY: 0.1,
  pointBX: 0.2,
  pointBY: 0.1,
  referenceLengthM: 5,
}
const backend = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  vi.stubEnv('INTERNAL_API_TOKEN', 'secret')
  vi.mocked(getAccessibleDocument).mockResolvedValue(DOC as never)
  vi.mocked(listDrawingCalibrations).mockResolvedValue([])
  backend.mockImplementation(async () => Response.json({ targets: TARGETS }))
  vi.stubGlobal('fetch', backend)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('snapTargetsOfDocument', () => {
  it('asks the engine for the page under the persons envelope and tags the answer by version and calibrations', async () => {
    const response = await snapTargetsOfDocument(SESSION, 'doc-1', 2, null)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ targets: TARGETS })
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(response.headers.get('ETag')).toMatch(/^"ver-1\.2\..+"$/)
    const [url, init] = backend.mock.calls[0]
    expect(url).toBe('http://backend.test/v1/internal/drawing-snap-targets')
    expect(JSON.parse(String(init?.body))).toEqual({
      file_name: 'plan.pdf',
      collection: 'p_1',
      page: 2,
      stated_kinds: ['pdf'],
    })
    expect(init?.headers).toMatchObject({ 'x-request-context': 'ctx', 'x-internal-token': 'token' })
  })

  it('answers 304 without the engine while version and calibrations are unchanged, and a new tag after a calibration', async () => {
    const tag = (await snapTargetsOfDocument(SESSION, 'doc-1', 2, null)).headers.get('ETag')
    backend.mockClear()

    expect((await snapTargetsOfDocument(SESSION, 'doc-1', 2, tag)).status).toBe(304)
    expect(backend).not.toHaveBeenCalled()

    vi.mocked(listDrawingCalibrations).mockResolvedValue([ROW] as never)
    const changed = await snapTargetsOfDocument(SESSION, 'doc-1', 2, tag)
    expect(changed.status).toBe(200)
    expect(changed.headers.get('ETag')).not.toBe(tag)
  })

  it('does not cache a page the engine could not read', async () => {
    backend.mockImplementation(async () => Response.json({ unavailable: { reason: 'too large' } }))
    const response = await snapTargetsOfDocument(SESSION, 'doc-1', 1, null)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('refuses without the entitlement before reading the document, and refuses a file that is no PDF', async () => {
    await expect(
      snapTargetsOfDocument({ ...SESSION, featureFlags: [] } as never, 'doc-1', 1, null)
    ).rejects.toBeInstanceOf(FeatureDisabledError)
    expect(getAccessibleDocument).not.toHaveBeenCalled()
    vi.mocked(getAccessibleDocument).mockResolvedValue({
      ...DOC,
      filename: 'plan.dxf',
      contentType: null,
    } as never)
    await expect(snapTargetsOfDocument(SESSION, 'doc-1', 1, null)).rejects.toMatchObject({
      status: 422,
    })
  })

  it('says the engine answered in a form it does not read', async () => {
    backend.mockImplementation(async () =>
      Response.json({ targets: { ...TARGETS, vertices: [2] } })
    )
    await expect(snapTargetsOfDocument(SESSION, 'doc-1', 1, null)).rejects.toMatchObject({
      status: 502,
    })
  })
})
