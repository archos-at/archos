// @disk-inputs: app/**, ui/**, shared/**, i18n/dictionaries/**
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_COLOR } from '../app/theme-boot'

const ROOT = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dev' ? [] : sourceFiles(path)
    return /\.(tsx?|css)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [path] : []
  })
}

const files = ['app', 'ui', 'shared']
  .flatMap((dir) => sourceFiles(join(ROOT, dir)))
  .filter((file) => !file.includes(`${join(ROOT, 'shared', 'brand')}`))
  .map((file) => ({ name: relative(ROOT, file), text: readFileSync(file, 'utf8') }))

const WHITE_ALLOWED = new Set([
  'ui/components/ui/live-cursor.tsx',
  'ui/components/ui/comment-pin.tsx',
  'ui/features/knowledge/components/pdf-viewer-atoms.tsx',
  'ui/features/diagrams/components/sketch-figure.tsx',
  'ui/features/projects/components/intake-question-field.tsx',
  'ui/features/documents/components/review/review-page-layer.tsx', // the pointer's ring on the page
  'ui/features/diagrams/components/mermaid-diagram.tsx', // a comment recalling the old white
])

const BOLD_ALLOWED = new Set(['ui/components/brand/logo.tsx', 'ui/features/project-intake/components/reading/reading-milestone-card.tsx'])

describe('weight', () => {
  it('weights are 440, 500 and 600: nothing is bold or extrabold but the wordmark', () => {
    const offenders = files
      .filter((f) => f.name.endsWith('.tsx') || f.name.endsWith('.ts'))
      .filter((f) => /\bfont-(bold|extrabold|black)\b/.test(withoutComments(f.text)) && !BOLD_ALLOWED.has(f.name))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })

  it('the type scale carries a title by size at 500 and the small heading at 600: section 16/600, pane title 18/500, page title 20/500', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    for (const [name, size, weight] of [['section', '1rem', '600'], ['pane-title', '1.125rem', '500'], ['page-title', '1.25rem', '500']]) {
      expect(tokens, name).toMatch(new RegExp(`--text-${name}:\\s*${size};`))
      expect(tokens, name).toMatch(new RegExp(`--text-${name}--font-weight:\\s*${weight};`))
    }
  })

  it('the lightest weight is the raised normal, 440, read by the body and every font-normal', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    expect(/--font-weight-normal:\s*440;/.test(tokens)).toBe(true)
    const globals = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
    expect(/body \{[^}]*font-weight: var\(--font-weight-normal\);/.test(globals)).toBe(true)
  })

  it('nothing is set lighter than the normal weight (Notion #38)', () => {
    const classes = files
      .filter((f) => !f.name.endsWith('.css'))
      .filter((f) => /\bfont-(thin|extralight|light)\b/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(classes).toEqual([])
    const css = files
      .filter((f) => f.name.endsWith('.css'))
      .filter((f) => /font-weight:\s*(normal|lighter|[1-4]00)\b/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(css).toEqual([])
  })

  it('the stylesheet sets no weight above 600 outside the wordmark face', () => {
    const css = files.filter((f) => f.name.endsWith('.css'))
    const offenders = css.filter((f) => /font-weight:\s*(7|8|9)00/.test(f.text) && !/@font-face/.test(f.text))
    expect(offenders.map((f) => f.name)).toEqual([])
  })
})

const OWN_H1_ALLOWED = new Map([
  ['ui/features/layout/components/chat-area/chat-area-states.tsx', 'the chat\u2019s hero greeting (23px, the ramp\u2019s one larger moment) and the signed-out card'],
  ['ui/components/brand/status-screen.tsx', 'one centred message under the logo (404, error), not a page with a header'],
  ['ui/features/onboarding/components/organization-setup.tsx', 'a centred setup card, the size of its form'],
  ['ui/features/project-intake/components/steps/reading-step.tsx', 'the reading step\u2019s live phase line, 22px on a phone'],
  ['ui/features/project-intake/components/questions/round-list.tsx', 'the title of the question list\u2019s side column, not of the page'],
  ['app/legal/[slug]/page.tsx', 'a legal document\u2019s own title, set as a document'],
  ['shared/components/MarkdownRenderer/heading-renderers.tsx', 'a heading inside rendered Markdown (an answer, a note), not the page\u2019s'],
])

