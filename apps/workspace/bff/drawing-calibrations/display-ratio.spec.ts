import { describe, expect, it } from 'vitest'
import {
  calibrationRatio,
  distancePt,
  formatRatio,
  metresPerPoint,
  ratioDenominator,
  regionBetween,
  regionHolding,
} from './display-ratio'

/** An A1 sheet lying on its long side, in points. */
const A1 = { width: 2383.94, height: 1683.78 }
/** Half of this page's width is 210 mm of paper. */
const HALF_IS_210_MM = { width: 1190.55, height: 841.89 }

describe('the ratio a calibration gives', () => {
  it('reads 1:100 from two points half a 1190.55 pt page apart and 21.0 m', () => {
    const from = { x: 0.25, y: 0.5 }
    const to = { x: 0.75, y: 0.5 }
    expect(distancePt(from, to, HALF_IS_210_MM)).toBeCloseTo(595.275, 3)
    const scale = metresPerPoint(from, to, 21, HALF_IS_210_MM)
    expect(scale).not.toBeNull()
    expect(ratioDenominator(scale ?? 0)).toBeCloseTo(100, 2)
    expect(calibrationRatio({ from, to, lengthM: 21 }, HALF_IS_210_MM)).toBe('1:100')
  })

  it('measures a slanted span over both axes of the page', () => {
    expect(distancePt({ x: 0, y: 0 }, { x: 1, y: 1 }, A1)).toBeCloseTo(Math.hypot(A1.width, A1.height), 6)
  })

  it('gives none for coinciding points or a length that is no length', () => {
    const point = { x: 0.4, y: 0.4 }
    expect(metresPerPoint(point, point, 5, A1)).toBeNull()
    expect(metresPerPoint(point, { x: 0.6, y: 0.4 }, 0, A1)).toBeNull()
    expect(metresPerPoint(point, { x: 0.6, y: 0.4 }, Number.NaN, A1)).toBeNull()
    expect(calibrationRatio({ from: point, to: point, lengthM: 5 }, A1)).toBeNull()
  })

  it('writes the ratio as a title block does', () => {
    expect(formatRatio(100.004)).toBe('1:100')
    expect(formatRatio(49.6)).toBe('1:50')
    expect(formatRatio(1000)).toBe('1:1000')
    expect(formatRatio(2.5)).toBe('1:2.5')
    expect(formatRatio(1)).toBe('1:1')
    expect(formatRatio(0.2)).toBe('5:1')
  })
})

describe('the stored region both points lie in', () => {
  const sheet = { x: 0.05, y: 0.05, w: 0.6, h: 0.9 }
  const detail = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
  const section = { x: 0.7, y: 0.05, w: 0.25, h: 0.5 }

  it('is the region holding both', () => {
    expect(regionHolding([sheet, section], { x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 })).toEqual(sheet)
  })

  it('is the smallest where regions nest', () => {
    expect(regionHolding([sheet, detail], { x: 0.15, y: 0.15 }, { x: 0.25, y: 0.2 })).toEqual(detail)
  })

  it('is none where the points lie in two regions, or in none', () => {
    expect(regionHolding([sheet, section], { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.3 })).toBeNull()
    expect(regionHolding([], { x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 })).toBeNull()
  })
})

describe('the box two corners span', () => {
  it('is the same box whichever corner came first', () => {
    const box = regionBetween({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 })
    expect(box?.x).toBeCloseTo(0.2)
    expect(box?.y).toBeCloseTo(0.3)
    expect(box?.w).toBeCloseTo(0.4)
    expect(box?.h).toBeCloseTo(0.4)
  })

  it('stays on the page and is none without an extent', () => {
    expect(regionBetween({ x: -0.2, y: 0.1 }, { x: 0.5, y: 1.4 })).toEqual({ x: 0, y: 0.1, w: 0.5, h: 0.9 })
    expect(regionBetween({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.6 })).toBeNull()
  })
})
