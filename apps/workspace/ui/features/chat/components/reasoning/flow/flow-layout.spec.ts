import { describe, test, expect } from 'vitest'
import { planFan } from './flow-layout'
import { DESKTOP_W, PHONE_W } from './reasoning-flow.fixtures'

describe('planFan — sources pack into columns, never a forced single column', () => {
  test('a desktop chat column fans out one column per source for a typical turn', () => {
    for (const n of [1, 2, 3]) {
      const fan = planFan(DESKTOP_W, n)
      expect(fan.columns).toHaveLength(n)
      expect(fan.grouped).toBe(false)
    }
  })

  test('a column never gets narrower than a hyphenated compound needs: 3 at 680px, 2 below 544px, then 1', () => {
    expect(planFan(680, 4).columns).toHaveLength(3)
    expect(planFan(544, 4).columns).toHaveLength(3)
    expect(planFan(543, 4).columns).toHaveLength(2)
    expect(planFan(421, 4).columns).toHaveLength(2)
    expect(planFan(420, 4).columns).toHaveLength(1)
    for (const width of [421, 500, 543, 544, 680, 900]) {
      const fan = planFan(width, 6)
      expect(fan.grouped).toBe(false)
      expect(fan.colW).toBeGreaterThanOrEqual(172)
    }
  })

  test('REGRESSION: more sources than fit widen into stacked columns — not one vertical chain', () => {
    const fan = planFan(DESKTOP_W, 8)
    expect(fan.columns.length).toBeGreaterThan(1)
    expect(fan.grouped).toBe(false)
    expect(fan.columns.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  test('columns are balanced, remainder on the left', () => {
    const fan = planFan(DESKTOP_W, 7)
    const sizes = fan.columns.map((c) => c.length)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(fan.columns.flat()).toHaveLength(7)
  })

  test('a narrow container always collapses to one grouped column, whatever the arithmetic', () => {
    for (const width of [280, 340, 400, 420]) {
      const fan = planFan(width, 5)
      expect(fan.columns).toHaveLength(1)
      expect(fan.grouped).toBe(true)
    }
  })

  test('the fan never overflows the container width', () => {
    for (const width of [280, 340, 460, 680, 900]) {
      for (const n of [1, 3, 5, 9]) {
        const fan = planFan(width, n)
        const fanW = fan.columns.length * fan.colW + (fan.columns.length - 1) * fan.gap
        expect(fan.fanX + fanW).toBeLessThanOrEqual(fan.contentW)
      }
    }
  })

  test('phone width collapses to the single grouped column', () => {
    const fan = planFan(PHONE_W, 4)
    expect(fan.columns).toEqual([[0, 1, 2, 3]])
    expect(fan.grouped).toBe(true)
    expect(fan.colW).toBe(fan.contentW)
  })

  test('no sources → no columns', () => {
    expect(planFan(DESKTOP_W, 0).columns).toEqual([])
  })
})
