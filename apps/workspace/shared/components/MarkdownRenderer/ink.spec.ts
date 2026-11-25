import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'

import { INK_MS, NO_INK, blockInk, nextInk, rehypeInk, type InkRun } from './ink'

const render = (markdown: string, runs: InkRun[]): string =>
  renderToStaticMarkup(createElement(ReactMarkdown, { rehypePlugins: [[rehypeInk, { runs }]] }, markdown))

describe('nextInk', () => {
  it('stamps each newly revealed stretch with the time it arrived', () => {
    let ink = { content: 'Die', runs: NO_INK }
    ink = nextInk(ink, 'Die Brüstung', 1000)
    ink = nextInk(ink, 'Die Brüstung ist', 1100)
    expect(ink.runs).toEqual([
      { from: 3, to: 12, born: 1000 },
      { from: 12, to: 16, born: 1100 },
    ])
  })

  it('folds reveals within one bucket into a single run, so a frame-by-frame pace stays a few spans', () => {
    let ink = nextInk({ content: '', runs: NO_INK }, 'ab', 1000)
    ink = nextInk(ink, 'abcd', 1016)
    expect(ink.runs).toEqual([{ from: 0, to: 4, born: 1000 }])
  })

  it('drops runs that have finished fading', () => {
    const ink = nextInk({ content: 'ab', runs: [{ from: 0, to: 2, born: 0 }] }, 'abc', INK_MS + 1)
    expect(ink.runs).toEqual([{ from: 2, to: 3, born: INK_MS + 1 }])
  })

  it('shows a rewrite at once instead of fading text the reader already read', () => {
    const ink = nextInk({ content: 'Die Brüstung', runs: [{ from: 0, to: 12, born: 0 }] }, 'Das Geländer', 10)
    expect(ink.runs).toBe(NO_INK)
  })
})

describe('blockInk', () => {
  it('gives each block the runs inside its own lines, in its own offsets', () => {
    const content = 'erster Absatz\n\nzweiter'
    const runs: InkRun[] = [{ from: 10, to: 22, born: 5 }]
    const blocks = [
      { source: 'erster Absatz', line: 0 },
      { source: 'zweiter', line: 2 },
    ]
    expect(blockInk(blocks, content, runs)).toEqual([[{ from: 10, to: 13, born: 5 }], [{ from: 0, to: 7, born: 5 }]])
  })

  it('hands an untouched block the shared empty list, so its memo holds', () => {
    const blocks = [
      { source: 'alt', line: 0 },
      { source: 'neu', line: 2 },
    ]
    expect(blockInk(blocks, 'alt\n\nneu', [{ from: 6, to: 8, born: 1 }])[0]).toBe(NO_INK)
  })
})

describe('rehypeInk', () => {
  it('wraps only the fresh tail of a paragraph, inside its inline markup too', () => {
    expect(render('Höhe **1,10 m** gilt', [{ from: 9, to: 20, born: 7 }])).toBe(
      '<p>Höhe <strong>1,<span data-ink="7">10 m</span></strong><span data-ink="7"> gilt</span></p>'
    )
  })

  it('leaves code alone, which its renderer reads as a string', () => {
    expect(render('`a < b` neu', [{ from: 0, to: 11, born: 1 }])).toBe('<p><code>a &lt; b</code><span data-ink="1"> neu</span></p>')
  })
})
