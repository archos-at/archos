import type { JSX } from 'react'
import { render } from '@testing-library/react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { useComposerMetrics, type ComposerMetrics } from './use-composer-metrics'
import { installLayoutObservers } from '@/test-utils/layout-observers'

const COLUMN_H = 900
const COMPOSER_H = 206
const EXPECTED_LIFT = 317
const EXPECTED_WELCOME_OFFSET = 555

let restoreObservers: () => void
const originalDescriptors: Record<string, PropertyDescriptor | undefined> = {}

const stubLayout = (): void => {
  for (const prop of ['offsetHeight', 'clientHeight', 'offsetParent'] as const) {
    originalDescriptors[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.h ?? 0)
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.h ?? 0)
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
}

const Harness = ({
  isThreadEmpty,
  composerMounted = true,
  composerHeight = COMPOSER_H,
  columnHeight = COLUMN_H,
}: HarnessProps): JSX.Element => {
  const metrics = useComposerMetrics(isThreadEmpty)
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

  test('never lifts the composer off the bottom of a short column', () => {
    render(<Harness isThreadEmpty columnHeight={180} />)
    expect(latest.composerMotion.animate.y).toBe(0)
  })

  test('travels only when the thread stops being empty', () => {
    const { rerender } = render(<Harness isThreadEmpty />)
    expect(latest.composerMotion.transition).toEqual({ duration: 0 })
    expect(latest.composerMotion.initial).toBe(false)

    rerender(<Harness isThreadEmpty={false} />)
    expect(latest.composerMotion.transition).toMatchObject({ type: 'spring' })
  })

  test('goes back to placing instantly once the journey has arrived', () => {
    const { rerender } = render(<Harness isThreadEmpty />)
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
