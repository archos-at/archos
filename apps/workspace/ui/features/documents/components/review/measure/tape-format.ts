/**
 * How a reading of the tape is written for a person. Formatting only: the
 * digits are the engine's, to the three decimals its own text answer prints
 * (`sheet_answers._number`), in the reader's locale. Nothing is converted and
 * nothing is derived: an interval is shown as its two ends, as given.
 */

const UNIT_LABEL = { m: 'm', m2: 'm²' } as const
export type TapeUnit = keyof typeof UNIT_LABEL

const numberFormat = (locale: string) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 })

/** „4,000 m“, „12,500 m²“. */
export function formatReading(value: number, unit: TapeUnit, locale: string): string {
  return `${numberFormat(locale).format(value)} ${UNIT_LABEL[unit]}`
}

/** The N of 1:N, as a person reads a scale: a whole number where it is one. */
export function formatScaleRatio(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(ratio)
}
