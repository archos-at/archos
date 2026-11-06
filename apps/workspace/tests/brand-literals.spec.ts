// @disk-inputs: app/**, ui/**, shared/**
/**
 * The brand rules the workspace keeps at its own level (docs/design/design-language.md,
 * "Type ramp" and "Weight and white"): nothing but the wordmark is set in capitals,
 * content is weight 500, a surface is never pure white, and the chart palette is typed
 * in one file. Each rule is a ratchet: the allowlists below name
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

/** Files that may set weight 600: the wordmark, and numerals or initials at 12px or smaller inside a badge, marker, count or avatar. */
const SEMIBOLD_ALLOWED = new Set([
  'ui/components/brand/logo.tsx',
  'ui/components/ui/live-cursor.tsx',
  'ui/components/ui/comment-pin.tsx',
  'ui/components/ui/count-pill.tsx',
  'ui/components/ui/avatar-stack.tsx',
  'ui/components/ui/stepper.tsx',
  'ui/features/platform/components/norm-entry-editor.tsx',
  'ui/features/chat/components/MessageAuthor.tsx',
  'ui/features/chat/components/CitationMarker.tsx',
  'ui/features/chat/components/source-preview/citation-face.tsx',
  'ui/features/chat/components/source-preview/locus-rail.tsx',
  'ui/features/chat/components/FileReferencePeek.tsx',
  'ui/features/chat/components/reasoning/BranchOptions.tsx',
  'ui/features/project-intake/components/reading/reading-milestone-card.tsx',
  'ui/features/project-intake/components/setup-frame.tsx',
  'ui/features/documents/components/revision-compare/compare-atoms.tsx',
  'ui/features/documents/components/revision-compare/revision-compare.tsx',
  'ui/features/documents/components/file-card.tsx',
  'shared/components/MarkdownRenderer/answer-atoms.tsx',
])

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

describe('weight', () => {
  it('600 and 700 stay in the allowlist', () => {
    const offenders = files
      .filter((f) => f.name.endsWith('.tsx') || f.name.endsWith('.ts'))
      .filter((f) => /\bfont-(semibold|bold|extrabold)\b/.test(f.text) && !SEMIBOLD_ALLOWED.has(f.name))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })

  it('the allowlist has no stale entry', () => {
    const stale = [...SEMIBOLD_ALLOWED].filter(
      (name) => !files.some((f) => f.name === name && /\bfont-(semibold|bold)\b/.test(f.text)),
    )
    expect(stale).toEqual([])
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

  it('the stylesheet sets no weight above 500 outside the wordmark face', () => {
    const css = files.filter((f) => f.name.endsWith('.css'))
    const offenders = css.filter((f) => /font-weight:\s*(6|7|8|9)00/.test(f.text) && !/@font-face/.test(f.text))
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
  'ui/features/documents/components/file-card.tsx', // file-format code chip
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

describe('one grey', () => {
  // The design system's one light grey (`--ds-surface-sunken`, the app's `bg-muted`) and the
  // state fill (`bg-accent`, hover and the open row), never a step between them: Dateien and the
  // E-Mail-Eingang wore six alpha greys (/20 to /80) until 2026-11-06. The drawn page sketches of
  // the preview peek are an illustration's shades, not surfaces.
  const GREY_STEPS_ALLOWED = new Set(['ui/features/documents/components/file-preview-peek.tsx'])
  it('Dateien and the E-Mail-Eingang fill with the one grey or the state fill, never a step of either', () => {
    const offenders = files
      .filter((f) => f.name.startsWith('ui/features/documents/') || f.name.startsWith('ui/features/inbound-mail/'))
      .filter((f) => !GREY_STEPS_ALLOWED.has(f.name))
      .filter((f) => /\bbg-(muted|accent|secondary)\/\d+/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})

describe('the secondary press', () => {
  // Owner decision D4 (design-language.md): the app's secondary press is tonal, the one grey on
  // white and white on a grey panel, never the design system's outline. Dateien and the
  // E-Mail-Eingang are held to it; the rest of the app is not yet.
  it('Dateien and the E-Mail-Eingang set no outline button', () => {
    const offenders = files
      .filter((f) => f.name.startsWith('ui/features/documents/') || f.name.startsWith('ui/features/inbound-mail/'))
      .filter((f) => /variant=["{][^>]*?\boutline\b/.test(withoutComments(f.text)) && /<Button|<BusyButton/.test(f.text))
      .filter((f) => /\bvariant=("outline"|\{[^}]*'outline'[^}]*\})/.test(withoutComments(f.text)))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})
