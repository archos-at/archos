import { describe, expect, it } from 'vitest'
import type { AnnotationView } from '@/lib/annotations/types'
import { measurementTotals } from './measurement-total'

const kept = (value: number, unit: 'm' | 'm2', tolerance = 0.1) =>
  ({ reading: { value, unit, low: value - tolerance, high: value + tolerance } }) as AnnotationView

describe('the total of kept measurements', () => {
  it('sums each unit apart and carries the tolerances along', () => {
    const totals = measurementTotals([kept(12, 'm2'), kept(8.5, 'm2', 0.2), kept(3, 'm'), kept(2, 'm'), kept(1, 'm')])
    expect(totals).toHaveLength(2)
    expect(totals[0]).toMatchObject({ unit: 'm2', value: 20.5, count: 2 })
    expect(totals[0].high - totals[0].value).toBeCloseTo(0.3)
    expect(totals[1]).toMatchObject({ unit: 'm', value: 6, count: 3 })
  })

  it('says nothing for a lone measurement', () => {
    expect(measurementTotals([kept(12, 'm2'), kept(3, 'm')])).toEqual([])
  })
})
