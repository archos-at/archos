// @disk-inputs: app/**, ui/**, shared/**, i18n/dictionaries/**
/**
 * The brand rules the workspace keeps at its own level (docs/design/design-language.md,
 * "Paper on a desk", then "Type ramp" and "Weight and white"): nothing but the wordmark is set in
 * capitals, weights are 440 / 500 / 600 (never 700), the app has five neutrals and three elevations, and the
 * chart palette is typed in one file. Each rule is a ratchet: the allowlists below name
 * the few places that are exceptions on purpose, with the reason, and a new occurrence
 * anywhere else fails here instead of waiting for a reviewer's eye.
 */
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

/** Pure white on purpose: a document's own paper, and text on a collaborator's fixed hue. */
const WHITE_ALLOWED = new Set([
  'ui/components/ui/live-cursor.tsx',
  'ui/components/ui/comment-pin.tsx',
  'ui/features/knowledge/components/pdf-viewer-atoms.tsx',
  'ui/features/diagrams/components/sketch-figure.tsx',
  'ui/features/projects/components/intake-question-field.tsx',
  'ui/features/documents/components/review/review-page-layer.tsx', // the pointer's ring on the page
  'ui/features/diagrams/components/mermaid-diagram.tsx', // a comment recalling the old white
])

/** 700 on purpose: the wordmark, and a 12px numeral inside a badge. */
const BOLD_ALLOWED = new Set(['ui/components/brand/logo.tsx', 'ui/features/project-intake/components/reading/reading-milestone-card.tsx'])

