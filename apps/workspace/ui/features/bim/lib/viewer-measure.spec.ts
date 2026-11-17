/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  addMeasurement,
  completeMeasurement,
  distanceMetres,
  formatMetres,
  horizontalMetres,
  isSkew,
  measurementId,
  midpoint,
  verticalMetres,
  type MeasureAnchor,
} from './viewer-measure'

const at = (x: number, y: number, z: number): MeasureAnchor => ({
  point: { x, y, z },
  snap: 'vertex',
})

describe('the numbers a measurement reports', () => {
  it('measures the straight line between the picks', () => {
    expect(distanceMetres({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5)
  })

  it('measures the horizontal run on the ground plane, not on X/Y', () => {
    const from = { x: 0, y: 0, z: 0 }
    const to = { x: 3, y: 10, z: 4 }
    expect(horizontalMetres(from, to)).toBe(5)
  })

  it('reports the rise with the sign the picks were taken in', () => {
    expect(verticalMetres({ x: 0, y: 3, z: 0 }, { x: 0, y: 2.6, z: 0 })).toBeCloseTo(-0.4, 10)
  })

  it('puts the label halfway along the line', () => {
    expect(midpoint({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 })).toEqual({ x: 1, y: 2, z: 3 })
  })
})

describe('when the components are worth printing', () => {
  it('stays quiet on a purely horizontal measurement', () => {
    expect(isSkew({ x: 0, y: 2, z: 0 }, { x: 2.4, y: 2, z: 0 })).toBe(false)
  })

  it('stays quiet on a purely vertical one', () => {
    expect(isSkew({ x: 1, y: 0, z: 1 }, { x: 1, y: 2.7, z: 1 })).toBe(false)
  })

  it('speaks up on a diagonal, where one number answers nothing', () => {
    expect(isSkew({ x: 0, y: 0, z: 0 }, { x: 3, y: 1.5, z: 0 })).toBe(true)
  })
})

describe('how a length is written', () => {
  it('keeps the trailing zero a dimension needs', () => {
    expect(formatMetres(2.4, 'en-GB')).toBe('2.40 m')
    expect(formatMetres(2.4, 'de-AT')).toBe('2,40 m')
    expect(formatMetres(1, 'en-GB')).toBe('1.00 m')
  })

  it('rounds to the centimetre', () => {
    expect(formatMetres(1.20449, 'en-GB')).toBe('1.20 m')
    expect(formatMetres(1.206, 'en-GB')).toBe('1.21 m')
  })

  it('switches to millimetres rather than printing 0.00 m', () => {
    expect(formatMetres(0.004, 'en-GB')).toBe('4 mm')
    expect(formatMetres(-0.004, 'en-GB')).toBe('-4 mm')
  })

  it('says so plainly when there is no number', () => {
    expect(formatMetres(Number.NaN, 'en-GB')).toBe('—')
    expect(formatMetres(Number.POSITIVE_INFINITY, 'en-GB')).toBe('—')
  })
})

describe('closing a measurement', () => {
  it('refuses a pick that did not move', () => {
    expect(completeMeasurement(at(1, 2, 3), at(1, 2, 3))).toBeNull()
    expect(completeMeasurement(at(1, 2, 3), at(1, 2.0005, 3))).toBeNull()
  })

  it('accepts a millimetre of travel', () => {
    expect(completeMeasurement(at(0, 0, 0), at(0, 0.0011, 0))).not.toBeNull()
  })

  it('keeps how each end was placed', () => {
    const measured = completeMeasurement(
      { point: { x: 0, y: 0, z: 0 }, snap: 'vertex' },
      { point: { x: 1, y: 0, z: 0 }, snap: 'face' }
    )
    expect(measured?.from.snap).toBe('vertex')
    expect(measured?.to.snap).toBe('face')
  })
})

describe('the list of measurements', () => {
  it('gives the same pair of picks the same identity', () => {
    expect(measurementId({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).toBe(
      measurementId({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    )
  })

  it('does not stack a re-measurement on top of itself', () => {
    const one = completeMeasurement(at(0, 0, 0), at(2, 0, 0))
    const again = completeMeasurement(at(0, 0, 0), at(2, 0, 0))
    expect(one).not.toBeNull()
    const list = addMeasurement(addMeasurement([], one!), again!)
    expect(list).toHaveLength(1)
  })

  it('keeps distinct measurements', () => {
    const one = completeMeasurement(at(0, 0, 0), at(2, 0, 0))!
    const other = completeMeasurement(at(0, 0, 0), at(0, 3, 0))!
    expect(addMeasurement([one], other)).toHaveLength(2)
  })
})
