/**
 * @vitest-environment node
 *
 * The BCF download route.
 *
 * Two things have to hold, and neither is about the archive's contents (that
 * is `lib/bim/bcf.spec.ts`): the response must present as a FILE — a browser
 * that renders the bytes inline instead of saving them has silently lost the
 * export — and the facts in the URL must reach the service unchanged, because
 * a Gebäudeklasse that gets dropped between the panel and the export produces
 * an archive whose fire-resistance thresholds belong to a different building.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'planer@example.at',
    role: 'admin',
  }),
}))

vi.mock('@/lib/bim/model-service', () => ({
  exportAccessibleComplianceBcf: vi.fn().mockResolvedValue({
    filename: 'compliance-checks-wohnhaus-2026-05-04.bcfzip',
    bytes: new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    topics: 3,
  }),
}))

import { GET } from './route'
import { exportAccessibleComplianceBcf } from '@/lib/bim/model-service'
import { BIM_EXPORT_LIMIT, createInProcessStore, setLimitStore } from '@/lib/limits'

const MODEL_ID = '3f6e1c2a-0000-4000-8000-000000000001'

const call = (query: string): Promise<Response> =>
  GET(new Request(`https://example.test/api/projects/proj-1/bim/checks/export${query}`), {
    params: Promise.resolve({ id: 'proj-1' }),
  })

beforeEach(() => setLimitStore(createInProcessStore()))
afterEach(() => setLimitStore(null))

describe('GET /api/projects/[id]/bim/checks/export', () => {
  beforeEach(() => vi.clearAllMocks())

  it('serves the archive as a download named after the revision', async () => {
    const response = await call(`?modelId=${MODEL_ID}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="compliance-checks-wohnhaus-2026-05-04.bcfzip"'
    )
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(response.headers.get('X-Grid-Bcf-Topics')).toBe('3')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x4b, 0x05, 0x06])
    )
  })

  it('passes the project facts through to the catalogue run', async () => {
    await call(`?modelId=${MODEL_ID}&buildingClass=4&mainUse=wohnen`)

    expect(exportAccessibleComplianceBcf).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      'proj-1',
      { modelId: MODEL_ID, modelName: null, buildingClass: 4, mainUse: 'residential' }
    )
  })

  it('drops a fact it cannot read rather than guessing one', async () => {
    await call(`?modelId=${MODEL_ID}&buildingClass=7`)

    expect(exportAccessibleComplianceBcf).toHaveBeenCalledWith(expect.anything(), 'proj-1', {
      modelId: MODEL_ID,
      modelName: null,
      buildingClass: null,
      mainUse: null,
    })
  })

  it('accepts a model addressed by file name, the way a chat answer links one', async () => {
    await call('?model=Haus-A_V3.ifc&buildingClass=4')

    expect(exportAccessibleComplianceBcf).toHaveBeenCalledWith(expect.anything(), 'proj-1', {
      modelId: null,
      modelName: 'Haus-A_V3.ifc',
      buildingClass: 4,
      mainUse: null,
    })
  })

  it('rejects a request that names no model at all', async () => {
    expect((await call('')).status).toBe(400)
    expect(exportAccessibleComplianceBcf).not.toHaveBeenCalled()
  })

  it('is bounded, because one GET here runs the whole catalogue', async () => {
    const first = await Promise.all([
      call(`?modelId=${MODEL_ID}`),
      call(`?modelId=${MODEL_ID}`),
      call(`?modelId=${MODEL_ID}`),
      call(`?modelId=${MODEL_ID}`),
    ])
    expect(first.some((response) => response.status === 429)).toBe(true)
    expect(BIM_EXPORT_LIMIT.name).toBe('bim-export')
  })

  it('rejects a model id that is not an id', async () => {
    expect((await call('?modelId=../../etc/passwd')).status).toBe(400)
    expect(exportAccessibleComplianceBcf).not.toHaveBeenCalled()
  })
})