describe('page titles', () => {
  const h1Tags = (text: string): string[] => withoutComments(text).match(/<h1\b[\s\S]*?>/g) ?? []
  const isPageTitle = (tag: string): boolean => /text-page-title|PAGE_TITLE_CLASS|\bsr-only\b/.test(tag)

  it('every h1 is set as a page title: one size and one weight across the app', () => {
    const offenders = files
      .filter((f) => f.name.endsWith('.tsx') && !OWN_H1_ALLOWED.has(f.name))
      .filter((f) => h1Tags(f.text).some((tag) => !isPageTitle(tag)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })

  it('the allowlist has no stale entry', () => {
    const byName = new Map(files.map((f) => [f.name, f.text]))
    const stale = [...OWN_H1_ALLOWED.keys()].filter((name) => !h1Tags(byName.get(name) ?? '').some((tag) => !isPageTitle(tag)))
    expect(stale).toEqual([])
  })
})

describe('white', () => {
  it('text-white and bg-white stay in the allowlist', () => {
    const offenders = files
      .filter((f) => /\b(text|bg|border)-white\b/.test(f.text) && !WHITE_ALLOWED.has(f.name))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })

  it('no surface token is oklch(1 0 0)', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    const lines = tokens.split('\n').filter((line) => /oklch\(1 0 0\)/.test(line))
    expect(lines.filter((line) => !line.includes('--paper-ink-foreground'))).toEqual([])
  })

  it('the browser-chrome colours are the app\u2019s paper, which is its background', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    const layer = tokens.slice(tokens.indexOf('Paper on a desk (2026-11-10)'))
    const light = /:root \{[^}]*--paper: (#[0-9a-f]{6});/.exec(layer)?.[1]
    const dark = /\.dark \{[^}]*--paper: (#[0-9a-f]{6});/.exec(layer)?.[1]
    expect(THEME_COLOR).toEqual({ light, dark })
    expect(/:root \{[^}]*--background: var\(--paper\);/.test(layer)).toBe(true)
  })
})

describe('data palette', () => {
  it('the chart series hexes are typed in ui/styles/data-palette.css and nowhere else', () => {
    const palette = readFileSync(join(ROOT, 'ui/styles/data-palette.css'), 'utf8')
    const series = [...palette.matchAll(/--data-series-[1-8]: (#[0-9a-f]{6})/g)].map((m) => m[1]!)
    expect(series).toHaveLength(16)
    const offenders = files
      .filter((f) => f.name !== 'ui/styles/data-palette.css')
      .filter((f) => series.some((hex) => f.text.includes(hex)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

const CAPITALS_ALLOWED = new Set([
  'ui/components/brand/logo.tsx', // the wordmark
  'ui/features/documents/components/file-ext-chip.tsx', // file-format code
  'ui/features/documents/components/file-list-view.tsx', // file-format code in the list's first column
  'ui/features/documents/components/file-card.tsx', // file-format code chip
  'ui/features/documents/components/folder-bin-panel.tsx', // file-format code in the Papierkorb's first column
  'ui/features/documents/components/document-kind-thumbnail.tsx', // file-format code chip
  'ui/features/chat/components/MessageAuthor.tsx', // initials in the avatar disc
  'ui/features/chat/components/AuthorityTag.tsx', // OIB / RIS / ÖNORM
])

const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const setsCapitals = (f: { name: string; text: string }): boolean =>
  f.name.endsWith('.css')
    ? /text-transform:\s*uppercase/.test(withoutComments(f.text))
    : /(?<![\w:-])uppercase(?![\w-])/.test(withoutComments(f.text))

describe('capitals', () => {
  it('only the wordmark and codes are set in capitals', () => {
    const offenders = files.filter((f) => setsCapitals(f) && !CAPITALS_ALLOWED.has(f.name)).map((f) => f.name)
    expect(offenders).toEqual([])
  })

  it('the allowlist has no stale entry', () => {
    const stale = [...CAPITALS_ALLOWED].filter((name) => !files.some((f) => f.name === name && setsCapitals(f)))
    expect(stale).toEqual([])
  })
})

describe('answer text size', () => {
  it('the token is 16px and the card ramp reads it', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    expect(/--text-answer:\s*1rem;/.test(tokens)).toBe(true)
    const globals = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
    for (const step of ['card-body', 'card-title', 'card-figure-16']) {
      const rule = new RegExp(`\\.${step} \\{[^}]*font-size: var\\(--text-answer\\);`)
      expect(rule.test(globals), step).toBe(true)
    }
  })

  it('no answer surface sets the old in-between sizes (17px lede, 15px block body, 13.5px card row)', () => {
    const answerFiles = files.filter(
      (f) =>
        f.name.startsWith('shared/components/MarkdownRenderer/') ||
        f.name.startsWith('ui/features/chat/components/agent-response/') ||
        f.name === 'ui/features/chat/components/AnswerAnatomy.tsx' ||
        f.name.startsWith('ui/features/cards/'),
    )
    const offenders = answerFiles
      .filter((f) => /text-\[(1\.0625rem|17px|15px|13\.5px)\]/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

describe('tracking', () => {
  it('nothing but the wordmark sets a negative letter-spacing', () => {
    const offenders = files
      .filter((f) => f.name !== 'ui/components/brand/logo.tsx')
      .filter((f) => /\btracking-tight(er)?\b|tracking-\[-|letter-spacing:\s*-/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

describe('five neutrals, three elevations', () => {
  const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
  const light = tokens.slice(tokens.indexOf('Paper on a desk (2026-11-10)'))
  it('the five neutrals are the spec\u2019s', () => {
    for (const [name, hex] of [['sheet', '#ffffff'], ['paper', '#fafaf9'], ['desk', '#f2f1f0'], ['selected', '#e7e5e3'], ['pressed', '#dcdad7']]) {
      expect(light, name).toContain(`--${name}: ${hex};`)
    }
  })
  it('the light paper and desk are the brand\u2019s surface and sunken surface (corporate design)', () => {
    const brand = readFileSync(join(ROOT, 'shared/brand/tokens.vars.css'), 'utf8')
    const ds = (name: string) => new RegExp(`--ds-${name}:\\s*(#[0-9a-f]{6});`).exec(brand)?.[1]
    const root = light.slice(light.indexOf(':root {'), light.indexOf('}', light.indexOf(':root {')))
    expect(root).toContain(`--paper: ${ds('surface')};`)
    expect(root).toContain(`--desk: ${ds('surface-sunken')};`)
  })
  it('hairline and edge are ink alpha', () => {
    expect(light).toContain('--hairline: rgb(15 14 13 / 0.08);')
    expect(light).toContain('--edge: rgb(15 14 13 / 0.12);')
  })
  it('the elevation steps are distinct and each one is visible (an edge ring plus a shadow)', () => {
    const root = light.slice(0, light.indexOf('.dark {'))
    const value = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(root)?.[1]
    const steps = ['elevation-1', 'elevation-2', 'elevation-3'].map(value)
    expect(new Set(steps).size).toBe(3)
    for (const step of steps) expect(step).toMatch(/^0 0 0 1px (rgb\(15 14 13|var\(--edge\))/)
    expect(value('elevation-xs')).not.toBe(value('elevation-sm'))
    expect(value('elevation-sm')).toBe('var(--elevation-1)')
    expect(value('elevation-md')).toBe('var(--elevation-2)')
    expect(value('elevation-lg')).toBe('var(--elevation-3)')
  })
  it('the radius ladder is 6 / 10 / 16 / full, with no stray --radius', () => {
    expect(tokens).toMatch(/--radius-overlay:\s*16px;/)
    expect(tokens).toMatch(/--radius-inline:\s*6px;/)
    expect(tokens).not.toMatch(/^\s*--radius:/m)
  })
  it('the neutral ladder steps at least 1.07:1 in both themes, and the dark desk is lighter than its paper', () => {
    const block = (selector: string) => light.slice(light.indexOf(`${selector} {`), light.indexOf('}', light.indexOf(`${selector} {`)))
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string) => {
      const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
      return (high + 0.05) / (low + 0.05)
    }
    for (const selector of [':root', '.dark']) {
      const hex = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(block(selector))?.[1] ?? ''
      for (const [a, b] of [['paper', 'desk'], ['desk', 'selected'], ['selected', 'pressed']]) {
        expect(ratio(hex(a), hex(b)), `${selector} ${a} → ${b}`).toBeGreaterThanOrEqual(1.07)
      }
      if (selector === '.dark') expect(luminance(hex('desk'))).toBeGreaterThan(luminance(hex('paper')))
      if (selector === '.dark') expect(luminance(hex('sheet'))).toBeGreaterThan(luminance(hex('selected')))
      expect(ratio(hex('sheet'), hex('selected')), `${selector} sheet → selected`).toBeGreaterThanOrEqual(1.2)
      expect(ratio(hex('paper'), hex('sheet')), `${selector} paper → sheet`).toBeGreaterThanOrEqual(1.04)
    }
  })
  it('a sheet carries the 12% edge in both themes (elevation 1 opens with it)', () => {
    for (const selector of [':root', '.dark']) {
      const at = light.indexOf(`${selector} {`)
      const block = light.slice(at, light.indexOf('}', at))
      expect(block, selector).toMatch(/--elevation-1: 0 0 0 1px var\(--edge\),/)
    }
  })
  it('a sheet is white on every surface that draws a document or a floating bar', () => {
    const tile = files.find((f) => f.name === 'ui/features/documents/components/file-tile.tsx')?.text ?? ''
    expect(tile).toMatch(/bg-sheet shadow-sm/)
    expect(files.find((f) => f.name === 'ui/features/documents/components/folder-card-frame.tsx')?.text).toMatch(/FOLDER_SHEET = 'rounded-surface bg-sheet shadow-sm'/)
    expect(files.find((f) => f.name === 'ui/components/ui/inspector-group.tsx')?.text).toMatch(/'bg-sheet shadow-sm overflow-hidden rounded-surface'/)
    for (const name of ['ui/features/documents/components/selection-bar.tsx']) {
      expect(files.find((f) => f.name === name)?.text, name).toMatch(/bg-sheet shadow-md rounded-overlay/)
    }
  })
})

describe('the secondary press', () => {
  it('the kit draws secondary as the raised white press', () => {
    const kit = withoutComments(files.find((f) => f.name === 'ui/components/ui/button.tsx')?.text ?? '')
    expect(kit).toMatch(/secondary:\s*'bg-sheet text-foreground shadow-press hover:bg-sheet-hover active:bg-pressed /)
    expect(kit).not.toMatch(/in-data-\[surface=sunken\]/)
  })
  it('Dateien and the E-Mail-Eingang set no outline button', () => {
    const offenders = files
      .filter((f) => f.name.startsWith('ui/features/documents/') || f.name.startsWith('ui/features/inbound-mail/'))
      .filter((f) => /variant=["{][^>]*?\boutline\b/.test(withoutComments(f.text)) && /<Button|<BusyButton/.test(f.text))
      .filter((f) => /\bvariant=("outline"|\{[^}]*'outline'[^}]*\})/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

const DATEIEN_SURFACE = [
  'ui/features/inbound-mail/',
  'ui/components/shell/project-section-frame.tsx',
  'ui/components/shell/section-nav.tsx',
  ...[
    'file-browser-pane', 'file-workspace', 'folder-navigation', 'folder-card-frame', 'file-card', 'file-tile', 'file-grid', 'file-list-view',
    'folder-brief', 'files-header-controls', 'selection-bar', 'open-marks-chip', 'phone-root-tools',
    'file-preview-pane-details', 'page-readings', 'folder-read-state', 'file-name', 'file-preview-reader',
    'file-preview-pane-chrome', 'file-search-bar', 'folder-bin-panel', 'open-points/open-points-panel',
    'agent-reading', 'semantic-match', 'review/mark-row',
  ].map((name) => `ui/features/documents/components/${name}.tsx`),
]

describe('lines for lists, space for sections', () => {
  const HEADER_BAND = /export const SECTION_HEADER_CLASS = '[^']*'/
  it('Dateien and the E-Mail-Eingang draw no rule between sections (a list\u2019s rows use ROW_HAIRLINE)', () => {
    const offenders = files
      .filter((f) => DATEIEN_SURFACE.some((path) => f.name.startsWith(path)))
      .filter((f) => /(?<![\w:-])(border-[tb]|divide-y|border-dashed)(?![\w-])/.test(withoutComments(f.text).replace(HEADER_BAND, '')))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
  it('the header band ends in one rule', () => {
    const frame = files.find((f) => f.name === 'ui/components/shell/project-section-frame.tsx')?.text ?? ''
    expect(frame.match(HEADER_BAND)?.[0]).toMatch(/\bborder-b border-border\b/)
  })
  it('the hairline is the token, and the Papierkorb, Offene Punkte and the mail list wear it', () => {
    expect(files.find((f) => f.name === 'ui/components/ui/row-hairline.ts')?.text).toMatch(/after:bg-hairline/)
    for (const name of [
      'ui/features/documents/components/folder-bin-panel.tsx',
      'ui/features/documents/components/open-points/open-points-panel.tsx',
    ]) {
      expect(files.find((f) => f.name === name)?.text, name).toContain('ROW_HAIRLINE')
    }
    expect(files.find((f) => f.name === 'ui/features/inbound-mail/components/inbound-mail-row.tsx')?.text).toContain('ROW_HAIRLINE')
  })
  it('one inset rule: every row line in Dateien is ROW_HAIRLINE or its table form, never a hairline of its own', () => {
    const lists = [...DATEIEN_SURFACE, 'ui/features/inbound-mail/components/attachment-row.tsx']
    const ownLines = files
      .filter((f) => lists.some((path) => f.name.startsWith(path)))
      .filter((f) => /after:bg-hairline|linear-gradient\(var\(--hairline\)/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(ownLines).toEqual([])
    for (const name of [
      'ui/features/inbound-mail/components/inbound-mail-row.tsx',
      'ui/features/inbound-mail/components/attachment-row.tsx',
      'ui/features/documents/components/folder-table-row.tsx',
      'ui/features/documents/components/file-list-view.tsx',
    ]) {
      expect(files.find((f) => f.name === name)?.text, name).toMatch(/ROW_HAIRLINE/)
    }
  })
  it('Dateien names its planes: no „one grey“ fill (bg-muted, bg-secondary) where a desk, a sheet or a selection is meant', () => {
    const surfaces = [
      ...DATEIEN_SURFACE,
      ...['document-kind-thumbnail', 'file-preview-pane-document', 'file-text-page'].map((name) => `ui/features/documents/components/${name}.tsx`),
      'ui/components/ui/inspector-group.tsx',
    ]
    const offenders = files
      .filter((f) => surfaces.some((path) => f.name.startsWith(path)))
      .filter((f) => /(?<![\w:-])bg-(muted|secondary)(?![\w-])/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

describe('one left edge', () => {
  const read = (component: string): string => files.find((f) => f.name === `ui/features/documents/components/${component}.tsx`)?.text ?? ''
  it('the file grid bleeds by the tile shell’s inset', () => {
    const shell = read('file-tile').match(/rounded-surface p-(\d(?:\.\d)?)/)?.[1]
    const listingBleed = read('file-grid').match(/items-stretch[^']*? -mx-(\d(?:\.\d)?)/)?.[1]
    expect(shell).toBeDefined()
    expect(listingBleed).toBe(shell)
  })
  it('the file list bleeds by its cells’ inset on a desk', () => {
    const list = read('file-list-view')
    const cell = (files.find((f) => f.name === 'ui/features/documents/components/file-list-layout.ts')?.text ?? '').match(/export const FILE_LIST_CELL = 'px-(\d(?:\.\d)?)/)?.[1]
    const bleed = list.match(/@container\/filelist px-\d pb-4 pt-1 md:-mx-(\d(?:\.\d)?) md:px-0/)?.[1]
    expect(cell).toBeDefined()
    expect(bleed).toBe(cell)
  })
})

const AFFORDANCE_SURFACE = [
  ...DATEIEN_SURFACE,
  ...[
    'file-filter-menu', 'assign-popover', 'upload-tray', 'filing-bar', 'filing-suggestion', 'held-upload-decision',
    'revision-notices', 'document-actions/document-actions-menu', 'mail-thread/',
  ].map((name) => `ui/features/documents/components/${name}${name.endsWith('/') ? '' : '.tsx'}`),
]

function openingTags(text: string, names: readonly string[]): { tag: string; at: number }[] {
  const tags: { tag: string; at: number }[] = []
  const start = new RegExp(`<(${names.join('|')})(?=[\\s>/])`, 'g')
  for (const match of text.matchAll(start)) {
    let depth = 0
    let quote: string | null = null
    for (let i = match.index + match[0].length; i < text.length; i += 1) {
      const c = text[i]
      if (quote) {
        if (c === quote && text[i - 1] !== '\\') quote = null
      } else if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) {
        tags.push({ tag: text.slice(match.index, i + 1), at: i + 1 })
        break
      }
    }
  }
  return tags
}

function pressKey(tag: string, children: string): string {
  const testId = (tag + children).match(/data-testid=(?:"([^"]+)"|\{`([^`$]+))/)
  if (testId) return testId[1] ?? testId[2]
  return (tag + children).match(/\bt[a-zA-Z]*\('([^']+)'/)?.[1] ?? 'unnamed'
}

const WORD_GHOSTS_ALLOWED: Record<string, string> = {
  'ui/features/documents/components/files-header-controls.tsx#files-open-points': 'navigation: a place, when no tabs show it',
  'ui/features/documents/components/files-header-controls.tsx#files-inbound-mail': 'navigation: a place, when no tabs show it',
  'ui/features/inbound-mail/components/inbound-mail-workspace.tsx#inbound-mail-back': 'navigation: the way back to the list',
  'ui/features/documents/components/file-filter-menu.tsx#file-filter-direction': 'a menu row: it flips the order the row above chose',
  'ui/features/inbound-mail/components/mail-text.tsx#text.showLess': 'disclosure: it shows the rest of the mail already there',
  'ui/features/inbound-mail/components/mail-text.tsx#text.hideQuoted': 'disclosure: it shows the quoted mail already there',
  'ui/features/documents/components/selection-bar.tsx#selection-all': 'it refines the pick beside the bar’s one action, the move',
  'ui/features/documents/components/upload-tray.tsx#uploads.actions.cancelAll': 'the tray’s way out, on the headline’s row: as a press it took a row of its own on a phone',
}

describe('a press looks pressable', () => {
  const surface = files.filter((f) => AFFORDANCE_SURFACE.some((path) => f.name.startsWith(path)))
  const wordGhosts = surface.flatMap((f) => {
    const text = withoutComments(f.text)
    return openingTags(text, ['Button', 'BusyButton', 'SuggestionButton'])
      .filter(({ tag }) => /\bvariant=("(ghost|link)"|\{[^}]*'(ghost|link)')/.test(tag) && !/\bsize=("icon|\{[^}]*'icon)/.test(tag))
      .map(({ tag, at }) => `${f.name}#${pressKey(tag, text.slice(at, at + 400).split(/<\/(?:Busy|Suggestion)?Button>/)[0])}`)
  })
  it('a worded press on Dateien, the preview and the brief is tonal unless the allowlist says why not', () => {
    expect(wordGhosts.filter((key) => !(key in WORD_GHOSTS_ALLOWED))).toEqual([])
  })
  it('the allowlist has no stale entry', () => {
    expect(Object.keys(WORD_GHOSTS_ALLOWED).filter((key) => !wordGhosts.includes(key))).toEqual([])
  })
})

describe('a choice sits on its track', () => {
  it('the kit draws the track and has no trackless form', () => {
    const kit = withoutComments(files.find((f) => f.name === 'ui/components/ui/toggle-group.tsx')?.text ?? '')
    expect(kit).toMatch(/rounded-control bg-desk p-0\.5/)
    expect(kit).not.toMatch(/\bbare\b/)
    expect(files.find((f) => f.name === 'ui/components/shell/section-nav.tsx')?.text).toMatch(/rounded-control bg-desk p-0\.5/)
  })
  it('Dateien’s tabs sit on the same track, so grey alone means a press and never „chosen“', () => {
    const frame = withoutComments(files.find((f) => f.name === 'ui/components/shell/project-section-frame.tsx')?.text ?? '')
    expect(openingTags(frame, ['SectionNav']).map(({ tag }) => /\btrack\b/.test(tag))).toEqual([true])
  })
  it('every single choice on Dateien, the preview and the brief is segmented', () => {
    const offenders = files
      .filter((f) => AFFORDANCE_SURFACE.some((path) => f.name.startsWith(path)))
      .filter((f) => openingTags(withoutComments(f.text), ['ToggleGroup']).some(({ tag }) => /type="single"/.test(tag) && !/\bsegmented\b/.test(tag)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

describe('one ramp, one scale', () => {
  const surface = files.filter((f) => DATEIEN_SURFACE.some((path) => f.name.startsWith(path)))
  const offending = (pattern: RegExp) => surface.filter((f) => pattern.test(withoutComments(f.text))).map((f) => f.name)
  it('text is the ramp: 11px codes and counts, 12px meta, 13px names, 14px body, 16px fields, 18px a mail subject', () => {
    expect(offending(/(?<![\w-])text-\[(?!13px\]|11px\])[0-9.]+(px|rem)\]/)).toEqual([])
    expect(offending(/(?<![\w-])text-(xl|2xl|3xl)(?![\w-])/)).toEqual([])
  })
  it('line heights are the named steps, never a typed ratio', () => {
    expect(offending(/(?<![\w-])leading-\[/)).toEqual([])
  })
  it('a radius is a step of the app ladder by its name (inline, control, surface, overlay, full)', () => {
    expect(offending(/(?<![\w:\[-])rounded(-(sm|md|lg|xl))?(?=[\s"'`])/)).toEqual([])
  })
  it('a press is the kit\u2019s 32px (`size="sm"`), never a 28px override', () => {
    expect(offending(/(?<![\w-])h-7(?![\w-])/)).toEqual([])
  })
  it('an empty state is bare, never the kit\u2019s dashed grey panel', () => {
    const offenders = surface
      .filter((f) => [...withoutComments(f.text).matchAll(/<EmptyState\b[\s\S]*?(?:\/>|\n\s*>)/g)].some(([tag]) => !/variant="bare"/.test(tag)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
  it('a listing is the shared container, never a typed 1280px', () => {
    expect(offending(/max-w-\[1280px\]/)).toEqual([])
  })
})

describe('the agent\u2019s disc', () => {
  const CLAIMS_A_SUGGESTION = new Set(['ui/features/inbound-mail/components/attachment-row.tsx'])
  it('Dateien and the E-Mail-Eingang draw it only where it marks a suggestion', () => {
    const offenders = files
      .filter((f) => DATEIEN_SURFACE.some((path) => f.name.startsWith(path)))
      .filter((f) => /\bAgentGlyph\b/.test(withoutComments(f.text)) && !CLAIMS_A_SUGGESTION.has(f.name))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

describe('one separator', () => {
  const UNBOUND_IN_CODE = /' · '|" · "|` · |> · |\{' · '\}/
  it('Dateien and the E-Mail-Eingang join clauses with the bound separator, never a bare „ · “', () => {
    const offenders = files
      .filter((f) => DATEIEN_SURFACE.some((path) => f.name.startsWith(path)))
      .filter((f) => UNBOUND_IN_CODE.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
  it('the E-Mail-Eingang’s copy binds every middot to the clause before it', () => {
    const offenders = ['de', 'en'].flatMap((locale) =>
      withoutComments(readFileSync(join(ROOT, 'i18n', 'dictionaries', locale, 'inbound-mail.ts'), 'utf8'))
        .split('\n')
        .filter((line) => line.includes(' · '))
        .map((line) => `${locale}: ${line.trim()}`)
    )
    expect(offenders).toEqual([])
  })
})

describe('one size for a segmented control', () => {
  it('every worded segmented group in Dateien is 14px', () => {
    const offenders = files
      .filter((f) => DATEIEN_SURFACE.some((path) => f.name.startsWith(path)))
      .filter((f) =>
        openingTags(withoutComments(f.text), ['ToggleGroup']).some(
          ({ tag }) => /\bsegmented\b/.test(tag) && !/size="icon/.test(tag) && !/\[&>button\]:text-sm/.test(tag)
        )
      )
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

describe('a folder row in the table’s columns', () => {
  const read = (component: string): string => source(`ui/features/documents/components/${component}.tsx`)
  it('the folders are the table’s first rows, in the size and date columns’ own cells', () => {
    const list = read('file-list-view')
    expect(list).toMatch(/<TableBody ref=\{bodyRef\}>\s*\{folderRows\}\s*\{rows\.map\(/)
    const row = read('folder-table-row')
    expect(row).toMatch(/<TableRow\b/)
    expect(row).toMatch(/<TableCell className=\{cn\(FILE_LIST_SIZE_CELL, FILE_LIST_CELL\)\}>\{count\}<\/TableCell>/)
    expect(row).toMatch(/<TableCell className=\{cn\(FILE_LIST_DATE_CELL, FILE_LIST_CELL\)\}>/)
    expect(read('file-browser-pane')).not.toMatch(/<FolderRow\b[^>]*\/>\s*<\/div>/)
  })
  it('dates left-align with their head, numbers right-align with theirs', () => {
    const list = read('file-list-view')
    const layout = source('ui/features/documents/components/file-list-layout.ts')
    expect(layout).toMatch(/export const FILE_LIST_DATE_CELL = 'hidden whitespace-nowrap text-left /)
    expect(layout).toMatch(/export const FILE_LIST_SIZE_CELL = 'hidden whitespace-nowrap text-right /)
    expect(list).not.toMatch(/column="added"\s+sort=\{sort\}\s+onSort=\{setSort\}\s+align="right"/)
  })
  it('every row is 40px: a chip in a name line is 20px, the actions cell holds its 32px trigger in 40', () => {
    const list = read('file-list-view')
    expect(list).toMatch(/<DocumentStatusBadge [^>]*className="h-5 /)
    expect(list).toMatch(/className="w-10 px-1 py-1 text-right pointer-coarse:w-11 pointer-coarse:px-0"/)
    expect(read('folder-table-row')).toMatch(/className="w-10 px-1 py-1 text-right pointer-coarse:w-11 pointer-coarse:px-0"/)
  })
})

describe('said once per view', () => {
  it('the preview header draws no format box and no type chip', () => {
    const chrome = withoutComments(files.find((f) => f.name === 'ui/features/documents/components/file-preview-pane-chrome.tsx')?.text ?? '')
    expect(chrome).not.toMatch(/<FileExtChip\b/)
    expect(chrome).not.toMatch(/\btagLabel\(/)
  })
})

const source = (name: string): string => withoutComments(files.find((f) => f.name === name)?.text ?? '')

describe('press, thumb and sheet', () => {
  const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
  it('the press rests on its edge alone and fills one step under the pointer', () => {
    expect(tokens).toMatch(/--elevation-press: 0 0 0 1px var\(--edge\);/)
    expect(tokens).toMatch(/--shadow-press: var\(--elevation-press\);/)
    expect(source('ui/components/ui/button.tsx')).toMatch(/secondary:\s*'bg-sheet text-foreground shadow-press hover:bg-sheet-hover active:bg-pressed dark:/)
  })
  it('in dark only a sheet or a thumb is lighter than its plane: a press is its plane’s fill with the 16% edge', () => {
    expect(source('ui/components/ui/button.tsx')).toMatch(/secondary:\s*'[^']*dark:bg-transparent dark:hover:bg-hover dark:active:bg-foreground\/\[0\.1\]/)
  })
  it('a chip is never the press’s shape: a 28px pill of the desk, no edge; picked, the selected grey and a tick', () => {
    const toggle = source('ui/components/ui/toggle.tsx')
    const chip = toggle.match(/chip: '([^']*)'/)?.[1] ?? ''
    expect(chip).toMatch(/^rounded-full bg-desk /)
    expect(chip).toMatch(/data-\[state=on\]:bg-selected/)
    expect(chip).not.toMatch(/shadow|bg-sheet|border/)
    expect(toggle).toMatch(/variant: 'chip',\s*className:\s*'relative h-7 /)
    const panel = source('ui/features/documents/components/open-points/open-points-panel.tsx')
    expect(panel).toMatch(/<ToggleGroupItem value=\{ALL_CHIP\}/)
  })
  it('the thumb is white with the 1px shadow, and only ever on a track', () => {
    const group = source('ui/components/ui/toggle-group.tsx')
    expect(group).toMatch(/default: 'bg-sheet shadow-thumb'/)
    expect(group).toMatch(/const isActive =\s*context\.segmented &&/)
    expect(source('ui/components/shell/section-nav.tsx')).toMatch(/onTrack \? 'bg-sheet shadow-thumb' : 'bg-selected'/)
  })
  it('the thumb has an edge at 3:1 against its track in dark, where its fill stands only 1.2:1 above it', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    const dark = tokens.slice(tokens.lastIndexOf('.dark {'))
    expect(dark).toMatch(/--elevation-thumb: 0 0 0 1px var\(--field-border\)/)
    const hex = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(dark)?.[1] ?? '#000000'
    const luminance = (value: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    expect((luminance(hex('field-border')) + 0.05) / (luminance(hex('desk')) + 0.05)).toBeGreaterThanOrEqual(3)
  })
  it('a folder is a sheet that opens: 56px, radius 10, elevation 1, a chevron at its end', () => {
    expect(source('ui/features/documents/components/folder-card-frame.tsx')).toMatch(/FOLDER_SHEET = 'rounded-surface bg-sheet shadow-sm'/)
    const tile = source('ui/features/documents/components/folder-navigation.tsx')
    expect(tile).toMatch(/<FileTileBody className="flex h-14 /)
    expect(tile).toMatch(/<FolderName text=\{folder\.name\}/)
    expect(tile).toMatch(/<ChevronRight[^>]*data-slot="folder-opens"/)
  })
  it('Dateien draws neither look itself: no shadow-xs or shadow-press outside the kit, no fill over a press', () => {
    const surface = files
      .filter((f) => AFFORDANCE_SURFACE.some((path) => f.name.startsWith(path)) || f.name.startsWith('ui/features/inbound-mail/'))
      .filter((f) => !f.name.startsWith('ui/components/')) // the kit draws them: the press, the thumb (`section-nav`)
    const looks = surface.filter((f) => /(?<![\w:-])shadow-(xs|press)(?![\w-])/.test(withoutComments(f.text))).map((f) => f.name)
    expect(looks).toEqual([])
    const filled = surface
      .filter((f) =>
        openingTags(withoutComments(f.text), ['Button', 'BusyButton']).some(
          ({ tag }) => /variant="secondary"/.test(tag) && /className="[^"]*(?<![\w:-])bg-(?!sheet\b)[a-z]/.test(tag)
        )
      )
      .map((f) => f.name)
    expect(filled).toEqual([])
  })
})

describe('colour is a verdict', () => {
  it('Offene Punkte rings its points by verdict: ink, ochre only for the reader’s or an overdue one', () => {
    expect(source('ui/features/documents/components/open-points/open-points-panel.tsx')).toMatch(/<MarkRowContent[^>]*marker="verdict"/)
    const row = source('ui/features/documents/components/review/mark-row.tsx')
    expect(row).toMatch(/const VERDICT_RING = \{ ink: 'var\(--foreground\)', needsYou: 'var\(--text-color-feedback-warning\)' \} as const/)
    expect(row).toMatch(/marker === 'verdict' && 'bg-sheet text-foreground shadow-none', marker === 'verdict' && !needsReader && 'border-\[1\.5px\]'/)
    expect(row).toMatch(/const needsReader = isLive\(annotation\) && \(overdue \|\| isForReader\(annotation, viewerId\)\)/)
  })
  it('a mention of the reader in a mark wins by weight on the desk, not by ochre', () => {
    expect(source('ui/features/documents/components/review/mark-body.tsx')).toMatch(/meTone="ink"/)
    expect(source('ui/features/collaboration/components/MentionText.tsx')).toMatch(/meTone === 'ink'\s*\?\s*'bg-desk text-foreground font-semibold'/)
  })
  it('a face in Dateien is no hue: the preview’s and the list’s assignees are neutral', () => {
    expect(source('ui/features/documents/components/assignment-faces.tsx')).toMatch(/<AvatarStack[^>]*tone="neutral"/)
  })
  it('the brief says what needs the reader with a glyph, never a bare dot', () => {
    const brief = source('ui/features/documents/components/folder-brief.tsx')
    expect(brief).toMatch(/<AttentionGlyph tone=\{tone\}\s*\/>/)
    expect(brief.match(/<ToneSwatch\b/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })
})

describe('one primary per area', () => {
  it('the reader’s primary yields while a batch is picked', () => {
    const bar = source('ui/features/inbound-mail/components/decision-bar.tsx')
    expect(bar).toMatch(/variant=\{impersonation \|\| yieldPrimary \? 'secondary' : 'default'\}/)
    expect(bar).toMatch(/variant=\{impersonation && !yieldPrimary \? 'default' : 'secondary'\}/)
    expect(source('ui/features/inbound-mail/components/inbound-mail-workspace.tsx')).toMatch(/yieldPrimary=\{selectedIds\.length > 0\}/)
  })
  it('the reader’s primary is the verb, and the sentence beside it says what one press files', () => {
    const bar = source('ui/features/inbound-mail/components/decision-bar.tsx')
    expect(bar).toMatch(/\{onlyDismiss \? t\('bar\.dismiss'\) : t\('bar\.file'\)\}/)
    expect(bar).toMatch(/aria-describedby=\{onlyDismiss \? undefined : summaryId\}/)
  })
})

describe('rows, weights and the phone', () => {
  it('a list row is a name and one meta line: the Papierkorb says the rest once, in a second line only on a phone', () => {
    const bin = source('ui/features/documents/components/folder-bin-panel.tsx')
    const descriptions = [...bin.matchAll(/<ItemDescription (?:key=\{index\} )?className="([^"]*)"/g)].map(([, classes]) => classes)
    expect(descriptions.filter((classes) => !/(?<![\w-])sm:hidden\b/.test(classes))).toHaveLength(1)
    expect(bin).toMatch(/variant="secondary"\s+size="sm"\s+className=\{RESTORE_PRESS\}/)
    expect(bin).toMatch(/const RESTORE_PRESS =\s*'pointer-coarse:size-11 pointer-coarse:px-0 pointer-fine:w-8 /)
    expect(bin).toMatch(/<span className="sr-only pointer-fine:group-hover\/row:not-sr-only pointer-fine:group-focus-within\/row:not-sr-only">\{t\('bin\.restore'\)\}<\/span>/)
    expect(bin).toMatch(/<ul className="-mx-4 flex max-w-\[calc\(880px\+2rem\)\] flex-col">/)
    expect(bin).toMatch(/meta\.phone\.map\(\(line, index\) => \(\s*<ItemDescription key=\{index\} className="text-meta truncate first-letter:uppercase sm:hidden"/)
    expect(bin).toMatch(/group\/row items-center gap-3 rounded-surface py-2\.5 /)
    expect(source('ui/features/inbound-mail/components/inbound-mail-row.tsx')).toMatch(/'group\/row items-start rounded-control px-3 py-2\.5 /)
    expect(source('ui/features/documents/components/review/mark-row.tsx')).toMatch(/'flex w-full gap-3 rounded-control px-2\.5 py-2\.5 /)
  })
  it('a mail subject’s weight is its state: 600 needs the reader, 500 waits on a press, 440 is handled', () => {
    expect(source('ui/features/inbound-mail/components/inbound-mail-row.tsx')).toMatch(
      /needsReader \? 'text-foreground font-semibold' : waiting \? 'text-foreground font-medium' : 'text-foreground font-normal'/
    )
    expect(source('ui/features/inbound-mail/components/inbound-mail-row.tsx')).toMatch(/line-clamp-2 text-name text-pretty/)
  })
  it('a thread’s press sits in a 40px line with 8px under it, so it never touches the open row’s sheet', () => {
    expect(source('ui/features/inbound-mail/components/inbound-mail-list.tsx')).toMatch(/className="box-content flex h-10 items-center justify-between gap-2 px-4 pb-2 pointer-coarse:h-11"/)
  })
  it('the reader’s foot says what one press files only once the choice it repeats has scrolled away', () => {
    const bar = source('ui/features/inbound-mail/components/decision-bar.tsx')
    expect(bar).toMatch(/choiceInView && 'hidden'/)
    expect(bar).toMatch(/\{!onlyDismiss && !\(yieldPrimary && !impersonation\) && \(/)
    expect(source('ui/features/inbound-mail/components/inbound-mail-detail.tsx')).toMatch(/<section ref=\{choiceRef\}/)
    expect(source('ui/features/inbound-mail/components/sender-trust.tsx')).toMatch(/min-w-0 max-w-\[64ch\]/)
  })
  it('an empty state’s headline is the section step, and a string to copy is mono 13/20/440', () => {
    expect(source('ui/components/ui/empty-state.tsx')).toMatch(/<p className="text-balance text-section text-foreground">\{title\}<\/p>/)
    const address = source('ui/features/inbound-mail/components/inbound-mail-address.tsx')
    expect(address.match(/font-mono text-\[13px\] leading-5 font-normal/g)?.length ?? 0).toBe(2)
    expect(address).not.toMatch(/font-mono text-sm/)
  })
  it('a field is white with the 3:1 field border, never a desk well', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    expect(tokens).toMatch(/--field-border: #8a8784;/)
    expect(source('ui/features/documents/components/file-search-bar.tsx')).toMatch(/inputClassName="[^"]*border-field-border bg-sheet /)
  })
  it('on a phone a folder is a 56px sheet in two columns with its ⋯, and Hochladen a 56px glyph', () => {
    const tile = source('ui/features/documents/components/folder-navigation.tsx')
    expect(tile).not.toMatch(/FOLDER_ROWS_ON_PHONE/)
    expect(tile).toMatch(/phone:gap-2\.5 phone:pr-10/)
    expect(tile).toMatch(/absolute right-8 top-1\/2 z-\[1\] -translate-y-1\/2 phone:right-1\.5 pointer-coarse:opacity-100/)
    expect(source('ui/features/documents/components/upload-fab.tsx')).toMatch(/\[&_button\]:size-14 \[&_button\]:rounded-full/)
    expect(source('ui/features/documents/components/file-workspace.tsx')).toMatch(/glyphOnly: true/)
  })
  it('Offene Punkte keeps its text to a measure and stands who and by when on the column’s edge', () => {
    expect(source('ui/features/documents/components/open-points/open-points-panel.tsx')).toMatch(/<MarkRowContent[^>]*\bcolumns\b/)
    const row = source('ui/features/documents/components/review/mark-row.tsx')
    expect(row).toMatch(/columns && 'max-w-\[720px\]'/)
    expect(row).toMatch(/text-muted-foreground ml-auto hidden shrink-0 items-start gap-4/)
  })
  it('the places stand clear of the title: 24px under the title block, 16px on a phone', () => {
    expect(source('ui/components/shell/project-section-frame.tsx')).toMatch(/'-mb-2 mt-6 min-w-0 phone:mt-4'/)
  })
  it('on a phone the tabs name only the open place, and a page’s one ⋯ stands on the title’s line', () => {
    expect(source('ui/components/shell/project-section-frame.tsx')).toMatch(/track\s+compactOnPhone/)
    for (const name of ['ui/features/inbound-mail/components/inbound-mail-workspace.tsx', 'ui/features/documents/components/open-points/open-points-panel.tsx']) {
      expect(source(name), name).toMatch(/<ProjectSectionActions onTitleLine>/)
    }
  })
  it('the brief’s sheet stands on the column’s edge, its content 16px in, on a phone too', () => {
    const brief = source('ui/features/documents/components/folder-brief.tsx')
    const card = openingTags(brief, ['Card'])[0]?.tag ?? ''
    expect(card).not.toMatch(/-mx-|rounded-none/)
  })
  it('the preview’s title is the section step and its page lies at elevation 2 on the desk', () => {
    expect(source('ui/features/documents/components/file-preview-pane-chrome.tsx')).toMatch(/className="text-foreground truncate text-section"/)
    for (const name of ['ui/features/documents/components/file-preview-pane-document.tsx', 'ui/features/documents/components/file-text-page.tsx']) {
      expect(source(name), name).not.toMatch(/'shadow-lg'/)
    }
    expect(source('ui/features/documents/components/file-preview-pane-body.tsx')).toMatch(/!peeking && !reader && 'bg-desk'/)
  })
  it('the label step is 12/16/500 (`SectionLabel`, the card eyebrow)', () => {
    const globals = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
    expect(withoutComments(globals)).toMatch(/\.card-eyebrow \{\s*font-size: 12px;\s*line-height: 16px;\s*font-weight: 500;/)
  })
})

describe('a sheet keeps its edge', () => {
  it('nothing between the file card and its thumbnail sheet clips', () => {
    const card = withoutComments(readFileSync(join(ROOT, 'ui/features/documents/components/file-card.tsx'), 'utf8'))
    const button = card.match(/className=\{cn\("group relative flex w-full min-w-0 flex-col[^"]*"/)?.[0] ?? ''
    expect(button, 'the card button').toContain('overflow-visible')
    expect(button).not.toContain('overflow-hidden')
    expect(card).toMatch(/<FileTileBody className=\{cn\('overflow-visible p-0'/)
  })
})

describe('a sheet keeps its edge on a filled section', () => {
  it('the fill frame leaves 1px above its content for a sheet ring', () => {
    const frame = withoutComments(readFileSync(join(ROOT, 'ui/components/shell/project-section-frame.tsx'), 'utf8'))
    expect(frame).toContain("fill ? 'overflow-hidden pt-px'")
  })
})

describe('the row ⋯ hides nothing', () => {
  it('the object menu trigger beside a name has no disc that would cover the line under it', () => {
    const menu = withoutComments(readFileSync(join(ROOT, 'ui/features/documents/components/document-actions/document-object-menu.tsx'), 'utf8'))
    expect(menu).toContain("className: 'size-8 shrink-0 rounded-full',")
    expect(menu).not.toMatch(/bg-background\/\d+ backdrop-blur/)
  })
})

describe('Dateien in a real project (round 6)', () => {
  const doc = (component: string): string => source(`ui/features/documents/components/${component}.tsx`)

  it('draws no upload tile among the files: Hochladen and the whole page take files, its menu says so', () => {
    expect(doc('file-browser-pane')).not.toMatch(/uploadCard/)
    expect(doc('project-uppy-upload')).not.toMatch(/dropcard/)
    expect(doc('project-uppy-upload')).toMatch(/data-testid="project-upload-limits"/)
  })

  it('lays the upload tray on the listing’s column as a sheet, not a band across the page', () => {
    expect(doc('file-workspace')).toMatch(/<div className="listing-container shrink-0 px-4 md:px-8">\s*<UploadTray[\s\S]*?className=\{UPLOAD_TRAY_SHEET\}/)
    expect(readFileSync(join(ROOT, 'ui/features/documents/components/upload-tray-sheet.ts'), 'utf8')).toMatch(/UPLOAD_TRAY_SHEET = '[^']*\bbg-sheet shadow-sm\b/)
  })

  it('never cuts the selection’s count, and lets the brief’s line wrap rather than cut', () => {
    const bar = doc('selection-bar')
    expect(bar).toMatch(/className="whitespace-nowrap text-sm font-medium tabular-nums"/)
    expect(bar).not.toMatch(/phone:sr-only/)
    expect(bar).toMatch(/variant="link"[\s\S]{0,400}data-testid="selection-all"/)
    expect(bar).not.toMatch(/selection-count[\s\S]{0,40}truncate|truncate[^"]*"\s*role="status"/)
    expect(doc('folder-brief')).not.toMatch(/folder-brief-toggle[\s\S]{0,900}?\btruncate\b/)
  })

  it('lets the upload tray’s summary wrap rather than cut', () => {
    expect(doc('upload-tray')).toMatch(/aria-live="polite" className="text-pretty text-sm font-medium/)
  })

  it('floats the selection’s bar on the column’s edges, centred only where the column is', () => {
    expect(doc('selection-bar')).toMatch(/md:mx-8 md:max-w-\[1216px\] @min-\[90rem\]\/section:mx-auto!/)
  })

  it('gives the places their room on a narrow section: every place keeps its name, a narrow one gives up its glyph', () => {
    const nav = source('ui/components/shell/section-nav.tsx')
    expect(nav).toMatch(/compactOnPhone && !active && 'phone:sr-only'\)/)
    expect(nav).toMatch(/onTrack && 'md:@max-\[44rem\]\/section:hidden'/)
  })
})

describe('Dateien after the review of 2026-11-10 (round 7)', () => {
  const doc = (component: string): string => source(`ui/features/documents/components/${component}.tsx`)

  it('stands every meta line of a row on one baseline: the tiles stretch and the meta line keeps the foot', () => {
    const card = doc('file-card')
    expect(card).not.toMatch(/group\/foot mt-0/)
    expect(source('ui/features/documents/components/file-tile.tsx')).toMatch(/text-muted-foreground mt-auto flex w-full/)
    expect(card).toMatch(/documentBadgeState\(\{ versionState: file\.versionState/)
  })

  it('gives the brief’s read line 24px over it and 32px under it, and the upload sheet 24px over it', () => {
    expect(doc('file-browser-pane')).toMatch(/className=\{`\$\{CONTENT_MAX\} px-4 pb-4 pt-6`\}/)
    expect(readFileSync(join(ROOT, 'ui/features/documents/components/upload-tray-sheet.ts'), 'utf8')).toMatch(/UPLOAD_TRAY_SHEET = 'mt-2 mb-4 /)
  })

  it('draws a request that asks the reader as an edged ink chip, never in a verdict’s colour', () => {
    const chip = source('ui/components/ui/asks-you-chip.tsx')
    expect(chip).toMatch(/'bg-sheet shadow-press text-foreground [^']*h-7 [^']*rounded-full/)
    expect(chip).not.toMatch(/ochre|warning|destructive|signal/)
    expect(doc('folder-brief')).toMatch(/<AsksYouChip onPress=\{\(\) => onCollapsedChange\(false\)\}/)
  })

  it('keeps „Alle abbrechen“ on the upload tray’s headline row while it sends', () => {
    expect(doc('upload-tray')).toMatch(/summary\.isSettled \? 'order-3 basis-full sm:order-2 sm:basis-auto' : 'order-2'/)
  })
})
