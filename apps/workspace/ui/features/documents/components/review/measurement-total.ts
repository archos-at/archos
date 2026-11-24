import type { AnnotationView } from '@/lib/annotations/types'
import type { ReadingNumbers, TapeUnit } from '../../lib/tape-format'

export type MeasurementTotal = ReadingNumbers & { count: number }

export function measurementTotals(measurements: readonly AnnotationView[]): MeasurementTotal[] {
  const totals = new Map<TapeUnit, MeasurementTotal>()
  for (const { reading } of measurements) {
    if (!reading) continue
    const sum = totals.get(reading.unit) ?? { value: 0, low: 0, high: 0, unit: reading.unit, count: 0 }
    totals.set(reading.unit, {
      ...sum,
      value: sum.value + reading.value,
      low: sum.low + reading.low,
      high: sum.high + reading.high,
      count: sum.count + 1,
    })
  }
  return [...totals.values()].filter((total) => total.count > 1)
}
