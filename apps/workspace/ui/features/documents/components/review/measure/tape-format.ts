/**
 * How a reading of the tape is written for a person: the value with a
 * tolerance, to no more digits than the tolerance supports. „7,39 m ± 4 cm“,
 * „17,64 m² ± 0,07 m²“.
 *
 * Display only. The engine's exact numbers are what is measured and what a
 * kept mark stores; this rounds them for the eye and converts nothing else.
 * The tolerance is half the engine's interval (it is symmetric about the
 * value; the wider side is taken where it is not).
 *
 * A length: under half a centimetre of tolerance the value is shown to the
 * millimetre with the tolerance in millimetres; from there on to the
 * centimetre with the tolerance in centimetres; from half a metre on to the
 * decimetre. An area: to the decimal place of its tolerance's first digit.
 */

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

/** Half the interval: what the value may be off by, either way. */
export const toleranceOf = ({ value, low, high }: Pick<ReadingNumbers, 'value' | 'low' | 'high'>): number =>
  Math.max(value - low, high - value, 0)

/** How many decimals of the value the tolerance supports. */
export function decimalsFor(tolerance: number, unit: TapeUnit): number {
  // A hair under the threshold is the threshold: 4.25 − 4.245 is 0.00499… in floating point.
  if (unit === 'm') return tolerance < 0.005 - 1e-9 ? 3 : tolerance < 0.5 - 1e-9 ? 2 : 1
  if (tolerance <= 0) return 2
  return Math.min(3, Math.max(0, Math.ceil(-Math.log10(tolerance))))
}

/** „7,39 m“: the value alone, rounded as its tolerance supports. What a kept measurement's label shows. */
export function formatRounded(reading: ReadingNumbers, locale: string): string {
  const decimals = decimalsFor(toleranceOf(reading), reading.unit)
  return `${fixed(locale, decimals).format(reading.value)} ${UNIT_LABEL[reading.unit]}`
}

/** „4 cm“, „3 mm“, „0,07 m²“: the tolerance in the unit a person would say it in, never shown as nothing. */
export function formatTolerance(reading: ReadingNumbers, locale: string): string {
  const tolerance = toleranceOf(reading)
  const decimals = decimalsFor(tolerance, reading.unit)
  if (reading.unit === 'm2') {
    const step = 10 ** -decimals
    return `${fixed(locale, decimals).format(Math.max(step, tolerance))} ${UNIT_LABEL.m2}`
  }
  const whole = fixed(locale, 0)
  if (decimals === 3) return `${whole.format(Math.max(1, Math.round(tolerance * 1000)))} mm`
  return `${whole.format(Math.max(1, Math.round(tolerance * 100)))} cm`
}

/** The N of 1:N, as a person reads a scale: a whole number where it is one. */
export function formatScaleRatio(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(ratio)
}
