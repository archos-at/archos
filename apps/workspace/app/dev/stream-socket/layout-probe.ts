export const AFTER_SETTLE_MS = 2_500

const READER_INPUT_MS = 500

export interface ShiftSource {
  node: string
  dy: number
  dh: number
}

export interface ShiftRecord {
  t: number
  afterSettle: boolean
  value: number
  moved: ShiftSource[]
  edge: ShiftSource[]
}

export interface LoafRecord {
  t: number
  ms: number
  blockingMs: number
  scripts: { name: string; ms: number }[]
}

export interface ScrollCall {
  t: number
  fn: string
  afterSettle: boolean
}

export interface ReadingLine {
  answerInViewAtFirstWord: boolean | null
  firstProseMaxDelta: number
  lastLineMaxDelta: number
  worst: { t: number; which: 'firstProse' | 'lastLine'; delta: number } | null
}

export interface LayoutProbe {
  shifts: ShiftRecord[]
  clsBeforeSettle: number
  clsAfterSettle: number
  caretShift: number
  loaf: LoafRecord[]
  scrollCalls: ScrollCall[]
  reading: ReadingLine
}

export interface TurnClock {
  sentAt: number
  settledAt: number
  done: boolean
  answerId: string
}

export const initialLayoutProbe = (): LayoutProbe => ({
  shifts: [],
  clsBeforeSettle: 0,
  clsAfterSettle: 0,
  caretShift: 0,
  loaf: [],
  scrollCalls: [],
  reading: { answerInViewAtFirstWord: null, firstProseMaxDelta: 0, lastLineMaxDelta: 0, worst: null },
})

const describe = (node: Node | null | undefined): string => {
  if (!node || !(node instanceof Element)) return String(node?.nodeName ?? 'text')
  const id = node.id ? `#${node.id.slice(0, 28)}` : ''
  const cls = typeof node.className === 'string' ? node.className.split(' ').filter(Boolean).slice(0, 4).join('.') : ''
  return `${node.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}`
}

const isInsideCaret = (node: Node | null | undefined): boolean =>
  node instanceof Element && node.closest('[data-caret-after]') !== null

const findScroller = (): HTMLElement | null => {
  let element = document.querySelector('[id^="message-"]')?.parentElement ?? null
  while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) element = element.parentElement
  return element
}

interface LayoutShiftSource {
  node?: Node
  previousRect: DOMRectReadOnly
  currentRect: DOMRectReadOnly
}

interface LayoutShiftEntry extends PerformanceEntry {
  value: number
  hadRecentInput: boolean
  sources?: LayoutShiftSource[]
}

interface LoafScript {
  invoker?: string
  sourceFunctionName?: string
  sourceURL?: string
  duration: number
}

interface LoafEntry extends PerformanceEntry {
  blockingDuration: number
  scripts?: LoafScript[]
}

const scriptName = (script: LoafScript): string => {
  const file = (script.sourceURL ?? '').split('/').pop()?.split('?')[0] ?? ''
  const fn = script.sourceFunctionName || script.invoker || '?'
  return file ? `${fn}@${file}` : fn
}

export const observeLayout = (probe: LayoutProbe, clock: TurnClock): (() => void) => {
  const live = () => clock.sentAt > 0 && !clock.done
  const since = (at: number) => Math.round(at - clock.sentAt)
  const afterSettle = (at: number) => clock.settledAt > 0 && at >= clock.settledAt
  const teardown: (() => void)[] = []

  const shifts = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LayoutShiftEntry[]) {
      if (!live() || entry.hadRecentInput) continue
      const after = afterSettle(entry.startTime)
      const moved: ShiftSource[] = []
      const edge: ShiftSource[] = []
      for (const source of entry.sources ?? []) {
        const record = {
          node: describe(source.node),
          dy: Math.round(source.currentRect.top - source.previousRect.top),
          dh: Math.round(source.currentRect.height - source.previousRect.height),
        }
        const enteredOrLeft = source.previousRect.height === 0 || source.currentRect.height === 0
        ;(enteredOrLeft ? edge : moved).push(record)
      }
      const caretOnly =
        (entry.sources ?? []).length > 0 &&
        (entry.sources ?? []).every((source) => isInsideCaret(source.node))
      if (caretOnly) {
        probe.caretShift += entry.value
        continue
      }
      probe.shifts.push({ t: since(entry.startTime), afterSettle: after, value: entry.value, moved, edge })
      if (after) probe.clsAfterSettle += entry.value
      else probe.clsBeforeSettle += entry.value
    }
  })
  shifts.observe({ type: 'layout-shift', buffered: false })
  teardown.push(() => shifts.disconnect())

  try {
    const loaf = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LoafEntry[]) {
        if (!live()) continue
        probe.loaf.push({
          t: since(entry.startTime),
          ms: Math.round(entry.duration),
          blockingMs: Math.round(entry.blockingDuration),
          scripts: (entry.scripts ?? []).map((script) => ({ name: scriptName(script), ms: Math.round(script.duration) })),
        })
      }
    })
    loaf.observe({ type: 'long-animation-frame', buffered: false })
    teardown.push(() => loaf.disconnect())
  } catch {
    // Unsupported entry type.
  }

  teardown.push(watchScrollCalls(probe, live, since, afterSettle))
  teardown.push(watchReadingLine(probe.reading, clock, live, since))
  return () => teardown.forEach((stop) => stop())
}

