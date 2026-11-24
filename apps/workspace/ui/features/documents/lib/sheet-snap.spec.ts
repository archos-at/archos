/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { SnapScale } from '@/lib/drawing-tape/snap-wire'
import {
  buildSnapIndex,
  provisionalArea,
  provisionalLength,
  snapPoint,
  type SharePoint,
} from './sheet-snap'

const PAGE = { width: 1000, height: 500 }
const index = buildSnapIndex({
  vertices: [0.1, 0.1, 0.5, 0.1, 0.104, 0.1],
  segments: [0.1, 0.1, 0.5, 0.1, 0.5, 0.1, 0.5, 0.9],
})
const page: SnapScale = {
  region: null,
  state: 'estimated',
  source: 'scale_note',
  metresPerShare: [20, 10],
  ratio: 100,
}

describe('snapPoint', () => {
  it('takes the nearest vertex in reach before any line', () => {
    expect(snapPoint(index, [0.103, 0.104], PAGE, 6)).toEqual({ at: [0.104, 0.1], kind: 'vertex' })
  })

  it('falls back to the nearest point on a line, measured in pixels of the page as shown', () => {
    const snapped = snapPoint(index, [0.3, 0.108], PAGE, 6)
    expect(snapped?.kind).toBe('edge')
    expect(snapped?.at[0]).toBeCloseTo(0.3)
    expect(snapped?.at[1]).toBeCloseTo(0.1)
    expect(snapPoint(index, [0.3, 0.115], PAGE, 6)).toBeNull()
  })

  it('stays fast and right with thousands of targets', () => {
    const vertices: number[] = []
    const segments: number[] = []
    for (let i = 0; i < 20_000; i += 1) {
      const [x, y] = [(i % 200) / 200, Math.floor(i / 200) / 100]
      vertices.push(x, y)
      segments.push(x, y, x + 0.004, y)
    }
    const big = buildSnapIndex({ vertices, segments })
    const started = performance.now()
    for (let i = 0; i < 2_000; i += 1) snapPoint(big, [Math.random(), Math.random()], PAGE, 8)
    expect(performance.now() - started).toBeLessThan(500)
    expect(snapPoint(big, [0.5012, 0.5004], PAGE, 8)).toEqual({ at: [0.5, 0.5], kind: 'vertex' })
  })
})

describe('provisional numbers', () => {
  const square: SharePoint[] = [
    [0.1, 0.1],
    [0.2, 0.1],
    [0.2, 0.3],
    [0.1, 0.3],
  ]

  it('measures a path and an area in metres from the scale per share of the page', () => {
    expect(provisionalLength(square.slice(0, 3), [page])).toBeCloseTo(2 + 2)
    expect(provisionalArea(square, [page])).toBeCloseTo(2 * 2)
  })

  it('takes a covering calibration over a larger region and gives no number across two regions', () => {
    const calibrated: SnapScale = {
      ...page,
      region: [0, 0, 0.25, 0.25],
      source: 'calibration',
      state: 'verified',
      metresPerShare: [40, 20],
    }
    expect(
      provisionalLength(
        [
          [0.1, 0.1],
          [0.2, 0.1],
        ],
        [page, calibrated]
      )
    ).toBeCloseTo(4)
    expect(
      provisionalLength(
        [
          [0.1, 0.1],
          [0.3, 0.1],
        ],
        [page, calibrated]
      )
    ).toBeNull()
  })

  it('gives no number where the covering region has no scale, or nothing covers the points', () => {
    const unscaled: SnapScale = {
      ...page,
      region: [0, 0, 0.5, 0.5],
      state: 'uncalibrated',
      source: 'stored_region',
      metresPerShare: null,
      ratio: null,
    }
    expect(
      provisionalLength(
        [
          [0.1, 0.1],
          [0.2, 0.1],
        ],
        [page, unscaled]
      )
    ).toBeNull()
    expect(
      provisionalLength(
        [
          [0.1, 0.1],
          [0.2, 0.1],
        ],
        []
      )
    ).toBeNull()
    expect(provisionalArea(square.slice(0, 2), [page])).toBeNull()
  })
})
