// @disk-inputs: app/**, ui/**
/**
 * No number in the product shows a slashed zero.
 *
 * Geist Mono draws its default 0 with a slash. In a count it reads as a
 * struck-through zero (Notion #38, the review filter). The fix is the font's
 * own stylistic set, which swaps in the plain 0 and is switched on once, where
 * the mono family is defined: `--font-mono--font-feature-settings` in
 * `ui/styles/tokens.css`. Tailwind puts it on every `font-mono` and on
 * `code`, `kbd`, `pre` and `samp`.
 *
 * Each end can come undone on its own, so each is held here:
 *   - the file the layout loads must still draw a plain 0 under the features
 *     tokens.css declares. The Google Fonts copy strips every stylistic set, and
 *     a `geist` upgrade could move the plain 0 to another set;
 *   - code that sets the mono family by hand (`var(--font-mono)`) skips the
 *     utility, so it must set the feature beside it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import * as fontkit from 'fontkit'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/** The OpenType tags in `--font-mono--font-feature-settings`, e.g. `'ss09'` → `['ss09']`. */
function monoFeatures(): string[] {
  const declaration = read('ui/styles/tokens.css').match(
    /--font-mono--font-feature-settings:\s*([^;]+);/
  )
  expect(declaration, 'tokens.css declares --font-mono--font-feature-settings').not.toBeNull()
  return [...(declaration?.[1] ?? '').matchAll(/['"]([a-z0-9]{4})['"](?:\s+(?:on|1))?/g)].map(
    (tag) => tag[1]
  )
}

/** The file `app/layout.tsx` hands `next/font/local` for `--font-geist-mono`, resolved. */
function monoFontFile(): string {
  const layout = read('app/layout.tsx')
  const loader =
    layout.match(/localFont\(\{[^}]*?variable:\s*'--font-geist-mono'[^}]*\}\)/)?.[0] ?? ''
  const src = loader.match(/src:\s*'([^']+)'/)?.[1]
  expect(src, 'app/layout.tsx loads --font-geist-mono with next/font/local').toBeDefined()
  return resolve(ROOT, 'app', src ?? '')
}

/** Closed outlines of the glyph drawn for `text`: a plain 0 has two (the ring and its counter), a slashed one three. */
function contours(font: fontkit.Font, text: string, features: string[]): number {
  const [glyph] = font.layout(text, features).glyphs
  return glyph.path.commands.filter((command) => command.command === 'closePath').length
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path)
    return /\.(tsx?|css)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [path] : []
  })
}

describe('the mono face draws a plain zero', () => {
  it('is loaded from the full font, not the Google Fonts subset', () => {
    expect(read('app/layout.tsx')).not.toMatch(/from 'next\/font\/google'/)
  })

  it('draws 0 without a slash under the features tokens.css switches on', () => {
    const features = monoFeatures()
    const font = fontkit.openSync(monoFontFile())
    if (!('layout' in font)) throw new Error('the mono font file is a collection, not one face')

    expect(features.every((tag) => font.availableFeatures.includes(tag))).toBe(true)
    expect(contours(font, 'O', features), 'the plain ring the 0 is compared with').toBe(2)
    expect(contours(font, '0', features)).toBe(2)
  })

  it('sets the feature wherever code names the mono family by hand', () => {
    const offenders = ['app', 'ui']
      .flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .map((file) => ({ name: relative(ROOT, file), text: readFileSync(file, 'utf8') }))
      .filter(({ name }) => name !== 'ui/styles/tokens.css')
      .filter(
        ({ text }) =>
          text.includes('var(--font-mono)') && !text.includes('--font-mono--font-feature-settings')
      )
      .map(({ name }) => name)

    expect(
      offenders,
      'use `font-mono`, or set font-feature-settings: var(--font-mono--font-feature-settings)'
    ).toEqual([])
  })
})
