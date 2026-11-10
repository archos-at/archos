// @disk-inputs: ui/styles/tokens.css
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TYPE_SCALE, cn } from './utils'

describe('cn', () => {
  it('keeps a type-scale size beside a text colour, and lets a later size win', () => {
    // RATCHET: tailwind-merge read an unknown `text-*` as a colour and dropped `text-name` next to `text-foreground`.
    expect(cn('text-name text-foreground')).toBe('text-name text-foreground')
    expect(cn('text-muted-foreground text-meta')).toBe('text-muted-foreground text-meta')
    expect(cn('text-sm', 'text-section')).toBe('text-section')
  })

  it('knows every size the tokens declare', () => {
    const tokens = readFileSync(join(__dirname, '../ui/styles/tokens.css'), 'utf8')
    const sizes = [...tokens.matchAll(/^\s*--text-([a-z]+(?:-[a-z]+)*):\s*[\d.]+rem/gm)].map((match) => match[1])
    expect(sizes.length).toBeGreaterThan(0)
    expect([...TYPE_SCALE].sort()).toEqual([...new Set(sizes)].sort())
  })
})
