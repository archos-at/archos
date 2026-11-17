import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  iconSwapExitTransition,
  iconSwapTransition,
  motionBase,
  motionDeliberate,
  motionDeliberateEntrance,
  motionEntrance,
  motionInstant,
  motionQuick,
  motionQuickExit,
  motionSheetEnter,
  motionSnap,
  springDrawer,
  springGlide,
  springDrawerLinear,
  springDrawerLinearDuration,
  springPress,
  springSnap,
  springSnapLinear,
  springSnapLinearDuration,
  springSnapSettleSeconds,
  staggerMaxSteps,
  staggerParent,
  staggerStepSeconds,
  useIconSwapTransition,
  useMotionToken,
  type SpringTransition,
} from './index'

const dampingRatio = ({ stiffness, damping, mass }: SpringTransition): number =>
  damping / (2 * Math.sqrt(stiffness * mass))

const overshoot = (spring: SpringTransition): number => {
  const zeta = dampingRatio(spring)
  return zeta >= 1 ? 0 : Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta))
}

const parseLinear = (value: string): number[] => {
  const match = /^linear\((.+)\)$/.exec(value)
  expect(match, `not a linear() function: ${value}`).not.toBeNull()
  return (match?.[1] ?? '').split(',').map((point) => Number(point.trim()))
}

describe('spring configs', () => {
  describe('springPress — the interruptible one', () => {
    it('is critically damped, so a released gesture never lands an overshoot late', () => {
      expect(dampingRatio(springPress)).toBeGreaterThanOrEqual(0.98)
      expect(dampingRatio(springPress)).toBeLessThanOrEqual(1.02)
    })

    it('overshoots by nothing at all, at any travel', () => {
      expect(overshoot(springPress)).toBe(0)
    })
  })

  describe('springSnap — the playful one', () => {
    it('lands in the underdamped band the comment documents (ζ = 0.658)', () => {
      expect(dampingRatio(springSnap)).toBeCloseTo(0.658, 3)
      expect(dampingRatio(springSnap)).toBeGreaterThan(0.6)
      expect(dampingRatio(springSnap)).toBeLessThan(0.72)
    })

    it('overshoots 6.4%', () => {
      expect(overshoot(springSnap) * 100).toBeCloseTo(6.4, 1)
    })

    it('keeps overshoot inside the 1–2px budget across its documented travel range', () => {
      expect(overshoot(springSnap) * 24).toBeGreaterThan(1)
      expect(overshoot(springSnap) * 24).toBeLessThan(2)
    })

    it('would blow the budget past its ceiling — this is what the ceiling is for', () => {
      expect(overshoot(springSnap) * 100).toBeGreaterThan(2)
    })
  })

  describe('springDrawer — the large-surface one', () => {
    it('lands in the documented band (ζ = 0.806)', () => {
      expect(dampingRatio(springDrawer)).toBeCloseTo(0.806, 3)
      expect(dampingRatio(springDrawer)).toBeGreaterThan(0.75)
      expect(dampingRatio(springDrawer)).toBeLessThan(0.86)
    })

    it('overshoots 1.4%', () => {
      expect(overshoot(springDrawer) * 100).toBeCloseTo(1.4, 1)
    })

    it('is tuned so LARGE travel lands in the same 1–2px budget', () => {
      expect(overshoot(springDrawer) * 120).toBeGreaterThan(1)
      expect(overshoot(springDrawer) * 145).toBeLessThan(2.1)
    })
  })

  describe('springGlide — the unbounded-travel one', () => {
    it('lands in the documented band (ζ = 0.899)', () => {
      expect(dampingRatio(springGlide)).toBeCloseTo(0.899, 3)
      expect(dampingRatio(springGlide)).toBeGreaterThan(0.87)
      expect(dampingRatio(springGlide)).toBeLessThan(0.93)
    })

    it('overshoots 0.157%', () => {
      expect(overshoot(springGlide) * 100).toBeCloseTo(0.157, 2)
    })

    it('keeps overshoot under a pixel at ANY travel, with no documented ceiling', () => {
      expect(overshoot(springGlide) * 288).toBeLessThan(1)
      expect(overshoot(springGlide) * 448).toBeLessThan(1)
      expect(overshoot(springGlide) * 1000).toBeLessThan(2)
    })

    it('still overshoots — it is a settle, not an ease-out in disguise', () => {
      expect(overshoot(springGlide)).toBeGreaterThan(0)
    })

    it("shares springDrawer's natural frequency", () => {
      const wn = (s: SpringTransition) => Math.sqrt(s.stiffness / (s.mass ?? 1))
      expect(wn(springGlide)).toBeCloseTo(wn(springDrawer), 6)
    })
  })

  it('orders the four springs from stiffest to softest', () => {
    expect(dampingRatio(springPress)).toBeGreaterThan(dampingRatio(springGlide))
    expect(dampingRatio(springGlide)).toBeGreaterThan(dampingRatio(springDrawer))
    expect(dampingRatio(springDrawer)).toBeGreaterThan(dampingRatio(springSnap))
  })
})

