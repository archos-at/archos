/**
 * @vitest-environment node
 */

import React from 'react'
import { describe, expect, it } from 'vitest'
import type { DocBlock } from '@/lib/answer-export/blocks'
import { blockNodes } from './blocks-to-pdf'

const strings = (node: React.ReactNode, out: string[] = []): string[] => {
  React.Children.forEach(node, (child) => {
    if (typeof child === 'string') out.push(child)
    else if (React.isValidElement(child)) {
      const rendered =
        typeof child.type === 'function'
          ? (child.type as (p: unknown) => React.ReactNode)(child.props)
          : (child.props as { children?: React.ReactNode }).children
      strings(rendered, out)
    }
  })
  return out
}

const textOf = (blocks: DocBlock[]): string => strings(blockNodes(blocks)).join(' ')

describe('the comparator reaches the page as a comparator', () => {
  it('renders ≤ as <=, not as the letter WinAnsi would print', () => {
    const rendered = textOf([
      { kind: 'paragraph', runs: [{ text: 'Fluchtweglänge ≤ 40 m' }] },
    ])
    expect(rendered).toContain('<= 40 m')
    expect(rendered).not.toContain('d 40 m')
    expect(rendered).not.toContain('≤')
  })

  it('renders ≥ as >=', () => {
    expect(textOf([{ kind: 'paragraph', runs: [{ text: 'Auftritt ≥ 27 cm' }] }])).toContain(
      '>= 27 cm'
    )
  })

  it('transliterates inside table cells, where the checks actually live', () => {
    const rendered = textOf([
      {
        kind: 'table',
        head: ['Position', 'Soll'],
        rows: [[[{ text: 'Fluchtweglänge' }], [{ text: '≤ 40 m' }]]],
      },
    ])
    expect(rendered).toContain('<= 40 m')
    expect(rendered).not.toContain('≤')
  })

  it('leaves ordinary German prose exactly as written', () => {
    const prose = 'Für Gebäude der Größe muß die Tür schließen'
    expect(textOf([{ kind: 'paragraph', runs: [{ text: prose }] }])).toContain(prose)
  })
})

describe('a link label is prose too', () => {
  it('transliterates inside a markdown link label', () => {
    const rendered = textOf([
      {
        kind: 'paragraph',
        runs: [{ text: 'Siehe [OIB-RL 2 \u2264 40 m Regel](https://example.org/oib) fuer Details.' }],
      },
    ])
    expect(rendered).toContain('<= 40 m')
    expect(rendered).not.toContain('\u2264')
    expect(rendered).not.toContain('d 40 m')
  })

  it('leaves the href alone', () => {
    const nodes = blockNodes([
      { kind: 'paragraph', runs: [{ text: 'Siehe [Regel](https://example.org/a\u2264b) hier.' }] },
    ])
    const hrefs: string[] = []
    const walk = (node: React.ReactNode): void => {
      React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return
        const props = child.props as { src?: string; children?: React.ReactNode }
        if (typeof props.src === 'string') hrefs.push(props.src)
        walk(props.children)
      })
    }
    walk(nodes)
    expect(hrefs.some((href) => href.includes('\u2264'))).toBe(true)
  })
})
