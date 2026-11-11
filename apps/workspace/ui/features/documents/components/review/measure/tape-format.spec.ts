/**
 * @vitest-environment node
 */
/**
 * A reading as a person reads it: the value with a tolerance, and no digit the
 * tolerance does not support. The engine's numbers go in exact; only what is
 * shown is rounded.
 */
import { describe, expect, it } from 'vitest'
import { decimalsFor, formatRounded, formatScaleRatio, formatTolerance, toleranceOf, type ReadingNumbers } from './tape-format'

const length = (value: number, tolerance: number): ReadingNumbers => ({ value, low: value - tolerance, high: value + tolerance, unit: 'm' })
const area = (value: number, tolerance: number): ReadingNumbers => ({ value, low: value - tolerance, high: value + tolerance, unit: 'm2' })
const shown = (reading: ReadingNumbers, locale = 'de') => `${formatRounded(reading, locale)} ± ${formatTolerance(reading, locale)}`

describe('a length with its tolerance', () => {
  it.each([
    [length(7.385, 0.037), '7,39 m ± 4 cm'],
    [length(3.0, 0.015), '3,00 m ± 2 cm'],
    [length(4.25, 0.005), '4,25 m ± 1 cm'],
    [length(1.2004, 0.002), '1,200 m ± 2 mm'],
    [length(7.385, 0.12), '7,39 m ± 12 cm'],
    [length(42.38, 0.62), '42,4 m ± 62 cm'],
    [length(2.5, 0), '2,500 m ± 1 mm'],
  ])('%o reads %s', (reading, text) => {
    expect(shown(reading)).toBe(text)
  })

  it('is written in the reader’s locale', () => {
    expect(shown(length(7.385, 0.037), 'en')).toBe('7.39 m ± 4 cm')
  })
})

describe('an area with its tolerance', () => {
  it.each([
    [area(17.64, 0.071), '17,64 m² ± 0,07 m²'],
    [area(16.5, 0.066), '16,50 m² ± 0,07 m²'],
    [area(123.456, 0.4), '123,5 m² ± 0,4 m²'],
    [area(123.456, 2.4), '123 m² ± 2 m²'],
    [area(5.1234, 0.0004), '5,123 m² ± 0,001 m²'],
  ])('%o reads %s', (reading, text) => {
    expect(shown(reading)).toBe(text)
  })
})

describe('what the rounding rests on', () => {
  it('takes the wider side of an interval that is not symmetric', () => {
    expect(toleranceOf({ value: 4, low: 3.99, high: 4.04 })).toBeCloseTo(0.04)
  })

  it('never shows more decimals than the tolerance supports', () => {
    for (const tolerance of [0.0004, 0.004, 0.006, 0.04, 0.06, 0.4, 0.6, 4]) {
      const decimals = decimalsFor(tolerance, 'm')
      // The last shown digit of a length is never finer than a fifth of the tolerance, except at the centimetre floor.
      expect(10 ** -decimals >= tolerance / 100, `${tolerance}`).toBe(true)
      expect(decimalsFor(tolerance, 'm2')).toBeLessThanOrEqual(3)
    }
  })

  it('writes a scale as a person reads it', () => {
    expect(formatScaleRatio(100.00000000000001, 'de')).toBe('100')
    expect(formatScaleRatio(33.333, 'de')).toBe('33,33')
  })
})
