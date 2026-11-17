import { act, render } from '@/test-utils'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ReasoningFlow } from './ReasoningFlow'
import { FALLBACK_W, measuredFanWidth } from './flow/flow-layout'
import { storedSteps } from '@/test-utils/wire-v2-steps'

const steps = storedSteps([
  {
    id: 'sources:0',
    kind: 'sources',
    round: 0,
    tool: 'knowledge_search',
    lanes: [
      {
        key: 'building_law_oib',
        label: 'OIB-Richtlinie',
        kind: 'building_law',
        hit_count: 3,
        sources: [{ name: 'A.pdf' }, { name: 'B.pdf' }, { name: 'C.pdf' }],
      },
    ],
  },
])

let reportedWidth = 0
const observers: Array<() => void> = []

class ManualResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    observers.push(() => this.callback([], this as unknown as ResizeObserver))
  }
  unobserve(): void {}
  disconnect(): void {}
}

const reflowTo = (width: number) =>
  act(() => {
    reportedWidth = width
    for (const fire of observers) fire()
  })

const plannedWidth = () =>
  document.querySelector<HTMLElement>('[data-testid="reasoning-flow"]')?.style.getPropertyValue('--banner-w')

let restore: () => void = () => {}

beforeEach(() => {
  const originalObserver = globalThis.ResizeObserver
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => reportedWidth,
  })
  globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof globalThis.ResizeObserver
  restore = () => {
    globalThis.ResizeObserver = originalObserver
    if (descriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', descriptor)
    observers.length = 0
    reportedWidth = 0
  }
})

afterEach(() => restore())

describe('measuredFanWidth', () => {
  test('takes a real measurement', () => {
    expect(measuredFanWidth(648, 342)).toBe(342)
  })

  test('keeps the last real width when the container reads 0', () => {
    expect(measuredFanWidth(648, 0)).toBe(648)
  })
})

describe('the planned width', () => {
  test('follows the panel and is not widened to the fallback by a zero reading', () => {
    reportedWidth = 648
    render(<ReasoningFlow steps={steps} userQuestion="Frage?" answerConfidence="high" />)
    expect(plannedWidth()).toBe('648px')

    reflowTo(0)
    expect(plannedWidth()).toBe('648px')
    expect(plannedWidth()).not.toBe(`${FALLBACK_W}px`)

    reflowTo(342)
    expect(plannedWidth()).toBe('342px')
  })

  test('falls back to a desktop column only until the first real measurement', () => {
    render(<ReasoningFlow steps={steps} userQuestion="Frage?" answerConfidence="high" />)
    expect(plannedWidth()).toBe(`${FALLBACK_W}px`)

    reflowTo(262)
    expect(plannedWidth()).toBe('262px')
  })
})
