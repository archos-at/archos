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

  it('the browser-chrome colours are the brand surfaces', () => {
    const vars = readFileSync(join(ROOT, 'shared/brand/tokens.vars.css'), 'utf8')
    const light = /:root \{[^}]*--ds-surface: (#[0-9a-f]{6});/.exec(vars)?.[1]
    const dark = /\.dark[^{]*\{[^}]*--ds-surface: (#[0-9a-f]{6});/.exec(vars)?.[1]
    expect(THEME_COLOR).toEqual({ light, dark })
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
    for (const [name, hex] of [['sheet', '#ffffff'], ['paper', '#fafaf9'], ['desk', '#f2f1f0'], ['selected', '#e9e7e4'], ['pressed', '#dedbd7']]) {
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
    for (const step of steps) expect(step).toMatch(/^0 0 0 1px rgb\(15 14 13/)
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
  it('a sheet is white on every surface that draws a document or a floating bar', () => {
    const tile = files.find((f) => f.name === 'ui/features/documents/components/file-tile.tsx')?.text ?? ''
    expect(tile).toMatch(/bg-sheet shadow-sm/)
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
    expect(kit).toMatch(/secondary:\s*'bg-sheet text-foreground shadow-xs hover:bg-desk active:bg-pressed'/)
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
    'file-browser-pane', 'file-workspace', 'folder-navigation', 'file-card', 'file-tile', 'file-grid', 'file-list-view',
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
    expect(files.find((f) => f.name === 'ui/features/inbound-mail/components/inbound-mail-row.tsx')?.text).toContain('after:bg-hairline')
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
    const cell = list.match(/const CELL = 'px-(\d(?:\.\d)?) /)?.[1]
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
  'ui/features/documents/components/folder-bin-panel.tsx#bin-restore-': 'a list row\u2019s one visible action (Paper on a desk, principle 6): a ghost word, the rest behind the ⋯',
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
    expect(kit).toMatch(/rounded-control bg-muted p-0\.5/)
    expect(kit).not.toMatch(/\bbare\b/)
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
  // In the list view a folder's size and date stand in the table's Größe and Hinzugefügt columns, at their widths,
  // so a folder's date is where a file's is (2026-11: it stood inline after „2 Elemente“). Change a column's width
  // and the folder row's together.
  const read = (component: string): string => files.find((f) => f.name === `ui/features/documents/components/${component}.tsx`)?.text ?? ''
  it('the folder row uses the size and date columns’ widths', () => {
    const list = read('file-list-view')
    const size = list.match(/column="size"[\s\S]*?className="hidden (w-\[\d+px\]) @3xl\/filelist:table-cell"/)?.[1]
    const added = list.match(/column="added"[\s\S]*?className="hidden (w-\[\d+px\]) @4xl\/filelist:table-cell"/)?.[1]
    expect(size).toBeDefined()
    expect(added).toBeDefined()
    const row = read('folder-navigation')
    expect(row).toContain(`hidden ${size} shrink-0 px-2 text-right text-xs tabular-nums @3xl/filelist:block`)
    expect(row).toContain(`hidden ${added} shrink-0 px-2 text-right text-xs tabular-nums @4xl/filelist:block`)
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
