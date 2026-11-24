import { describe, expect, test } from 'vitest'
import { sanitizeMeasure } from './message-measure'

const shape = {
  quantity: 'distance',
  points: [
    [0.1, 0.2],
    [0.3, 0.2],
  ],
  value: 4.2,
  unit: 'm',
  basis: 'confirmed',
  ratio: 50,
}

describe('sanitizeMeasure', () => {
  test('keeps a well-formed shape as it came', () => {
    expect(sanitizeMeasure(shape)).toEqual(shape)
  })

  test('drops a shape with a point off the page, one point, or an unknown basis', () => {
    expect(
      sanitizeMeasure({
        ...shape,
        points: [
          [0.1, 0.2],
          [1.3, 0.2],
        ],
      })
    ).toBeUndefined()
    expect(sanitizeMeasure({ ...shape, points: [[0.1, 0.2]] })).toBeUndefined()
    expect(sanitizeMeasure({ ...shape, basis: 'guessed' })).toBeUndefined()
  })

  test('a ratio that is not a scale is left out, not the shape', () => {
    const { ratio: _ratio, ...rest } = shape
    expect(sanitizeMeasure({ ...shape, ratio: null })).toEqual(rest)
  })
})
