import type { BimElement } from './types'

/**
 * First POSITIVE value found at any of the named quantity keys.
 *
 * Every caller here reads a dimension — a clear width, a riser height, a room
 * height — and no building has one of zero. A `0` in a quantity set is an
 * exporter writing `$`: the parser substitutes zero for it, and
 * `ZERO_MEANS_ABSENT` in `extract.ts` drops those on the way in.
 *
 * This is the second guard, and it is here rather than only there because the
 * consequence is a false accusation: read as a measurement, an unmeasured
 * `ClearWidth` produces "Lichte Durchgangsbreite 0,00 m — nicht erfüllt" on an
 * escape-route rule, for a door that may be perfectly compliant. Rows already
 * in the database were extracted under the narrower rule, so without this
 * every model uploaded before that fix keeps failing until it is re-read.
 *
 * A negative is refused for the same reason: it is not a measurement either.
 */
export function quantity(element: BimElement, keys: readonly string[]): number | null {
  for (const set of Object.values(element.quantities)) {
    for (const key of keys) {
      const value = set[key]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    }
  }
  return null
}

/** First value found at any of the named property keys, across all sets. */
export function property(
  element: BimElement,
  keys: readonly string[]
): string | number | boolean | null {
  for (const set of Object.values(element.properties)) {
    for (const key of keys) {
      const value = set[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
  }
  return null
}

/**
 * A numeric property, tolerating the string a CAD sometimes writes.
 *
 * Reads the LEADING number and stops. The obvious implementation — strip every
 * non-numeric character and parse what is left — silently concatenates digits
 * that were never part of the value: `0,35 W/m2K` becomes `0.352`, which fails
 * a `≤ 0,35` check and reports a compliant wall as non-compliant. (The pretty
 * `m²` escapes because U+00B2 is not an ASCII digit; the plain `m2` a CAD
 * writes just as often does not.) A checker whose answer depends on how the
 * exporter spelled a unit is not a checker.
 *
 * Anything that does not START with a number is refused rather than mined for
 * digits, so `Klasse 2 gemäß ÖNORM` yields nothing instead of `2`.
 */
const LEADING_NUMBER = /^[+-]?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?/

export function numericProperty(element: BimElement, keys: readonly string[]): number | null {
  const raw = property(element, keys)
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return null
  const match = LEADING_NUMBER.exec(raw.trim())
  if (!match) return null
  const parsed = Number(match[0].replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The same read, for a DIMENSION.
 *
 * `numericProperty` also serves the U-value rules, where the number is a
 * physical property rather than a size and where a zero — however implausible
 * — is at least a statement. A width, a height or a tread length of zero or
 * less is not: see {@link quantity}.
 */
export function dimensionProperty(element: BimElement, keys: readonly string[]): number | null {
  const value = numericProperty(element, keys)
  return value !== null && value > 0 ? value : null
}
