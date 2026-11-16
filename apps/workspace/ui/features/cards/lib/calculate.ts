import type { CalculationLimitData, CalculationOperandData, CalculationStepData, DimStatus } from '@/shared/cards/schemas'

export interface StepResult {
  value: number | null
  tolerance: number | null
  unit: string
  undecidable: 'missing' | 'undefined' | null
}

export type Derivation = StepResult[]

export interface StepDisplay {
  decimals: number
  fixed?: boolean
}

const PERCENT = '%'

const unitOf = (step: CalculationStepData): string =>
  step.operation === 'percent_ratio' ? PERCENT : (step.unit ?? '')

const resolve = (
  operand: CalculationOperandData,
  earlier: Derivation
): { value: number | null; tolerance: number | null; undefinedHere?: boolean } => {
  if (operand.step != null) {
    const referenced = earlier[operand.step - 1]
    if (!referenced) return { value: null, tolerance: null }
    return {
      value: referenced.value,
      tolerance: referenced.tolerance,
      undefinedHere: referenced.undecidable === 'undefined',
    }
  }
  const value = typeof operand.value === 'number' && Number.isFinite(operand.value) ? operand.value : null
  const tolerance =
    operand.provenance === 'computed' && typeof operand.tolerance === 'number' && operand.tolerance > 0
      ? operand.tolerance
      : null
  return { value, tolerance }
}

const missing = (unit: string, why: 'missing' | 'undefined'): StepResult => ({
  value: null,
  tolerance: null,
  unit,
  undecidable: why,
})

const relativeBand = (result: number, parts: Array<{ value: number; tolerance: number | null }>): number | null => {
  let relative = 0
  let any = false
  for (const part of parts) {
    if (part.tolerance == null) continue
    if (part.value === 0) return null
    relative += part.tolerance / Math.abs(part.value)
    any = true
  }
  return any ? Math.abs(result) * relative : null
}

const evaluateStep = (step: CalculationStepData, earlier: Derivation): StepResult => {
  const unit = unitOf(step)
  const parts = step.operands.map((operand) => ({ operand, ...resolve(operand, earlier) }))
  if (parts.some((part) => part.value == null)) {
    return missing(unit, parts.some((part) => part.undefinedHere) ? 'undefined' : 'missing')
  }
  const values = parts as Array<{ operand: CalculationOperandData; value: number; tolerance: number | null }>

  switch (step.operation) {
    case 'sum': {
      let total = 0
      let band = 0
      let banded = false
      for (const part of values) {
        const factor = typeof part.operand.factor === 'number' ? part.operand.factor : 1
        total += factor * part.value
        if (part.tolerance != null) {
          band += Math.abs(factor) * part.tolerance
          banded = true
        }
      }
      return { value: total, tolerance: banded ? band : null, unit, undecidable: null }
    }
    case 'product': {
      const product = values.reduce((acc, part) => acc * part.value, 1)
      return { value: product, tolerance: relativeBand(product, values), unit, undecidable: null }
    }
    case 'quotient': {
      const [numerator, denominator] = values
      if (denominator.value === 0) return missing(unit, 'undefined')
      const quotient = numerator.value / denominator.value
      return { value: quotient, tolerance: relativeBand(quotient, values), unit, undecidable: null }
    }
    case 'percent_of': {
      const [base, percent] = values
      const result = (base.value * percent.value) / 100
      return { value: result, tolerance: relativeBand(result, values), unit, undecidable: null }
    }
    case 'percent_ratio': {
      const [part, whole] = values
      if (whole.value === 0) return missing(PERCENT, 'undefined')
      const ratio = (part.value / whole.value) * 100
      return { value: ratio, tolerance: relativeBand(ratio, values), unit: PERCENT, undecidable: null }
    }
    default:
      return missing(unit, 'missing')
  }
}

export const evaluate = (steps: CalculationStepData[]): Derivation => {
  const results: Derivation = []
  for (const step of steps) results.push(evaluateStep(step, results))
  return results
}

const onBound = (value: number, bound: number): boolean =>
  Math.abs(value - bound) <= 1e-9 * Math.max(1, Math.abs(bound))

const settle = (value: number, bounds: number[]): number => {
  for (const bound of bounds) if (onBound(value, bound)) return bound
  return value
}

export const verdictFor = (result: StepResult, limit: CalculationLimitData | null | undefined): DimStatus | null => {
  if (!limit) return null
  if (result.value == null) return 'needs_input'
  const upper = limit.comparator === 'between' ? (limit.upper ?? limit.value) : limit.value
  const bounds = [limit.value, upper]
  const band = result.tolerance ?? 0
  const value = settle(result.value, bounds)
  const low = settle(result.value - band, bounds)
  const high = settle(result.value + band, bounds)

  if (limit.comparator === 'between') {
    if ((low < limit.value && high >= limit.value) || (low <= upper && high > upper)) return 'warning'
    return value >= limit.value && value <= upper ? 'pass' : 'fail'
  }
  if (limit.comparator === '<=') {
    if (low <= limit.value && high > limit.value) return 'warning'
    return value <= limit.value ? 'pass' : 'fail'
  }
  if (high >= limit.value && low < limit.value) return 'warning'
  return value >= limit.value ? 'pass' : 'fail'
}

export const MAX_RESULT_DECIMALS = 12

export const resultDecimals = (result: StepResult, limit: CalculationLimitData | null | undefined): number => {
  const exact = verdictFor(result, limit)
  if (result.value == null || exact == null) return 2
  for (let decimals = 2; decimals < MAX_RESULT_DECIMALS; decimals += 1) {
    const factor = 10 ** decimals
    const rounded = Math.round(result.value * factor) / factor
    if (verdictFor({ ...result, value: rounded }, limit) === exact) return decimals
  }
  return MAX_RESULT_DECIMALS
}

const formatters = new Map<string, Intl.NumberFormat>()
const formatter = (min: number, max: number): Intl.NumberFormat => {
  const key = `${min}:${max}`
  let format = formatters.get(key)
  if (!format) {
    format = new Intl.NumberFormat('de-AT', { minimumFractionDigits: min, maximumFractionDigits: max })
    formatters.set(key, format)
  }
  return format
}

export const formatResult = (value: number, decimals: number, fixed = false): string =>
  formatter(fixed || decimals > 2 ? decimals : 0, decimals).format(value)

export const formatInput = (value: number): string => formatter(0, 10).format(value)
