// @disk-inputs: ../../packages/brand/tokens.json
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDF_THEME } from './theme'

type BrandToken = { name: string; value: { light: string; dark?: string } }

const BRAND: BrandToken[] = JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'packages', 'brand', 'tokens.json'), 'utf8')).color.tokens

function token(name: string): string {
  const found = BRAND.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`${name} is not a brand token`)
  return found.value.light
}

function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount).toString(16).padStart(2, '0'))
    .join('')}`
}

describe('PDF_THEME', () => {
  it('takes its neutrals from the brand tokens', () => {
    expect(PDF_THEME.ink).toBe(token('ink'))
    expect(PDF_THEME.body).toBe(token('ink-hover'))
    expect(PDF_THEME.subtle).toBe(token('ink-muted'))
    expect(PDF_THEME.inverse).toBe(token('surface'))
    expect(PDF_THEME.panel).toBe(token('surface'))
    expect(PDF_THEME.surface).toBe(token('surface-sunken'))
    expect(PDF_THEME.surfaceAlt).toBe(token('surface'))
    expect(PDF_THEME.hairline).toBe(token('line'))
    expect(PDF_THEME.rule).toBe(mix(token('line'), token('ink'), 0.06))
  })

  it('prints on white paper, the one documented exception', () => {
    expect(PDF_THEME.paper).toBe('#ffffff')
  })
})
