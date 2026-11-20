// @disk-inputs: shared/brand/tokens.vars.css, ui/styles/tokens.css
/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss, { type Root } from 'postcss'
import { describe, expect, test, vi } from 'vitest'

import manifest from './manifest'
import { THEME_COLOR } from './theme-boot'
import { PRODUCT_NAME } from '@/lib/brand'

vi.mock('next/font/local', () => ({
  default: (options: Record<string, unknown>) => ({ className: '', variable: String(options.variable), style: {} }),
}))
vi.mock('./providers', () => ({ Providers: () => null }))
vi.mock('./chunk-reload-guard', () => ({ ChunkReloadGuard: () => null }))
vi.mock('@/components/shell/navigation-trail', () => ({ NavigationTrail: () => null }))
vi.mock('@/lib/auth/session', () => ({ getUserSession: vi.fn() }))
vi.mock('@/lib/db/tenant-context', () => ({ runWithTenantSlot: vi.fn() }))
vi.mock('@/lib/documents/vlm-capability', () => ({ isVlmConfigured: vi.fn() }))
vi.mock('@/i18n/server', () => ({ getLocale: vi.fn() }))

const parseCss = (path: string): Root => postcss.parse(readFileSync(path, 'utf8'))

const declaredValues = (root: Root, prop: string): string[] => {
  const values: string[] = []
  root.walkDecls(prop, (declaration) => {
    values.push(declaration.value)
  })
  return values
}

describe('installed app chrome', () => {
  test('the manifest paints the paper the app opens on', () => {
    const { theme_color, background_color } = manifest()

    expect(theme_color).toBe(THEME_COLOR.light)
    expect(background_color).toBe(THEME_COLOR.light)
  })

  test('THEME_COLOR is still the --background token of each theme', () => {
    const tokens = parseCss(join(__dirname, '..', 'ui', 'styles', 'tokens.css'))
    const backgrounds = declaredValues(tokens, '--background')
    const papers = declaredValues(tokens, '--paper')

    expect(backgrounds.at(-1)).toBe('var(--paper)')
    expect(papers).toEqual([THEME_COLOR.light, THEME_COLOR.dark])
  })

  test('the light paper is the brand’s surface (the corporate design), so the installed app opens on the brand ground', () => {
    const brand = parseCss(join(__dirname, '..', 'shared', 'brand', 'tokens.vars.css'))
    expect(THEME_COLOR.light).toBe(declaredValues(brand, '--ds-surface')[0])
  })

  test('iOS gets standalone metadata, under the product name', async () => {
    const { metadata } = await import('./layout')

    expect(metadata.appleWebApp).toEqual({ capable: true, title: PRODUCT_NAME, statusBarStyle: 'default' })
  })
})
