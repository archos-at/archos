/**
 * `DockedSplit` against the REAL panel library, with the one thing happy-dom
 * lacks put in by hand: CSS widths. `file-preview-split.spec.tsx` stubs the
 * library and holds the instructions we give it; this file holds what the
 * library then does with them, which is where the phone bug lived.
 *
 * The bug. On a phone every project page was squeezed into a 140px column
 * beside an empty 250px file panel, with no file open. The file panel's group
 * sits in the page panel of the Postfach's (`start-dock`), and each group lays
 * itself out in a layout effect, children first. So the file group was first
 * measured while the Postfach panel still stood at its `defaultSize` of 360px:
 * it was 30px wide, too narrow for the file panel's 280px minimum. The library
 * clamped the panel to collapsed, `collapse()` found nothing to do, and so no
 * layout was recorded. On the next commit (its panels had registered) the
 * library laid the group out again from its defaults, now at the full 390px,
 * and the file panel's default was its OPEN width: 320px beside a page whose
 * floor is 40% settles at 40 : 71.8, which is 140px : 250px. On a desktop the
 * first measure was wide enough for `collapse()` to take and be recorded.
 *
 * The stub gives each panel the width CSS would (basis, grow, shrink, from the
 * styles the library writes), a group the width of the panel it sits in, and
 * fires a group's `ResizeObserver` by hand.
 */

import { act, render } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DockedSplit, type DockedSplitProps } from './docked-split'

/** The width of each outermost group, by id. A nested group takes its panel's. */
const rootWidths = new Map<string, number>()
/** The library's observers, by the group element they watch. */
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

/**
 * The width CSS gives a panel: its `flex-basis`, plus a share of the room left
 * by `flex-grow`, or less a share of the overflow by basis. Before its group
 * has laid itself out a panel carries the library's mount style: a page grows
 * from zero, a docked panel stands at its `defaultSize`.
 */
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

/** Where a panel starts: after the panels before it. The library orders panels by it. */
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

/** What the browser reports after a commit: every observed group as it now stands. */
function deliverResizes(): void {
  for (const [element, callback] of [...observers]) {
    const inlineSize = groupWidth(element as HTMLElement)
    const entry = { target: element, borderBoxSize: [{ inlineSize, blockSize: 800 }] }
    act(() => callback([entry as unknown as ResizeObserverEntry], {} as ResizeObserver))
  }
}

/** The width in pixels the library gave a panel (it writes its share of the row as `flex-grow`). */
function widthOf(id: string): number {
  const panel = document.getElementById(id)
  if (!panel) throw new Error(`no panel ${id}`)
  return Math.round(panelWidth(panel))
}

// The file peek's own numbers: `FILE_PEEK_WIDTH_MIN`, `_MAX`, `_DEFAULT`.
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

/** The shell's shape: the file peek's split in the page panel of the Postfach's (`START_DOCK_WIDTH_*`). */
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
    // A width remembered from a desktop is adopted at mount, closed or not.
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
    // A group inside a hidden subtree: the library defers its default layout
    // to the first time it can measure the group, and then applies it.
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
