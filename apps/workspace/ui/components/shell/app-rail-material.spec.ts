// @disk-inputs: ui/components/shell/*.tsx, ui/components/ui/sidebar.tsx
/**
 * The app rail's material (docs/design/design-language.md, „The app rail“): the
 * rail is the one grey, what sits on it is white, a selected or open thing is a
 * fill, and nothing on it is a box or a rule. Until 2026-11-06 the active
 * section and the project switcher were white cards with a hairline and a
 * shadow, hairlines cut the rail into four bands, and a green „Verbunden“ dot
 * said all day that nothing was wrong.
 *
 * Read from disk rather than rendered, because the defect is a class a person
 * adds without noticing what it does to the whole: one `shadow-xs` on a chip,
 * one `border-t` to „tidy“ a group. Each exception names its function.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')

/** The rail, its phone shapes and the shell chrome beside them. */
const RAIL_FILES = [
  'ui/components/shell/app-sidebar.tsx',
  'ui/components/shell/sidebar-brand.tsx',
  'ui/components/shell/project-switcher.tsx',
  'ui/components/shell/project-pill.tsx',
  'ui/components/shell/project-switcher-sheet.tsx',
  'ui/components/shell/sidebar-user-menu.tsx',
  'ui/components/shell/connection-band.tsx',
  'ui/components/shell/connection-presence-indicator.tsx',
  'ui/components/shell/phone-tab-bar.tsx',
  'ui/components/shell/org-header.tsx',
  'ui/components/ui/sidebar.tsx',
] as const

/** Rules that carry a function, by file, each with its reason. */
const RULES_ALLOWED: Record<string, { pattern: RegExp; reason: string }[]> = {
  // Paper bar on paper page above a project: the rule is the only edge between the scrolling
  // page and the fixed bar. Inside a project the bar is grey and draws none.
  'ui/components/shell/phone-tab-bar.tsx': [
    { pattern: /'border-border bg-background border-t'/, reason: 'paper on paper' },
    { pattern: /dark:border-t\b/, reason: 'dark: band and plane are 1.03:1' },
  ],
  // In dark the band and the plane are 1.03:1, no edge at all: the rule draws the one the step
  // cannot, along the rail and under the phone's project band.
  'ui/components/ui/sidebar.tsx': [{ pattern: /dark:border-r\b/, reason: 'dark: band and plane are 1.03:1' }],
  'ui/components/shell/app-sidebar.tsx': [{ pattern: /dark:border-b\b/, reason: 'dark: band and plane are 1.03:1' }],
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
}

function source(file: string): string {
  let text = withoutComments(readFileSync(join(ROOT, file), 'utf8'))
  for (const { pattern } of RULES_ALLOWED[file] ?? []) text = text.replace(pattern, '')
  return text
}

describe('the app rail’s material', () => {
  it('draws no rule between its parts, under its header or along its edge', () => {
    const offenders = RAIL_FILES.filter((file) => /(?<![\w-])border-[tbrl](?![\w-])|\bdivide-[xy]\b|<Separator\b|bg-border [^'"]*\bw-px\b/.test(source(file)))
    expect(offenders).toEqual([])
  })

  it('raises nothing: no shadow on a chip, a pill, a switcher or a card', () => {
    const offenders = RAIL_FILES.filter((file) => /\bshadow-(xs|sm|md|lg|raised)\b|\bbg-card\b/.test(source(file)))
    expect(offenders).toEqual([])
  })

  it('fills with the one grey, the state fill or white on the band, never a step of either, and writes no alpha ink', () => {
    const offenders = RAIL_FILES.filter((file) =>
      /\bbg-(muted|accent|secondary|background|sidebar-accent)\/\d+|\btext-(foreground|sidebar-foreground|muted-foreground)\/\d+/.test(source(file))
    )
    expect(offenders).toEqual([])
  })

  it('sets its labels at 12px or larger: no 10.5px or 11px fine print', () => {
    const offenders = RAIL_FILES.filter((file) => /\btext-\[(10|10\.5|11|11\.5)px\]/.test(source(file)))
    expect(offenders).toEqual([])
  })
})