describe('linear() equivalents', () => {
  const cases = [
    {
      name: 'springSnapLinear',
      css: springSnapLinear,
      spring: springSnap,
      duration: springSnapLinearDuration,
    },
    {
      name: 'springDrawerLinear',
      css: springDrawerLinear,
      spring: springDrawer,
      duration: springDrawerLinearDuration,
    },
  ] as const

  it.each(cases)('$name is a well-formed linear() function', ({ css }) => {
    const points = parseLinear(css)
    expect(points.length).toBeGreaterThanOrEqual(12)
    expect(points.every((point) => Number.isFinite(point))).toBe(true)
  })

  it.each(cases)('$name starts at rest and ends exactly on target', ({ css }) => {
    const points = parseLinear(css)
    expect(points[0]).toBe(0)
    expect(points[points.length - 1]).toBe(1)
  })

  it.each(cases)('$name reproduces its spring’s overshoot', ({ css, spring }) => {
    const peak = Math.max(...parseLinear(css))
    expect(peak).toBeGreaterThan(1)
    expect(peak - 1).toBeCloseTo(overshoot(spring), 2)
  })

  it.each(cases)('$name pairs with a duration in milliseconds', ({ duration }) => {
    expect(duration).toMatch(/^\d+ms$/)
  })

  it('states the snap settle once, in seconds, and derives the CSS duration from it', () => {
    expect(springSnapLinearDuration).toBe(`${springSnapSettleSeconds * 1000}ms`)
    expect(springSnapSettleSeconds).toBeGreaterThan(motionBase.duration as number)
  })
})

describe('tween scale', () => {
  it('mirrors the --motion-* CSS tokens, in seconds', () => {
    expect(motionSnap.duration).toBe(0.12)
    expect(motionQuick.duration).toBe(0.18)
    expect(motionBase.duration).toBe(0.24)
    expect(motionEntrance.duration).toBe(0.24)
    expect(motionDeliberate.duration).toBe(0.32)
  })

  it('runs an exit one step shorter than its entrance, on a curve that starts at once', () => {
    expect(motionQuickExit.duration).toBe(motionQuick.duration)
    expect(motionQuickExit.duration).toBeLessThan(motionBase.duration as number)
    const [x1, y1] = motionQuickExit.ease as [number, number, number, number]
    expect(y1).toBeGreaterThan(x1)
  })

  it('reduces to nothing at all — no duration and, as importantly, no delay', () => {
    expect(motionInstant.duration).toBe(0)
    expect(motionInstant.delay).toBe(0)
  })

  it('gives entrances an ease-OUT curve, not the CSS default ease that ramps in', () => {
    const [x1, y1] = motionEntrance.ease as [number, number, number, number]
    expect(y1).toBeGreaterThan(x1)
  })
})

describe('stagger cap', () => {
  const delayFor = (index: number): number => {
    const visible = staggerParent.visible
    const delayChildren =
      typeof visible === 'object' && visible !== null
        ? visible.transition?.delayChildren
        : undefined
    expect(typeof delayChildren).toBe('function')
    return (delayChildren as (i: number, total: number) => number)(index, 12)
  }

  it('steps 40ms per item', () => {
    expect(delayFor(0)).toBe(0)
    expect(delayFor(1)).toBeCloseTo(staggerStepSeconds, 5)
    expect(delayFor(3)).toBeCloseTo(3 * staggerStepSeconds, 5)
  })

  it('flattens past the cap instead of queueing', () => {
    const capped = delayFor(staggerMaxSteps)
    expect(delayFor(staggerMaxSteps + 1)).toBe(capped)
    expect(delayFor(30)).toBe(capped)
  })

  it('finishes the whole cascade inside one base duration', () => {
    expect(delayFor(30)).toBeLessThanOrEqual(motionBase.duration as number)
  })
})

describe('useMotionToken', () => {
  const stubReducedMotion = (reduce: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: reduce && query.includes('reduce'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
        }) as unknown as MediaQueryList
    )

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands back the token itself when motion is allowed', () => {
    stubReducedMotion(false)
    const { result } = renderHook(() => useMotionToken(motionDeliberateEntrance))
    expect(result.current).toBe(motionDeliberateEntrance)
  })

  it('hands back motionInstant, delay included, under reduced motion', () => {
    stubReducedMotion(true)
    const { result } = renderHook(() => useMotionToken({ ...motionBase, delay: 0.3 }))
    expect(result.current).toBe(motionInstant)
  })

  it('asks matchMedia once, however often its subscribers render', () => {
    stubReducedMotion(false)
    const matchMedia = vi.fn(window.matchMedia)
    vi.stubGlobal('matchMedia', matchMedia)
    const first = renderHook(() => useMotionToken(motionBase))
    const second = renderHook(() => useMotionToken(motionQuick))
    first.rerender()
    second.rerender()
    expect(matchMedia).toHaveBeenCalledTimes(1)
  })
})

describe('iconSwapTransition', () => {
  it('springs the scale on springSnap and tweens opacity on motionQuick', () => {
    const { opacity, ...scale } = iconSwapTransition as Record<string, unknown>
    expect(scale).toEqual(springSnap)
    expect(opacity).toBe(motionQuick)
  })

  it('leaves on the exit tween, never on the spring', () => {
    expect(iconSwapExitTransition).toBe(motionQuickExit)
  })

  const stubReducedMotion = (reduce: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: reduce && query.includes('reduce'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    )

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands back the pair when motion is allowed', () => {
    stubReducedMotion(false)
    const { result } = renderHook(() => useIconSwapTransition())
    expect(result.current).toEqual({ enter: iconSwapTransition, exit: iconSwapExitTransition })
  })

  it('makes both halves instant under reduced motion', () => {
    stubReducedMotion(true)
    const { result } = renderHook(() => useIconSwapTransition())
    expect(result.current).toEqual({ enter: motionInstant, exit: motionInstant })
  })
})

describe('motionDeliberateEntrance', () => {
  it('is the deliberate ceiling on the entrance curve, and the sheet uses the same pair', () => {
    expect(motionDeliberateEntrance.duration).toBe(motionDeliberate.duration)
    expect(motionDeliberateEntrance.ease).toEqual(motionEntrance.ease)
    expect(motionSheetEnter).toBe(motionDeliberateEntrance)
  })
})
