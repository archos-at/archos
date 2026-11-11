import { describe, expect, it } from 'vitest'
import { CALIBRATION_LIFECYCLE, inRegion, listCalibrationsQuerySchema, setCalibrationRequestSchema } from './wire'

const VALID = {
  page: 1,
  region: { x: 0.1, y: 0.1, w: 0.5, h: 0.4 },
  from: { x: 0.2, y: 0.2 },
  to: { x: 0.5, y: 0.2 },
  lengthM: 5.4,
}

const issuesOf = (input: unknown) => {
  const parsed = setCalibrationRequestSchema.safeParse(input)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
}

describe('the set-calibration request', () => {
  it('accepts two different points inside a region on the page', () => {
    expect(setCalibrationRequestSchema.parse(VALID)).toEqual(VALID)
  })

  it('accepts a region that reaches the page edge, and points on the region edge', () => {
    const edge = { ...VALID, region: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 1 } }
    expect(issuesOf(edge)).toEqual([])
  })

  it.each([
    ['a region that leaves the page to the right', { region: { x: 0.8, y: 0.1, w: 0.5, h: 0.4 } }],
    ['a region that leaves the page at the bottom', { region: { x: 0.1, y: 0.9, w: 0.5, h: 0.4 } }],
    ['a region without width', { region: { x: 0.1, y: 0.1, w: 0, h: 0.4 } }],
    ['a negative origin', { region: { x: -0.1, y: 0.1, w: 0.5, h: 0.4 } }],
    ['a share above one', { from: { x: 1.2, y: 0.2 } }],
    ['page zero', { page: 0 }],
    ['a page that is no whole number', { page: 1.5 }],
    ['a length of zero', { lengthM: 0 }],
    ['a negative length', { lengthM: -3 }],
    ['a length past the bound', { lengthM: 100_001 }],
    ['a length that is no number', { lengthM: Number.NaN }],
  ])('refuses %s', (_name, change) => {
    expect(setCalibrationRequestSchema.safeParse({ ...VALID, ...change }).success).toBe(false)
  })

  it('requires the region: it is never the page by default', () => {
    const { region: _region, ...withoutRegion } = VALID
    expect(setCalibrationRequestSchema.safeParse(withoutRegion).success).toBe(false)
  })

  it('refuses a point outside the region', () => {
    expect(issuesOf({ ...VALID, to: { x: 0.7, y: 0.2 } })).toEqual(['Both reference points must lie inside the region.'])
    expect(issuesOf({ ...VALID, from: { x: 0.2, y: 0.05 } })).toEqual(['Both reference points must lie inside the region.'])
  })

  it('refuses two points at the same place', () => {
    expect(issuesOf({ ...VALID, to: VALID.from })).toEqual(['The two reference points must differ.'])
  })

  it('refuses a field it does not know, a derived scale included', () => {
    expect(setCalibrationRequestSchema.safeParse({ ...VALID, metresPerPoint: 0.01 }).success).toBe(false)
  })
})

describe('inRegion', () => {
  it('counts the edge as inside', () => {
    const region = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }
    expect(inRegion({ x: 0.2, y: 0.4 }, region)).toBe(true)
    expect(inRegion({ x: 0.41, y: 0.3 }, region)).toBe(false)
  })
})

describe('the list query', () => {
  it('reads page, status, limit and cursor from a query string', () => {
    expect(listCalibrationsQuerySchema.parse({ page: '3', status: 'withdrawn', limit: '10', cursor: '10' })).toEqual({
      page: 3,
      status: 'withdrawn',
      limit: 10,
      cursor: '10',
    })
  })

  it('refuses an unknown status and a limit past the bound', () => {
    expect(listCalibrationsQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false)
    expect(listCalibrationsQuerySchema.safeParse({ limit: '201' }).success).toBe(false)
  })
})

describe('the calibration lifecycle', () => {
  it('ends an active calibration by superseding or withdrawing it, and revives nothing', () => {
    expect(CALIBRATION_LIFECYCLE.birthStates).toEqual(['active'])
    expect(CALIBRATION_LIFECYCLE.sourcesOf('supersede')).toEqual(['active'])
    expect(CALIBRATION_LIFECYCLE.sourcesOf('withdraw')).toEqual(['active'])
    expect(CALIBRATION_LIFECYCLE.finalStates).toEqual(['superseded', 'withdrawn'])
  })
})
