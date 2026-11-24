// A reading as a person reads it: the value to no more digits than its tolerance supports. Display only.
const UNIT_LABEL = { m: 'm', m2: 'm²' } as const
export type TapeUnit = keyof typeof UNIT_LABEL

export interface ReadingNumbers {
  value: number
  low: number
  high: number
  unit: TapeUnit
}

const fixed = (locale: string, decimals: number) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

export const toleranceOf = ({ value, low, high }: Pick<ReadingNumbers, 'value' | 'low' | 'high'>): number =>
  Math.max(value - low, high - value, 0)

export function decimalsFor(tolerance: number, unit: TapeUnit): number {
  if (unit === 'm') return tolerance < 0.005 - 1e-9 ? 3 : tolerance < 0.5 - 1e-9 ? 2 : 1
  if (tolerance <= 0) return 2
  return Math.min(3, Math.max(0, Math.ceil(-Math.log10(tolerance))))
}

export function formatRounded(reading: ReadingNumbers, locale: string): string {
  const decimals = decimalsFor(toleranceOf(reading), reading.unit)
  return `${fixed(locale, decimals).format(reading.value)} ${UNIT_LABEL[reading.unit]}`
}

export function formatTolerance(reading: ReadingNumbers, locale: string): string {
  const tolerance = toleranceOf(reading)
  const decimals = decimalsFor(tolerance, reading.unit)
  if (reading.unit === 'm2') {
    return `${fixed(locale, decimals).format(Math.max(10 ** -decimals, tolerance))} ${UNIT_LABEL.m2}`
  }
  const whole = fixed(locale, 0)
  if (decimals === 3) return `${whole.format(Math.max(1, Math.round(tolerance * 1000)))} mm`
  return `${whole.format(Math.max(1, Math.round(tolerance * 100)))} cm`
}

export function formatProvisional(value: number, unit: TapeUnit, locale: string): string {
  return `${fixed(locale, unit === 'm' ? 2 : 1).format(value)} ${UNIT_LABEL[unit]}`
}

export function formatScaleRatio(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(ratio)
}
