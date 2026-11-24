import { describe, expect, it } from 'vitest'
import { spreadLabels } from './label-spread'

describe('spreadLabels', () => {
  it('leaves labels that do not touch where they are', () => {
    const labels = [
      { x: 0, y: 0, text: 'Gang · 1,75 m' },
      { x: 400, y: 0, text: 'Zimmer · 12 m²' },
    ]
    expect(spreadLabels([], labels)).toEqual(labels)
  })

  it('moves a label off one it would sit on, so both stay readable', () => {
    const [first, second] = spreadLabels([], [
      { x: 100, y: 100, text: 'Gangbreite · 1,76 m' },
      { x: 110, y: 104, text: '1,76 m' },
    ])
    expect(first.y).toBe(100)
    expect(Math.abs(second.y - first.y)).toBeGreaterThanOrEqual(22)
  })

  it('keeps clear of the label being measured, which never moves', () => {
    const [kept] = spreadLabels([{ x: 100, y: 100, text: '≈ 1,7 m' }], [{ x: 100, y: 100, text: 'Gang · 1,75 m' }])
    expect(kept.y).not.toBe(100)
  })
})
