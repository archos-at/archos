import type { JSX } from 'react'
import { fireEvent, render } from '@testing-library/react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { motion } from '@/components/motion'
import { COMPOSER_ON_PHONE_FLOOR, restGeometry, useComposerMetrics, type ComposerMetrics } from './use-composer-metrics'
import { installLayoutObservers } from '@/test-utils/layout-observers'

const COLUMN_H = 900
const COMPOSER_H = 206
const EXPECTED_LIFT = 282
const EXPECTED_WELCOME_OFFSET = 520

let restoreObservers: () => void
const originalDescriptors: Record<string, PropertyDescriptor | undefined> = {}

const stubLayout = (): void => {
  for (const prop of ['getBoundingClientRect', 'offsetParent'] as const) {
    originalDescriptors[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
  }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      return new DOMRect(0, 0, 0, Number(this.dataset.h ?? 0))
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement
    },
  })
}

const restoreLayout = (): void => {
  for (const [prop, descriptor] of Object.entries(originalDescriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
  }
}

let renders = 0

interface HarnessProps {
  isThreadEmpty: boolean
  composerMounted?: boolean
  composerHeight?: number
  columnHeight?: number
  keyboardUp?: boolean
  phone?: boolean | null
}

const Harness = ({
  isThreadEmpty,
  composerMounted = true,
  composerHeight = COMPOSER_H,
  columnHeight = COLUMN_H,
  keyboardUp = false,
  phone = false,
}: HarnessProps): JSX.Element => {
  const metrics = useComposerMetrics(isThreadEmpty, keyboardUp, { phone })
  latest = metrics
  renders += 1
  return (
    <div data-testid="column" data-h={columnHeight} style={metrics.columnVars}>
      {composerMounted && (
        <div data-testid="composer" data-h={composerHeight} ref={metrics.composerRef} />
      )}
    </div>
  )
}

let latest: ComposerMetrics

const columnVar = (container: HTMLElement, name: string): string | null =>
  container.querySelector<HTMLElement>('[data-testid="column"]')!.style.getPropertyValue(name) ||
  null

describe('useComposerMetrics', () => {
  beforeEach(() => {
    restoreObservers = installLayoutObservers()
    stubLayout()
  })

  afterEach(() => {
    restoreLayout()
    restoreObservers()
  })

  test('measures a composer that mounts AFTER its column', () => {
    const { container, rerender } = render(<Harness isThreadEmpty composerMounted={false} />)
    expect(columnVar(container, '--composer-h')).toBeNull()

    rerender(<Harness isThreadEmpty composerMounted />)

    expect(columnVar(container, '--composer-h')).toBe(`${COMPOSER_H}px`)
    expect(columnVar(container, '--welcome-offset')).toBe(`${EXPECTED_WELCOME_OFFSET}px`)
    expect(latest.composerMotion.animate.y).toBe(-EXPECTED_LIFT)
  })

  test('lifts the composer on an empty thread and floors it on a populated one', () => {
    const { rerender } = render(<Harness isThreadEmpty />)
    expect(latest.composerMotion.animate.y).toBe(-EXPECTED_LIFT)

    rerender(<Harness isThreadEmpty={false} />)
    expect(latest.composerMotion.animate.y).toBe(0)
  })

  test('stands an empty chat on the floor while the keyboard is up, the greeting just above it', () => {
    const { container, rerender } = render(<Harness isThreadEmpty />)
    expect(latest.composerMotion.animate.y).toBe(-EXPECTED_LIFT)

    rerender(<Harness isThreadEmpty keyboardUp columnHeight={500} />)
    expect(latest.composerMotion.animate.y).toBe(0)
    expect(latest.composerMotion.transition).toEqual({ duration: 0 })
    expect(columnVar(container, '--welcome-offset')).toBe(`${COMPOSER_H + 32}px`)
  })

  test('on a phone the empty chat composer stands on the floor before any tap, the greeting where it stood', () => {
    const { container } = render(<Harness isThreadEmpty phone />)
    expect(latest.composerMotion.animate.y).toBe(0)
    expect(columnVar(container, '--welcome-offset')).toBe(`${EXPECTED_WELCOME_OFFSET}px`)
  })

  test('until the phone is known, the lift is left to the stylesheet, which floors it below md', () => {
    render(<Harness isThreadEmpty phone={null} />)
    expect(String(latest.composerMotion.animate.y)).toContain('var(--composer-rest-lift')
  })

  test('never lifts the composer off the bottom of a short column', () => {
    render(<Harness isThreadEmpty columnHeight={180} />)
    expect(latest.composerMotion.animate.y).toBe(0)
  })

  test('travels only when the thread stops being empty after the reader acted', () => {
    const { rerender } = render(<Harness isThreadEmpty />)
    expect(latest.composerMotion.transition).toEqual({ duration: 0 })
    expect(latest.composerMotion.initial).toBe(false)

    fireEvent.keyDown(window, { key: 'Enter' })
    rerender(<Harness isThreadEmpty={false} />)
    expect(latest.composerMotion.transition).toMatchObject({ type: 'spring' })
  })

  test('places at once when the thread fills or empties before the reader acted, as on a project switch', () => {
    const { rerender } = render(<Harness isThreadEmpty={false} />)

    rerender(<Harness isThreadEmpty />)
    expect(latest.composerMotion.animate.y).toBe(-EXPECTED_LIFT)
    expect(latest.composerMotion.transition).toEqual({ duration: 0 })

    rerender(<Harness isThreadEmpty={false} />)
    expect(latest.composerMotion.transition).toEqual({ duration: 0 })
  })

  test('glides, never jumps, when the chat corrects what the server predicted for its first paint', () => {
    const Predicted = ({ isThreadEmpty, predicted }: { isThreadEmpty: boolean; predicted: boolean }): JSX.Element => {
      latest = useComposerMetrics(isThreadEmpty, false, { predicted })
      return <div />
    }
    const { rerender } = render(<Predicted isThreadEmpty={false} predicted />)
    rerender(<Predicted isThreadEmpty predicted={false} />)
    expect(latest.composerMotion.transition).toMatchObject({ type: 'spring' })
  })

  test('travels back up on a new chat the reader pressed for', () => {
    const { rerender } = render(<Harness isThreadEmpty={false} />)

    fireEvent.pointerDown(window)
    rerender(<Harness isThreadEmpty />)
    expect(latest.composerMotion.transition).toMatchObject({ type: 'spring' })
  })

  test('goes back to placing instantly once the journey has arrived', () => {
    const { rerender } = render(<Harness isThreadEmpty />)
    fireEvent.pointerDown(window)
    rerender(<Harness isThreadEmpty={false} />)
    expect(latest.composerMotion.transition).toMatchObject({ type: 'spring' })

    latest.composerMotion.onAnimationComplete()
    rerender(<Harness isThreadEmpty={false} composerHeight={240} />)

    expect(latest.composerMotion.transition).toEqual({ duration: 0 })
  })

  test('freezes the greeting offset when the thread stops being empty', () => {
    const { container, rerender } = render(<Harness isThreadEmpty />)
    expect(columnVar(container, '--welcome-offset')).toBe(`${EXPECTED_WELCOME_OFFSET}px`)

    rerender(<Harness isThreadEmpty={false} composerHeight={120} />)

    expect(columnVar(container, '--welcome-offset')).toBe(`${EXPECTED_WELCOME_OFFSET}px`)
  })

  describe('the observer', () => {
    let ticks: Array<() => void>
    let restoreRo: () => void

    beforeEach(() => {
      ticks = []
      const original = globalThis.ResizeObserver
      globalThis.ResizeObserver = class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(): void {
          ticks.push(() => this.callback([], this as unknown as ResizeObserver))
        }
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof ResizeObserver
      restoreRo = () => {
        globalThis.ResizeObserver = original
      }
    })

    afterEach(() => restoreRo())

    test('a tick that moved no height commits nothing', () => {
      render(<Harness isThreadEmpty />)
      const before = renders
      ticks.forEach((tick) => tick())
      expect(renders).toBe(before)
    })

    test('a tick that moved a height commits it in the same frame', () => {
      const { container } = render(<Harness isThreadEmpty />)
      container.querySelector<HTMLElement>('[data-testid="composer"]')!.dataset.h = '240'
      ticks.forEach((tick) => tick())
      expect(columnVar(container, '--composer-h')).toBe('240px')
    })
  })
})

describe('the composer of an empty chat on the server', () => {
  const ServerComposer = ({ isThreadEmpty }: { isThreadEmpty: boolean }): JSX.Element => {
    const metrics = useComposerMetrics(isThreadEmpty)
    return <motion.div ref={metrics.composerRef} style={metrics.composerStyle} {...metrics.composerMotion} />
  }

  test('rests at the line it will be measured to, in CSS, before any script runs, and on the floor on a phone', () => {
    expect(renderToString(<ServerComposer isThreadEmpty />)).toContain(
      'translateY(var(--composer-rest-lift, round(nearest, min(0px, calc(100% - 38px - 50cqh)), 1px)))'
    )
    expect(COMPOSER_ON_PHONE_FLOOR).toBe('max-md:[--composer-rest-lift:0px]')
  })

  test('a chat that will resume keeps its composer on the floor', () => {
    expect(renderToString(<ServerComposer isThreadEmpty={false} />)).not.toContain('translateY')
  })

  test('the measured rest is the CSS rest: the composer hangs 32px under a greeting line 70px above the middle', () => {
    expect(restGeometry(900, 136)).toEqual({ y: -352, welcomeOffset: 520 })
    expect(restGeometry(901, 136)).toEqual({ y: -352, welcomeOffset: 521 })
    expect(restGeometry(300, 260)).toEqual({ y: 0, welcomeOffset: 292 })
  })
})