describe('weight', () => {
  it('weights are 440, 500 and 600: nothing is bold or extrabold but the wordmark', () => {
    // Paper on a desk (2026-11-10): 600 is for headings and for state (an unread subject, a row that needs you),
    // so `font-semibold` is free; 700 and up stays the wordmark's.
    const offenders = files
      .filter((f) => f.name.endsWith('.tsx') || f.name.endsWith('.ts'))
      .filter((f) => /\bfont-(bold|extrabold|black)\b/.test(withoutComments(f.text)) && !BOLD_ALLOWED.has(f.name))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })

  it('the type scale names its headings at 600: section 16, pane title 20, page title 24', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    for (const [name, size] of [['section', '1rem'], ['pane-title', '1.25rem'], ['page-title', '1.5rem']]) {
      expect(tokens, name).toMatch(new RegExp(`--text-${name}:\\s*${size};`))
      expect(tokens, name).toMatch(new RegExp(`--text-${name}--font-weight:\\s*600;`))
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
    // A stylesheet reads the token, never a number at or below the old 400.
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
    // The one exception is the words on a document's own paper-ink tag.
    expect(lines.filter((line) => !line.includes('--paper-ink-foreground'))).toEqual([])
  })

  it('the browser-chrome colours are the app\u2019s paper, which is its background', () => {
    // Paper on a desk: the app's paper (#f6f5f3) sits one step under the brand's surface (#fafaf9), which was 1.04:1
    // under a white sheet. The browser's chrome is the page's own colour.
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

/**
 * Capitals set by CSS: the wordmark, and labels whose text IS a code — a file format
 * (PDF, DWG), an authority (OIB, RIS, ÖNORM), a person's initials. A label in sentence
 * case never gets `uppercase` back; its text is written the way it should read.
 */
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

/** Code without its comments, so prose that says "uppercase" is not a class. */
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
  // One size for an answer's text (Notion #38): the prose, the lede, the
  // standfirst, a block's body and a card's body and title all read
  // `--text-answer`. Headings, figures and the caption/meta/eyebrow steps keep theirs.
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
  // The design system's rule (packages/brand/README.md, "Typography"): tracking is never tighter
  // than 0; only the wordmark sets tighter. The old app ramp's `tracking-tight` on every title
  // was the previous design language's, and it went app-wide on 2026-11-06.
  it('nothing but the wordmark sets a negative letter-spacing', () => {
    const offenders = files
      .filter((f) => f.name !== 'ui/components/brand/logo.tsx')
      .filter((f) => /\btracking-tight(er)?\b|tracking-\[-|letter-spacing:\s*-/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

describe('five neutrals, three elevations', () => {
  // Paper on a desk (2026-11-10) replaces „one grey, nothing grey on grey“ inside the app: the desk is grey, the
  // working page is paper, a sheet is white, and selected and pressed are their own steps, so one fill no longer
  // means six things. The tokens are the single place the hexes are typed.
  const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
  const light = tokens.slice(tokens.indexOf('Paper on a desk (2026-11-10)'))
  it('the five neutrals are the spec\u2019s', () => {
    for (const [name, hex] of [['sheet', '#ffffff'], ['paper', '#f6f5f3'], ['desk', '#edece9'], ['selected', '#e4e2df'], ['pressed', '#d9d6d2']]) {
      expect(light, name).toContain(`--${name}: ${hex};`)
    }
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
    // Paper on a desk: two planes that must read apart differ by one neutral step at least, measured (WCAG relative
    // luminance); a sheet also carries its edge (the elevation's ring, above). The critique's 1.15:1 is met in dark
    // only: its own light neutrals step 1.08 (paper to desk), and they read apart, so the floor is the step they take.
    // The dark desk was #0a0908, 1.03:1 under its paper: the E-Mail-Eingang's list column vanished.
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
      // The open row is the lightest thing in the list column: in dark, nearness is lightness, so the open mail's sheet
      // sits above a picked row's fill (round 2 drew the picked rows lighter than the open one).
      if (selector === '.dark') expect(luminance(hex('sheet'))).toBeGreaterThan(luminance(hex('selected')))
      // Current (the open row's sheet) and picked, side by side in the mail list, step at least 1.2:1 in both themes:
      // round 3's dark pair was 1.08:1 and read as one grey.
      expect(ratio(hex('sheet'), hex('selected')), `${selector} sheet → selected`).toBeGreaterThanOrEqual(1.2)
      // A white sheet reads off the paper by its plane as well as its edge (round 2: 1.04:1, the tiles carried by the edge alone).
      expect(ratio(hex('paper'), hex('sheet')), `${selector} paper → sheet`).toBeGreaterThanOrEqual(1.07)
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
    // A folder is a sheet too, and so is a group of the preview's rail (an inspector group on the desk).
    expect(files.find((f) => f.name === 'ui/features/documents/components/folder-card-frame.tsx')?.text).toMatch(/FOLDER_SHEET = 'rounded-surface bg-sheet shadow-sm'/)
    expect(files.find((f) => f.name === 'ui/components/ui/inspector-group.tsx')?.text).toMatch(/'bg-sheet shadow-sm overflow-hidden rounded-surface'/)
    for (const name of ['ui/features/documents/components/selection-bar.tsx']) {
      expect(files.find((f) => f.name === name)?.text, name).toMatch(/bg-sheet shadow-md rounded-overlay/)
    }
  })
})

describe('the secondary press', () => {
  // Paper on a desk overrides owner decision D4: the secondary press is raised white (a white sheet with the edge
  // at 12% ink and elevation 1, desk grey on hover), not tonal. Dateien and the E-Mail-Eingang still set no outline
  // button.
  it('the kit draws secondary as the raised white press', () => {
    const kit = withoutComments(files.find((f) => f.name === 'ui/components/ui/button.tsx')?.text ?? '')
    expect(kit).toMatch(/secondary:\s*'bg-sheet text-foreground shadow-press hover:shadow-xs active:bg-pressed active:shadow-press /)
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

/** The files that draw Dateien (its listing, its tabs, the preview's rail) and the E-Mail-Eingang. */
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
  // Paper on a desk, principle 5: a page's sections are separated by 32px of space, never a rule above or below
  // a block or a dashed box; the rows of a list are separated by an inset hairline (`ROW_HAIRLINE`, ink at 8%).
  // A pinned bar over scrolling content takes the faint `shadow-pinned-foot`; a split view's pane divider is a
  // function and not matched.
  it('Dateien and the E-Mail-Eingang draw no rule between sections (a list\u2019s rows use ROW_HAIRLINE)', () => {
    const offenders = files
      .filter((f) => DATEIEN_SURFACE.some((path) => f.name.startsWith(path)))
      .filter((f) => /(?<![\w:-])(border-[tb]|divide-y|border-dashed)(?![\w-])/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
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
    // The mail list drew its own line at 84px while its text stood at 80px, and its loose mails were lists of one
    // with no line at all; the bin's line started 16px left of its names. Now the rule lives in one file and each
    // list only says where its text starts (`--row-text`, or `--row-lead` in a table).
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
    // „One look, one meaning“: the one grey stood for the track, the press, the thumbnail, the hover, the band and the
    // rail. A Dateien surface says which plane it means (`bg-desk`, `bg-sheet`, `bg-selected`, `bg-pressed`).
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
  // A tile's and a list row's inset holds only its hover fill, so the grid and the list bleed by exactly that
  // inset and the thumbnails and names stand on the column's edge, the title's (2026-11: they stood 6px and
  // 24px inside it). Change an inset and its bleed together, or the page has two left edges again.
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

/**
 * The files that draw a press in Dateien's tabs, the file preview and the folder brief: the listing's files and the
 * pieces they open inside these surfaces (the filter menu, the uploads, a filing suggestion, the preview's rail and a
 * mail document's thread).
 */
const AFFORDANCE_SURFACE = [
  ...DATEIEN_SURFACE,
  ...[
    'file-filter-menu', 'assign-popover', 'upload-tray', 'filing-bar', 'filing-suggestion', 'held-upload-decision',
    'revision-notices', 'document-actions/document-actions-menu', 'mail-thread/',
  ].map((name) => `ui/features/documents/components/${name}${name.endsWith('/') ? '' : '.tsx'}`),
]

/** Every opening tag of `<Name …>` in a file, `=>` inside an attribute's braces included. */
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

/** A press's name in the allowlist: its test id (a template's literal head, an `asChild` link's own), else the first copy key it reads. */
function pressKey(tag: string, children: string): string {
  const testId = (tag + children).match(/data-testid=(?:"([^"]+)"|\{`([^`$]+))/)
  if (testId) return testId[1] ?? testId[2]
  return (tag + children).match(/\bt[a-zA-Z]*\('([^']+)'/)?.[1] ?? 'unnamed'
}

/**
 * The presses that stay bare words, each with the one reason that keeps it ghost: navigation (it goes somewhere, as a
 * crumb or a back arrow does), a disclosure (it opens what is already there), or a row in a menu (the menu is the
 * press). Anything else that does something (creates, files, selects, filters, opens a menu of actions) is tonal.
 */
const WORD_GHOSTS_ALLOWED: Record<string, string> = {
  'ui/features/documents/components/files-header-controls.tsx#files-open-points': 'navigation: a place, when no tabs show it',
  'ui/features/documents/components/files-header-controls.tsx#files-inbound-mail': 'navigation: a place, when no tabs show it',
  'ui/features/inbound-mail/components/inbound-mail-workspace.tsx#inbound-mail-back': 'navigation: the way back to the list',
  'ui/features/documents/components/file-filter-menu.tsx#file-filter-direction': 'a menu row: it flips the order the row above chose',
  'ui/features/inbound-mail/components/mail-text.tsx#text.showLess': 'disclosure: it shows the rest of the mail already there',
  'ui/features/inbound-mail/components/mail-text.tsx#text.hideQuoted': 'disclosure: it shows the quoted mail already there',
}

describe('a press looks pressable', () => {
  // The owner's finding of 2026-11-10: rounds that optimised „reduction“ left 93 presses on these surfaces as bare
  // words, and „Als Fassung 4–6 ablegen“, „Auswählen“ or „Filter“ read as labels. A press that does something is
  // raised white (D4's tonal press was overridden by Paper on a desk); bare words are for navigation, one visible ghost action per list row,, a disclosure, or a menu row, and
  // each one that stays says why in WORD_GHOSTS_ALLOWED. An icon-only tool (`size="icon"`) is not matched: a glyph
  // in a dense row reads as a tool by its shape.
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
  // A segmented control is a track of the one grey with the chosen item on a white thumb (Apple's segmented
  // control). Its `bare` form (2026-11-06 to -10: no track, the chosen item the one grey) left the unchosen options
  // as plain text beside a filled word, so „Bearbeitet“ did not read as the other half of a choice.
  it('the kit draws the track and has no trackless form', () => {
    const kit = withoutComments(files.find((f) => f.name === 'ui/components/ui/toggle-group.tsx')?.text ?? '')
    // The track is the desk, named as the plane it is (paper on a desk), and the section's tabs share it.
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
  // The consistency pass of 2026-11: every text style, line height, radius and press height Dateien and the
  // E-Mail-Eingang use is one of a short list (design-language.md, „Surface rules“), so a new 15px heading, a
  // `leading-[1.45]` or a 28px press is caught here rather than by the next review.
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
  // The filled disc (`AgentGlyph`) claims a suggestion of the agent's and nothing else; what the agent read is
  // the brief's and the preview's one glyph. A disc beside „gelesen“ would claim a reading as a proposal.
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
  // A line's clauses are joined by `CLAUSE_JOIN` (a middot bound to the clause before it by a no-break space), so
  // a wrapped line never starts with „· bleibt bis …“ or ends in a stranded dot, and every joined line has one width
  // of space around its dot (2026-11: rows stranded dots at their wraps, and two spacings stood side by side).
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
  // Dateien's two worded segmented controls (the E-Mail-Eingang's filter, Offene Punkte's) are set at the tabs'
  // 14px; at 12px and 14px side by side the same control read as two (2026-11).
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
  // Paper on a desk, tables: the column head is the table's first row, above the folders; a folder is a row of the
  // file table (`FileListView`'s `folderRows`), its count in the Größe column's own cells and its date in the
  // Hinzugefügt column's, so it cannot end anywhere but on that column's edge. Round 2 and 3 drew the folders as a
  // block above the table: the head stood mid-table, the counts ended 10px left of Größe, the rows were 36px against
  // 40. Numbers right-align to their head, dates left-align, in every variant of the list.
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
    expect(list).toMatch(/className="w-10 px-1 py-1 text-right"/)
    expect(read('folder-table-row')).toMatch(/className="w-10 px-1 py-1 text-right"/)
  })
})

describe('said once per view', () => {
  // The preview's header says which file it is by its name and its facts line („PDF · 24 Seiten“); a format box
  // before the name and a type chip after it said „PDF“ and the rail's „Grundriss“ a second time (2026-11).
  it('the preview header draws no format box and no type chip', () => {
    const chrome = withoutComments(files.find((f) => f.name === 'ui/features/documents/components/file-preview-pane-chrome.tsx')?.text ?? '')
    expect(chrome).not.toMatch(/<FileExtChip\b/)
    expect(chrome).not.toMatch(/\btagLabel\(/)
  })
})

/** A file's source with its comments taken out, by its path under `apps/workspace`. */
const source = (name: string): string => withoutComments(files.find((f) => f.name === name)?.text ?? '')

describe('press, thumb and sheet', () => {
  // Paper on a desk, round 3: „white with an edge means you can touch it; its shape says what happens“. Round 2 drew a
  // folder, „Ordner anlegen“, the open tab and the view toggle's thumb as one white rounded box with a glyph and a
  // label. Now each has its own shape: the press is its edge and no shadow at rest (32px, radius 6), the thumb keeps
  // the 1px shadow and lives only on a track, the sheet is radius 10 at elevation 1 and says it opens (a chevron).
  const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
  it('the press rests on its edge alone and lifts under the pointer', () => {
    expect(tokens).toMatch(/--elevation-press: 0 0 0 1px var\(--edge\);/)
    expect(tokens).toMatch(/--shadow-press: var\(--elevation-press\);/)
    expect(source('ui/components/ui/button.tsx')).toMatch(/secondary:\s*'bg-sheet text-foreground shadow-press hover:shadow-xs active:bg-pressed active:shadow-press dark:/)
  })
  it('in dark only a sheet or a thumb is lighter than its plane: a press is its plane’s fill with the 16% edge', () => {
    // Round 3: the dark press took the sheet's fill, so a press, a folder sheet and a chip were one filled box.
    expect(source('ui/components/ui/button.tsx')).toMatch(/secondary:\s*'[^']*dark:bg-transparent dark:hover:bg-foreground\/\[0\.06\] dark:hover:shadow-press/)
  })
  it('a chip is never the press’s shape: a 28px pill of the desk, no edge; picked, the selected grey and a tick', () => {
    // Round 3 drew Offene Punkte's filter chips as the press: „Für Sie“ read as a command beside „Protokoll exportieren“.
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
    expect(group).toMatch(/default: 'bg-sheet shadow-xs'/)
    // The pill is mounted for the active item of a segmented group only, whose root draws the track.
    expect(group).toMatch(/const isActive =\s*context\.segmented &&/)
    expect(source('ui/components/shell/section-nav.tsx')).toMatch(/onTrack \? 'bg-sheet shadow-xs' : 'bg-selected'/)
  })
  it('a folder is a sheet that opens: 56px, radius 10, elevation 1, a chevron at its end', () => {
    expect(source('ui/features/documents/components/folder-card-frame.tsx')).toMatch(/FOLDER_SHEET = 'rounded-surface bg-sheet shadow-sm'/)
    const tile = source('ui/features/documents/components/folder-navigation.tsx')
    expect(tile).toMatch(/<FileTileBody className="flex min-h-14 /)
    expect(tile).toMatch(/<ChevronRight[^>]*data-slot="folder-opens"/)
  })
  it('Dateien draws neither look itself: no shadow-xs or shadow-press outside the kit, no fill over a press', () => {
    // A surface that wants a press takes `<Button variant="secondary">` and leaves its fill alone (the address's
    // „Als Kontakt sichern“ kept a grey override from the tonal days and was the one grey press on its sheet).
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
  // Paper on a desk, principle 7, round 3: on Offene Punkte six of seven markers wore an ochre ring (the author's
  // identity hue), so ochre meant „is a point“. Now the ring is ink, and ochre only where the point needs the reader.
  it('Offene Punkte rings its points by verdict: ink, ochre only for the reader’s or an overdue one', () => {
    expect(source('ui/features/documents/components/open-points/open-points-panel.tsx')).toMatch(/<MarkRowContent[^>]*marker="verdict"/)
    const row = source('ui/features/documents/components/review/mark-row.tsx')
    expect(row).toMatch(/const VERDICT_RING = \{ ink: 'var\(--foreground\)', needsYou: 'var\(--text-color-feedback-warning\)' \} as const/)
    // A verdict pin is a small sheet in both themes (round 3: a fixed white face, the brightest thing on a dark page);
    // ink at 1.5px, ochre at 2px.
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
    // A dot keys a bar only in its legend (`ReadStateLegend`), as a chart's legend does.
    expect(brief.match(/<ToneSwatch\b/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })
})

describe('one primary per area', () => {
  // An area is a pane (the list column, the reader, the preview's rail, a dialog). A floating batch bar replaces its
  // pane's primary while it is shown, and while mails are picked the reader's primary steps back to the raised press,
  // so the screen never shows two ink buttons (round 2: the batch bar's and the reader's).
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
    // One meta line at desk width (`max-sm:hidden`), the phone's lines (`sm:hidden`) apart.
    const descriptions = [...bin.matchAll(/<ItemDescription (?:key=\{index\} )?className="([^"]*)"/g)].map(([, classes]) => classes)
    expect(descriptions.filter((classes) => !/(?<![\w-])sm:hidden\b/.test(classes))).toHaveLength(1)
    // Every row offers the same action, so at rest it is a ghost glyph and the labelled press comes under the pointer
    // and on focus (round 3: a column of five „Wiederherstellen“); a coarse pointer keeps the 44px glyph.
    expect(bin).toMatch(/variant="secondary"\s+size="sm"\s+className=\{RESTORE_PRESS\}/)
    expect(bin).toMatch(/const RESTORE_PRESS =\s*'pointer-coarse:size-11 pointer-coarse:px-0 pointer-fine:w-8 /)
    expect(bin).toMatch(/<span className="sr-only pointer-fine:group-hover\/row:not-sr-only pointer-fine:group-focus-within\/row:not-sr-only">\{t\('bin\.restore'\)\}<\/span>/)
    // 880px of text at most; on a phone two fixed meta lines that break only between clauses.
    expect(bin).toMatch(/<ul className="-mx-4 flex max-w-\[calc\(880px\+2rem\)\] flex-col">/)
    expect(bin).toMatch(/meta\.phone\.map\(\(line, index\) => \(\s*<ItemDescription key=\{index\} className="text-meta truncate first-letter:uppercase sm:hidden"/)
    // 56px: 10px around a 20px name and a 16px meta line, in the bin, the mail list and Offene Punkte alike.
    expect(bin).toMatch(/group\/row items-center gap-3 rounded-surface py-2\.5 /)
    expect(source('ui/features/inbound-mail/components/inbound-mail-row.tsx')).toMatch(/'group\/row items-start rounded-control px-3 py-2\.5 /)
    expect(source('ui/features/documents/components/review/mark-row.tsx')).toMatch(/'flex w-full gap-3 rounded-control px-2\.5 py-2\.5 /)
  })
  it('a mail subject’s weight is its state: 600 needs the reader, 500 waits on a press, 440 is handled', () => {
    expect(source('ui/features/inbound-mail/components/inbound-mail-row.tsx')).toMatch(
      /needsReader \? 'text-foreground font-semibold' : waiting \? 'text-foreground font-medium' : 'text-foreground font-normal'/
    )
    // A row's name is `text-name` (13/20) in every list: the mail list's 14px subject was the one name of its own size.
    expect(source('ui/features/inbound-mail/components/inbound-mail-row.tsx')).toMatch(/line-clamp-2 text-name text-pretty/)
  })
  it('a thread’s press sits in a 40px line with 8px under it, so it never touches the open row’s sheet', () => {
    // Round 2 and 3: the line was as tall as the press, and „Als Fassung 4–6 ablegen“ sat on the open row's top edge.
    expect(source('ui/features/inbound-mail/components/inbound-mail-list.tsx')).toMatch(/className="box-content flex h-10 items-center justify-between gap-2 px-4 pb-2 pointer-coarse:h-11"/)
  })
  it('the reader’s foot says what one press files only once the choice it repeats has scrolled away', () => {
    const bar = source('ui/features/inbound-mail/components/decision-bar.tsx')
    expect(bar).toMatch(/choiceInView && 'hidden'/)
    // While a batch bar is up its „Verwerfen“ is the one on screen.
    expect(bar).toMatch(/\{!onlyDismiss && !\(yieldPrimary && !impersonation\) && \(/)
    expect(source('ui/features/inbound-mail/components/inbound-mail-detail.tsx')).toMatch(/<section ref=\{choiceRef\}/)
    // The „Wartet“ notice is a measure, not the reader's width.
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
  it('on a phone a folder is a 48px sheet in two columns, and Hochladen a 56px glyph', () => {
    const tile = source('ui/features/documents/components/folder-navigation.tsx')
    expect(tile).not.toMatch(/FOLDER_ROWS_ON_PHONE/)
    expect(tile).toMatch(/phone:min-h-12 phone:gap-2\.5 phone:py-1\.5/)
    expect(source('ui/features/documents/components/upload-fab.tsx')).toMatch(/\[&_button\]:size-14 \[&_button\]:rounded-full/)
    expect(source('ui/features/documents/components/file-workspace.tsx')).toMatch(/glyphOnly: true/)
  })
  it('Offene Punkte keeps its text to a measure and stands who and by when on the column’s edge', () => {
    expect(source('ui/features/documents/components/open-points/open-points-panel.tsx')).toMatch(/<MarkRowContent[^>]*\bcolumns\b/)
    const row = source('ui/features/documents/components/review/mark-row.tsx')
    expect(row).toMatch(/columns && 'max-w-\[720px\]'/)
    expect(row).toMatch(/text-muted-foreground ml-auto hidden shrink-0 items-start gap-4/)
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
  // The edge is a ring drawn 1px outside the sheet (`--elevation-1`). A clip on anything around the
  // tile's thumbnail cut it to the four corners, which then stood out as peaks (owner, 2026-11-10).
  it('nothing between the file card and its thumbnail sheet clips', () => {
    const card = withoutComments(readFileSync(join(ROOT, 'ui/features/documents/components/file-card.tsx'), 'utf8'))
    const button = card.match(/className=\{cn\("group relative flex w-full min-w-0 flex-col[^"]*"/)?.[0] ?? ''
    expect(button, 'the card button').toContain('overflow-visible')
    expect(button).not.toContain('overflow-hidden')
    expect(card).toMatch(/<FileTileBody className=\{cn\('overflow-visible p-0'/)
  })
})

describe('a sheet keeps its edge on a filled section', () => {
  // The mail reader's sheet starts at the top of a `fill` section, whose clip cut its ring (2026-11-10).
  it('the fill frame leaves 1px above its content for a sheet ring', () => {
    const frame = withoutComments(readFileSync(join(ROOT, 'ui/components/shell/project-section-frame.tsx'), 'utf8'))
    expect(frame).toContain("fill ? 'overflow-hidden pt-px'")
  })
})