const watchScrollCalls = (
  probe: LayoutProbe,
  live: () => boolean,
  since: (at: number) => number,
  afterSettle: (at: number) => boolean
): (() => void) => {
  let scroller: HTMLElement | null = null
  const record = (fn: string, target: Element) => {
    if (!live()) return
    scroller = scroller?.isConnected ? scroller : findScroller()
    if (!scroller) return
    const onScroller = target === scroller || (fn === 'scrollIntoView' && scroller.contains(target))
    if (!onScroller) return
    const now = performance.now()
    probe.scrollCalls.push({ t: since(now), fn, afterSettle: afterSettle(now) })
  }
  const proto = Element.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
  const restore: (() => void)[] = []
  for (const fn of ['scrollTo', 'scrollBy', 'scroll', 'scrollIntoView']) {
    const original = proto[fn]
    proto[fn] = function (this: Element, ...args: unknown[]) {
      record(fn, this)
      return original.apply(this, args)
    }
    restore.push(() => (proto[fn] = original))
  }
  const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  if (scrollTop?.get && scrollTop.set) {
    const { get, set } = scrollTop
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get,
      set(this: Element, value: number) {
        record('scrollTop=', this)
        set.call(this, value)
      },
    })
    restore.push(() => Object.defineProperty(Element.prototype, 'scrollTop', scrollTop))
  }
  return () => restore.forEach((undo) => undo())
}

const watchReadingLine = (
  reading: ReadingLine,
  clock: TurnClock,
  live: () => boolean,
  since: (at: number) => number
): (() => void) => {
  let lastInputAt = -Infinity
  const onInput = () => (lastInputAt = performance.now())
  const inputs = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const
  inputs.forEach((type) => window.addEventListener(type, onInput, { capture: true, passive: true }))

  let scroller: HTMLElement | null = null
  let firstProse: { top: number; visible: boolean } | null = null
  let lastLine: { element: Element; top: number; visible: boolean } | null = null
  let followed = clock.answerId
  const note = (which: 'firstProse' | 'lastLine', delta: number, now: number) => {
    if (which === 'firstProse') reading.firstProseMaxDelta = Math.max(reading.firstProseMaxDelta, delta)
    else reading.lastLineMaxDelta = Math.max(reading.lastLineMaxDelta, delta)
    if (!reading.worst || delta > reading.worst.delta) reading.worst = { t: since(now), which, delta }
  }

  let raf = 0
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (!live()) return
    scroller = scroller?.isConnected ? scroller : findScroller()
    if (followed !== clock.answerId) {
      followed = clock.answerId
      firstProse = null
      lastLine = null
    }
    const answer = document.getElementById(`message-${clock.answerId}`)
    if (!scroller || !answer) return
    const view = scroller.getBoundingClientRect()
    const onScreen = (top: number, bottom: number) => bottom > view.top && top < view.bottom
    const readerMoved = now - lastInputAt < READER_INPUT_MS

    const blocks = answer.querySelectorAll('.markdown-content > *')
    const first = blocks[0]
    if (first && reading.answerInViewAtFirstWord === null && first.textContent?.trim()) {
      const cardTop = answer.getBoundingClientRect().top
      reading.answerInViewAtFirstWord = cardTop >= view.top && cardTop < view.bottom
    }

    if (first) {
      const rect = first.getBoundingClientRect()
      const visible = onScreen(rect.top, rect.bottom)
      if (firstProse && (visible || firstProse.visible) && !readerMoved) {
        note('firstProse', Math.abs(Math.round(rect.top - firstProse.top)), now)
      }
      firstProse = { top: rect.top, visible }
    }

    let last: Element | null = null
    for (const block of blocks) {
      const rect = block.getBoundingClientRect()
      if (rect.top < view.bottom && rect.bottom > view.top) last = block
    }
    if (last) {
      const top = last.getBoundingClientRect().top
      if (lastLine && lastLine.element === last && !readerMoved) {
        note('lastLine', Math.abs(Math.round(top - lastLine.top)), now)
      }
      lastLine = { element: last, top, visible: true }
    } else if (lastLine?.element.isConnected) {
      const top = lastLine.element.getBoundingClientRect().top
      if (lastLine.visible && !readerMoved) note('lastLine', Math.abs(Math.round(top - lastLine.top)), now)
      lastLine = { element: lastLine.element, top, visible: false }
    }
  }
  raf = requestAnimationFrame(frame)
  return () => {
    cancelAnimationFrame(raf)
    inputs.forEach((type) => window.removeEventListener(type, onInput, { capture: true }))
  }
}
