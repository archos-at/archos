// @disk-inputs: app/globals.css
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sparkles } from 'lucide-react'
import { SectionLabel } from './section-label'

const ROOT = join(__dirname, '..', '..', '..')

function eyebrowDeclarations(): Map<string, string> {
  const css = postcss.parse(readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8'))
  const rules: Rule[] = []
  css.walkRules('.card-eyebrow', (rule) => {
    rules.push(rule)
  })
  const [rule] = rules
  if (!rule) throw new Error('.card-eyebrow is missing from app/globals.css')
  const declarations = new Map<string, string>()
  rule.walkDecls((declaration) => {
    declarations.set(declaration.prop, declaration.value)
  })
  return declarations
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
    const declarations = eyebrowDeclarations()
    expect(declarations.get('font-size')).toBe('12px')
    expect(declarations.has('text-transform')).toBe(false)
    expect(declarations.has('letter-spacing')).toBe(false)
  })
})
