/**
 * @vitest-environment node
 */

import React from 'react'
import { describe, expect, it } from 'vitest'
import { CoverContent, RunningHeader } from './branding'

const strings = (node: React.ReactNode | Promise<React.ReactNode>, out: string[] = []): string[] => {
  if (node instanceof Promise) throw new Error('expected a synchronously rendered tree')
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

describe('the frame is transliterated like the body', () => {
  it('renders a comparator in the cover title as <=', () => {
    const rendered = strings(
      CoverContent({ cover: { title: 'Fluchtweglänge ≤ 40 m', facts: [] } } as never)
    ).join(' ')
    expect(rendered).toContain('<= 40 m')
    expect(rendered).not.toContain('≤')
    expect(rendered).not.toContain('d 40 m')
  })

  it('renders a comparator in the running header, which repeats on every page', () => {
    const rendered = strings(RunningHeader({ title: 'Auftritt ≥ 27 cm' } as never)).join(' ')
    expect(rendered).toContain('>= 27 cm')
    expect(rendered).not.toContain('≥')
  })

  it('leaves ordinary German prose on the cover exactly as written', () => {
    const prose = 'Prüfung der Gebäudeklasse für Größe und Türbreite'
    const rendered = strings(
      CoverContent({ cover: { title: prose, facts: [] } } as never)
    ).join(' ')
    expect(rendered).toContain(prose)
  })
})
