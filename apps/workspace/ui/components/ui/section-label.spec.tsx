// @disk-inputs: app/globals.css
/**
 * The eyebrow is set in sentence case. The wordmark is the only element in
 * capitals (the brand's design system), so neither the primitive nor the
 * `.card-eyebrow` step it reaches for may bring `uppercase` or the wide
 * tracking that only existed to keep capitals legible. The case lives in CSS,
 * which jsdom does not load, so the stylesheet half reads `globals.css`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sparkles } from 'lucide-react'
import { SectionLabel } from './section-label'

const ROOT = join(__dirname, '..', '..', '..')

function eyebrowRule(): string {
  const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')
  const match = /\.card-eyebrow\s*\{([^}]*)\}/.exec(css)
  if (!match) throw new Error('.card-eyebrow is missing from app/globals.css')
  return match[1]
}

describe('SectionLabel', () => {
  it('renders the eyebrow step in muted ink, without capitals or tracking', () => {
    render(<SectionLabel>Weitermachen</SectionLabel>)
    const label = screen.getByText('Weitermachen')
    expect(label.tagName).toBe('SPAN')
    expect(label).toHaveClass('card-eyebrow', 'text-muted-foreground')
    expect(label.className).not.toMatch(/\buppercase\b/)
    expect(label.className).not.toMatch(/\btracking-/)
  })

  it('renders the element it is asked for, with an icon beside the label', () => {
    render(
      <dl>
        <SectionLabel as="dt" icon={Sparkles}>
          Belegt durch
        </SectionLabel>
      </dl>,
    )
    const label = screen.getByText('Belegt durch')
    expect(label.tagName).toBe('DT')
    expect(label.querySelector('svg')).not.toBeNull()
  })

  it('takes its size from `.card-eyebrow`, which sets no case and no tracking', () => {
    const rule = eyebrowRule()
    expect(rule).toMatch(/font-size:\s*10\.5px/)
    expect(rule).not.toMatch(/text-transform/)
    expect(rule).not.toMatch(/letter-spacing/)
  })
})
