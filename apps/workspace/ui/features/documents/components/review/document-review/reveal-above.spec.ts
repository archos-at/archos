import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealAbove } from './reveal-above'

const box = (element: HTMLElement, ...bottoms: number[]) => {
  const spy = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ bottom: 0 } as DOMRect)
  for (const bottom of bottoms) spy.mockReturnValueOnce({ bottom } as DOMRect)
}

function stage(): { scroller: HTMLDivElement; label: HTMLSpanElement } {
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(scroller, 'clientHeight', { value: 800 })
  const label = document.createElement('span')
  scroller.append(label)
  document.body.append(scroller)
  return { scroller, label }
}

describe('revealAbove', () => {
  afterEach(() => document.body.replaceChildren())

  it('scrolls a measurement the sheet would cover up above the sheet', () => {
    const { scroller, label } = stage()
    box(label, 600, 600)
    revealAbove(label, 500)
    expect(scroller.scrollTop).toBe(124)
  })

  it('leaves the drawing alone when the measurement is already clear of the sheet', () => {
    const { scroller, label } = stage()
    box(label, 300)
    revealAbove(label, 500)
    expect(scroller.scrollTop).toBe(0)
  })

  it('makes room below the last page when the drawing cannot scroll that far, and gives it back', () => {
    const { scroller, label } = stage()
    Object.defineProperty(scroller, 'scrollHeight', { value: 800 })
    box(label, 600, 600)
    const restore = revealAbove(label, 500)
    expect(scroller.style.paddingBottom).toBe('124px')
    restore()
    expect(scroller.style.paddingBottom).toBe('')
  })
})
