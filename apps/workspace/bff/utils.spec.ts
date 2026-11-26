// @disk-inputs: ui/styles/tokens.css
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { TYPE_SCALE, cn } from './utils'

describe('cn', () => {
  it('keeps a type-scale size beside a text colour, and lets a later size win', () => {
    expect(cn('text-name text-foreground')).toBe('text-name text-foreground')
    expect(cn('text-muted-foreground text-meta')).toBe('text-muted-foreground text-meta')
    expect(cn('text-sm', 'text-section')).toBe('text-section')
  })

  it('knows every size the tokens declare', () => {
    const tokens = postcss.parse(readFileSync(join(__dirname, '../ui/styles/tokens.css'), 'utf8'))
    const sizes: string[] = []
    tokens.walkDecls(/^--text-[a-z]+(?:-[a-z]+)*$/, (declaration) => {
      if (/^[\d.]+rem$/.test(declaration.value)) sizes.push(declaration.prop.slice('--text-'.length))
    })
    expect(sizes.length).toBeGreaterThan(0)
    expect([...TYPE_SCALE].sort()).toEqual([...new Set(sizes)].sort())
  })
})
