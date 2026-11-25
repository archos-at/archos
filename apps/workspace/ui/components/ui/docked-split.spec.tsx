import { act, render } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DockedSplit, type DockedSplitProps } from './docked-split'

const rootWidths = new Map<string, number>()
const observers = new Map<Element, ResizeObserverCallback>()

class RecordingResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    if (target.hasAttribute('data-group')) observers.set(target, this.callback)
  }
  unobserve(): void {}
  disconnect(): void {
    for (const [target, callback] of observers) if (callback === this.callback) observers.delete(target)
  }
}

const panelsOf = (group: Element | null): HTMLElement[] =>
  [...(group?.children ?? [])].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-panel'),
  )

function groupWidth(group: HTMLElement | null): number {
  if (!group) return 0
  const root = rootWidths.get(group.id)
  if (root !== undefined) return root
  const host = group.parentElement?.closest<HTMLElement>('[data-panel]')
  return host ? panelWidth(host) : 0
}

function panelWidth(panel: HTMLElement): number {
  const group = panel.closest<HTMLElement>('[data-group]')
  const panels = panelsOf(group)
  const total = groupWidth(group)
  const basis = panels.map((child) => Number.parseFloat(child.style.flexBasis) || 0)
  const grows = panels.map((child) => Number(child.style.flexGrow || 0))
  const index = panels.indexOf(panel)
  const sumBasis = basis.reduce((a, b) => a + b, 0)
  const free = total - sumBasis
  if (free < 0) return basis[index] + (free * basis[index]) / sumBasis
  const sumGrow = grows.reduce((a, b) => a + b, 0)
  return basis[index] + (sumGrow === 0 ? 0 : (free * grows[index]) / sumGrow)
}

function panelLeft(panel: HTMLElement): number {
  const panels = panelsOf(panel.closest('[data-group]'))
  return panels.slice(0, panels.indexOf(panel)).reduce((left, before) => left + panelWidth(before), 0)
}

const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
const offsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft')

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-panel') ? panelWidth(this) : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-panel') ? panelLeft(this) : 0
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth)
  if (offsetLeft) Object.defineProperty(HTMLElement.prototype, 'offsetLeft', offsetLeft)
  rootWidths.clear()
  observers.clear()
})

function deliverResizes(): void {
  for (const [element, callback] of [...observers]) {
    const inlineSize = groupWidth(element as HTMLElement)
    const entry = { target: element, borderBoxSize: [{ inlineSize, blockSize: 800 }] }
    act(() => callback([entry as unknown as ResizeObserverEntry], {} as ResizeObserver))
  }
}

function widthOf(id: string): number {
  const panel = document.getElementById(id)
  if (!panel) throw new Error(`no panel ${id}`)
  return Math.round(panelWidth(panel))
}

const filePeek = (open: boolean): DockedSplitProps => ({
  id: 'file-ask',
  side: 'end',
  open,
  width: 320,
  minWidth: 280,
  maxWidth: 960,
  defaultWidth: () => 320,
  onWidthChange: () => {},
  onDismiss: () => {},
  resizeLabel: 'Resize the file',
  panel: <div>file</div>,
  children: <div>page</div>,
})

function Shell({ peekOpen, storedPeekWidth = null }: { peekOpen: boolean; storedPeekWidth?: number | null }): JSX.Element {
  return (
    <DockedSplit
      id="start-dock"
      side="start"
      open={false}
      width={360}
      minWidth={280}
      maxWidth={520}
      defaultWidth={() => 360}
      onWidthChange={() => {}}
      onDismiss={() => {}}
      resizeLabel="Resize the Postfach"
      panel={null}
    >
      <DockedSplit {...filePeek(peekOpen)} restoreWidth={() => storedPeekWidth} />
    </DockedSplit>
  )
}

