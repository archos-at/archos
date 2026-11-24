import { CalibrationRequestError, type CalibrationClient } from '@/lib/drawing-calibrations/client'
import { REGION_OVERLAPS, regionRelation, type CalibrationView } from '@/lib/drawing-calibrations/wire'

export const SHEET = { width: 2383.94, height: 1683.78 }

export const DOCUMENT_ID = '0b6f6a52-7d0c-4a55-9c59-3f1d2a7e1c01'
const VERSION_ID = '5f0f3c1e-2a44-4b7e-8d31-6c2b9e4a7d02'

export const LAYOUT_REGION = { x: 0.06, y: 0.1, w: 0.6, h: 0.78 }
export const SPAN_FROM = { x: 0.15, y: 141 / 706 }
export const SPAN_TO = { x: 0.15 + 595.276 / SHEET.width, y: 141 / 706 }

export const DETAIL_REGION = { x: 0.7, y: 0.18, w: 0.23, h: 0.27 }
export const CROSSING_REGION = { x: 0.68, y: 0.12, w: 0.14, h: 0.36 }

const view = (overrides: Partial<CalibrationView>): CalibrationView => ({
  id: 'a3c1d5e7-1b2c-4d3e-8f4a-5b6c7d8e9f03',
  documentId: DOCUMENT_ID,
  versionId: VERSION_ID,
  page: 1,
  region: LAYOUT_REGION,
  from: SPAN_FROM,
  to: SPAN_TO,
  lengthM: 21,
  scope: 'page',
  referenceSize: null,
  status: 'active',
  createdBy: 'user_anna',
  createdAt: '2026-11-04T09:12:00.000Z',
  withdrawnAt: null,
  withdrawnBy: null,
  ...overrides,
})

export const LAYOUT_SCALE = view({})

export const DETAIL_SCALE = view({
  id: 'b4d2e6f8-2c3d-4e5f-9a1b-6c7d8e9f0a14',
  region: DETAIL_REGION,
  from: { x: 0.72, y: 0.43 },
  to: { x: 0.72 + 141.73 / SHEET.width, y: 0.43 },
  lengthM: 1,
  createdBy: 'user_me',
  createdAt: '2026-11-20T15:40:00.000Z',
})

export const PAGE_SCALE = view({
  id: 'c5e3f7a9-3d4e-4f6a-8b2c-7d8e9f0a1b25',
  region: { x: 0, y: 0, w: 1, h: 1 },
  lengthM: 42,
  createdAt: '2026-10-28T08:05:00.000Z',
})

export const DOCUMENT_SCALE = view({
  id: 'd6f4a8b0-4e5f-4a7b-9c3d-8e9f0a1b2c36',
  page: 3,
  scope: 'document',
  referenceSize: { widthPt: SHEET.width, heightPt: SHEET.height },
  region: { x: 0, y: 0, w: 1, h: 1 },
  lengthM: 42,
  createdAt: '2026-11-22T08:05:00.000Z',
})

export function fixtureClient(initial: readonly CalibrationView[], canCalibrate = true): CalibrationClient {
  let held = [...initial]
  return {
    list: async () => ({ calibrations: held, nextCursor: null, versionId: VERSION_ID, canCalibrate }),
    set: async (_documentId, input) => {
      const { pageSize, ...rest } = input
      const everyPage = input.scope === 'document'
      const among = held.filter((entry) => (everyPage ? entry.scope === 'document' : entry.scope === 'page' && entry.page === input.page))
      const crossing = everyPage ? undefined : among.find((entry) => regionRelation(input.region, entry.region) === 'overlaps')
      if (crossing) throw new CalibrationRequestError(409, REGION_OVERLAPS, 'overlaps', crossing.id)
      const replaced = among.filter((entry) => everyPage || regionRelation(input.region, entry.region) === 'same')
      const made = view({ ...rest, referenceSize: pageSize ?? null, id: crypto.randomUUID(), createdBy: 'user_me', createdAt: new Date().toISOString() })
      held = [...held.filter((entry) => !replaced.includes(entry)), made]
      return made
    },
    withdraw: async (_documentId, calibrationId) => {
      const gone = held.find((entry) => entry.id === calibrationId) ?? LAYOUT_SCALE
      held = held.filter((entry) => entry.id !== calibrationId)
      return { ...gone, status: 'withdrawn', withdrawnAt: new Date().toISOString(), withdrawnBy: 'user_me' }
    },
  }
}
