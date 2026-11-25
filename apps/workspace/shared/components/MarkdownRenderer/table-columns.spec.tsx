import { render } from '@/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownRenderer } from './MarkdownRenderer'

const HEAD = ['| Variante | Fläche | Bewertung |', '|---|---|---|']
const FIRST = '| A | 120 m² | gut |'
const LONG = '| B | 95 m² | Die Abstandsfläche reicht nur mit einer Ausnahme nach § 6 Abs. 2, die zu beantragen wäre |'

const WIDTHS: Record<string, number> = { TABLE: 600, TH: 200 }

let spy: ReturnType<typeof vi.spyOn> | undefined

beforeEach(() => {
  spy = vi
    .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return WIDTHS[this.tagName] ?? 0
    })
})

afterEach(() => spy?.mockRestore())

const columnsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('table > colgroup > col')].map((col) => (col as HTMLElement).style.width)

describe('a table that streams in', () => {
  it('holds the columns its header and first row laid out, so later rows cannot reflow them', () => {
    const { container, rerender } = render(<MarkdownRenderer content={[...HEAD, FIRST].join('\n')} isStreaming />)
    const table = container.querySelector('table')!
    expect(table.dataset.columns).toBe('held')
    expect(table.style.tableLayout).toBe('fixed')
    expect(table.className).toContain('[&_td]:align-top')
    const held = columnsOf(container)
    expect(held).toHaveLength(3)
    expect(Number.parseFloat(held[0]!)).toBeCloseTo(100 / 3)

    WIDTHS.TH = 80
    rerender(<MarkdownRenderer content={[...HEAD, FIRST, LONG].join('\n')} isStreaming />)
    expect(columnsOf(container)).toEqual(held)

    rerender(<MarkdownRenderer content={[...HEAD, FIRST, LONG].join('\n')} />)
    expect(columnsOf(container)).toEqual(held)
    WIDTHS.TH = 200
  })

  it('keeps the stacking its first rows decided when a later row brings a sentence', () => {
    const TWO = ['| Variante | Bewertung |', '|---|---|', '| A | gut |']
    const SENTENCE =
      '| B | Die Abstandsfläche reicht nur mit einer Ausnahme nach § 6 Abs. 2, die beim Bauamt zu beantragen wäre und deren Ausgang offen ist, solange die Nachbarn nicht zugestimmt haben |'
    const { container, rerender } = render(<MarkdownRenderer content={TWO.join('\n')} isStreaming />)
    expect(container.querySelector('table')!.dataset.stack).toBeUndefined()

    rerender(<MarkdownRenderer content={[...TWO, SENTENCE].join('\n')} isStreaming />)
    expect(container.querySelector('table')!.dataset.stack).toBeUndefined()
    rerender(<MarkdownRenderer content={[...TWO, SENTENCE].join('\n')} />)
    expect(container.querySelector('table')!.dataset.stack).toBeUndefined()

    const opened = render(<MarkdownRenderer content={[...TWO, SENTENCE].join('\n')} />)
    expect(opened.container.querySelector('table')!.dataset.stack).toBe('always')
  })

  it('leaves a table the reader opened already written to the browser’s own layout', () => {
    const { container } = render(<MarkdownRenderer content={[...HEAD, FIRST, LONG].join('\n')} />)
    const table = container.querySelector('table')!
    expect(table.dataset.columns).toBeUndefined()
    expect(table.style.tableLayout).toBe('')
    expect(table.className).not.toContain('[&_td]:align-top')
    expect(columnsOf(container)).toEqual([])
  })
})
