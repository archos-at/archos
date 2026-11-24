export const MEASURE_QUANTITIES = ['clearance', 'distance', 'path', 'area'] as const
export const MEASURE_BASES = ['confirmed', 'estimated', 'printed'] as const

export interface StoredMeasure {
  quantity: (typeof MEASURE_QUANTITIES)[number]
  points: Array<[number, number]>
  value: number
  unit: 'm' | 'm2'
  basis: (typeof MEASURE_BASES)[number]
  ratio?: number
}

const MAX_POINTS = 60

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined

const isShare = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

const pointOf = (value: unknown): [number, number] | null =>
  Array.isArray(value) && value.length === 2 && value.every(isShare) ? [value[0], value[1]] : null

export function sanitizeMeasure(input: unknown): StoredMeasure | undefined {
  if (!isRecord(input) || !Array.isArray(input.points)) return undefined
  const quantity = oneOf(input.quantity, MEASURE_QUANTITIES)
  const basis = oneOf(input.basis, MEASURE_BASES)
  const unit = input.unit === 'm' || input.unit === 'm2' ? input.unit : undefined
  const value =
    typeof input.value === 'number' && Number.isFinite(input.value) && input.value >= 0
      ? input.value
      : undefined
  const points = input.points.slice(0, MAX_POINTS).map(pointOf)
  if (!quantity || !basis || !unit || value === undefined) return undefined
  if (points.length < 2 || points.some((point) => point === null)) return undefined
  const ratio =
    typeof input.ratio === 'number' && Number.isFinite(input.ratio) && input.ratio > 0
      ? input.ratio
      : undefined
  return {
    quantity,
    points: points as Array<[number, number]>,
    value,
    unit,
    basis,
    ...(ratio !== undefined ? { ratio } : {}),
  }
}