describe('DockedSplit with the real panel library', () => {
  it('leaves a phone’s whole row to the page when nothing is docked', () => {
    rootWidths.set('start-dock', 390)
    render(<Shell peekOpen={false} />)
    deliverResizes()

    expect(widthOf('start-dock-panel')).toBe(0)
    expect(widthOf('file-ask-panel')).toBe(0)
    expect(widthOf('file-ask-page')).toBe(390)
  })

  it('leaves a phone’s whole row to the page when the reader once dragged the file wider', () => {
    rootWidths.set('start-dock', 390)
    render(<Shell peekOpen={false} storedPeekWidth={620} />)
    deliverResizes()

    expect(widthOf('file-ask-panel')).toBe(0)
    expect(widthOf('file-ask-page')).toBe(390)
  })

  it('leaves a desktop’s whole row to the page when nothing is docked', () => {
    rootWidths.set('start-dock', 1440)
    render(<Shell peekOpen={false} />)
    deliverResizes()

    expect(widthOf('file-ask-panel')).toBe(0)
    expect(widthOf('file-ask-page')).toBe(1440)
  })

  it('stays shut when it mounts closed in a group with no width yet', () => {
    rootWidths.set('file-ask', 0)
    render(<DockedSplit {...filePeek(false)} />)

    rootWidths.set('file-ask', 390)
    deliverResizes()

    expect(widthOf('file-ask-panel')).toBe(0)
  })

  it('opens at the reader’s width beside the page, and gives the row back when shut', () => {
    rootWidths.set('start-dock', 1440)
    const { rerender } = render(<Shell peekOpen={false} />)
    deliverResizes()

    rerender(<Shell peekOpen />)
    expect(widthOf('file-ask-panel')).toBe(320)
    expect(widthOf('file-ask-page')).toBe(1120)

    rerender(<Shell peekOpen={false} />)
    expect(widthOf('file-ask-panel')).toBe(0)
    expect(widthOf('file-ask-page')).toBe(1440)
  })

  it('opens at the reader’s width when it mounts open', () => {
    rootWidths.set('start-dock', 1440)
    render(<Shell peekOpen />)
    deliverResizes()

    expect(widthOf('file-ask-panel')).toBe(320)
  })
})

interface Glide {
  target: HTMLElement
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  finish: () => void
  cancelled: boolean
}

function recordGlides(): Glide[] {
  const glides: Glide[] = []
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let settle: (motion: Animation) => void = () => {}
      let abort: (reason: unknown) => void = () => {}
      const finished = new Promise<Animation>((resolve, reject) => {
        settle = resolve
        abort = reject
      })
      finished.catch(() => {})
      const glide: Glide = { target: this, keyframes, options, finish: () => {}, cancelled: false }
      const motion = {
        finished,
        cancel: () => {
          if (glide.cancelled) return
          glide.cancelled = true
          abort(new DOMException('cancelled', 'AbortError'))
        },
      } as unknown as Animation
      glide.finish = () => settle(motion)
      glides.push(glide)
      return motion
    },
  })
  return glides
}

const growOf = (glides: Glide[], id: string): string | undefined =>
  glides.find((glide) => glide.target.id === id)?.keyframes[0]?.flexGrow as string | undefined

describe('DockedSplit moving the row', () => {
  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate
  })

  it('glides the page wider as the panel shuts, the real panel in the row until it has gone', async () => {
    const glides = recordGlides()
    rootWidths.set('start-dock', 1440)
    const { rerender } = render(<Shell peekOpen={false} />)
    deliverResizes()
    rerender(<Shell peekOpen />)
    for (const glide of glides.splice(0)) glide.finish()
    await act(async () => {})

    rerender(<Shell peekOpen={false} />)

    expect(Number(growOf(glides, 'file-ask-page'))).toBeCloseTo((1120 / 1440) * 100, 1)
    expect(Number(growOf(glides, 'file-ask-panel'))).toBeCloseTo((320 / 1440) * 100, 1)
    expect(glides.every((glide) => glide.options.duration! > 0)).toBe(true)
    expect(widthOf('file-ask-page')).toBe(1440)
    expect(document.getElementById('file-ask-panel')?.textContent).toBe('file')
    expect(document.querySelector('[data-separator]')).not.toBeNull()

    await act(async () => {
      for (const glide of glides) glide.finish()
    })

    expect(document.querySelector('[data-separator]')).toBeNull()
    expect(glides.every((glide) => glide.cancelled)).toBe(true)
  })

  it('glides the page narrower as the panel opens, from the row it had', () => {
    const glides = recordGlides()
    rootWidths.set('start-dock', 1440)
    const { rerender } = render(<Shell peekOpen={false} />)
    deliverResizes()

    rerender(<Shell peekOpen />)

    expect(Number(growOf(glides, 'file-ask-page'))).toBe(100)
    expect(Number(growOf(glides, 'file-ask-panel'))).toBe(0)
    expect(widthOf('file-ask-panel')).toBe(320)
  })

  it('changes the row once, unmoving, for a reader who asked for less motion', () => {
    const glides = recordGlides()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    rootWidths.set('start-dock', 1440)
    const { rerender } = render(<Shell peekOpen={false} />)
    deliverResizes()
    rerender(<Shell peekOpen />)
    rerender(<Shell peekOpen={false} />)

    expect(glides).toEqual([])
    expect(widthOf('file-ask-page')).toBe(1440)
    expect(document.querySelector('[data-separator]')).toBeNull()
  })
})
