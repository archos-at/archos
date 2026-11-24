import { describe, expect, test } from 'vitest'
import { REGION_MAX_ZOOM, regionZoom, unionBox } from './use-pdf-region-frame'

const page = { width: 1000, height: 700 }
const frame = { width: 800, height: 600 }

describe('framing a region in the viewer', () => {
  test('zooms until the region fills about a third of the frame, the tighter side deciding', () => {
    expect(regionZoom({ box: [0.4, 0.4, 0.5, 0.45], page, frame, zoom: 1, maxZoom: 20 })).toBeCloseTo(
      (0.3 * 800) / 100
    )
  })

  test('never zooms out, and stops at the viewer’s limit', () => {
    expect(regionZoom({ box: [0, 0, 1, 1], page, frame, zoom: 1, maxZoom: 20 })).toBe(1)
    expect(regionZoom({ box: [0.5, 0.5, 0.5001, 0.5001], page, frame, zoom: 1, maxZoom: 4 })).toBe(4)
  })

  test('frames a short span with its surroundings instead of zooming in on it alone', () => {
    const span = { box: [0.5, 0.5, 0.51, 0.5] as [number, number, number, number], page, frame }
    expect(regionZoom({ ...span, zoom: 1, maxZoom: 24 })).toBe(REGION_MAX_ZOOM)
    expect(regionZoom({ ...span, zoom: 6, maxZoom: 24 })).toBe(6)
  })

  test('frames every region on the page together', () => {
    expect(
      unionBox([{ box: [0.1, 0.2, 0.3, 0.4] }, { box: [0.25, 0.1, 0.5, 0.3] }])
    ).toEqual([0.1, 0.1, 0.5, 0.4])
  })
})
