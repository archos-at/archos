/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: vi.fn() }))
vi.mock('./repository', () => ({ listDrawingCalibrations: vi.fn() }))

import type { DrawingCalibrationRow } from '@/lib/db/schema/drawing-calibrations'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { activeCalibrationsOfPage } from './page-read'
import { listDrawingCalibrations } from './repository'

const TARGET = { documentId: 'doc_1', versionId: 'ver_1', page: 2 }
const ROW = {
  id: 'cal_1',
  regionX: 0.1,
  regionY: 0.2,
  regionW: 0.3,
  regionH: 0.4,
  pointAX: 0.15,
  pointAY: 0.25,
  pointBX: 0.35,
  pointBY: 0.25,
  referenceLengthM: 4,
} as Partial<DrawingCalibrationRow> as DrawingCalibrationRow

describe('activeCalibrationsOfPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hands the tool the active calibrations of the page, bounded, as an internal read', async () => {
    vi.mocked(isOrgFeatureEnabled).mockResolvedValue(true)
    vi.mocked(listDrawingCalibrations).mockResolvedValue([ROW])
    expect(await activeCalibrationsOfPage('org_1', TARGET)).toEqual([
      { id: 'cal_1', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, from: { x: 0.15, y: 0.25 }, to: { x: 0.35, y: 0.25 }, lengthM: 4 },
    ])
    expect(isOrgFeatureEnabled).toHaveBeenCalledWith('drawing-measure', 'org_1')
    expect(vi.mocked(listDrawingCalibrations).mock.calls[0]).toEqual([
      { organizationId: 'org_1', ...TARGET, status: 'active' },
      { kind: 'internal', why: 'reloaded' },
      { limit: 50, offset: 0 },
    ])
  })

  it('never hands over more than fifty', async () => {
    vi.mocked(isOrgFeatureEnabled).mockResolvedValue(true)
    vi.mocked(listDrawingCalibrations).mockResolvedValue(Array.from({ length: 51 }, () => ROW))
    expect(await activeCalibrationsOfPage('org_1', TARGET)).toHaveLength(50)
  })

  it('hands over none, and reads none, where the organization does not hold the entitlement', async () => {
    vi.mocked(isOrgFeatureEnabled).mockResolvedValue(false)
    expect(await activeCalibrationsOfPage('org_1', TARGET)).toEqual([])
    expect(listDrawingCalibrations).not.toHaveBeenCalled()
  })
})
