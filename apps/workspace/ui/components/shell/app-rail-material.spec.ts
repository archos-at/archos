// @disk-inputs: ui/components/shell/*.tsx, ui/components/shell/*.ts, ui/components/ui/sidebar.tsx, ui/features/layout/components/ChatProjectContext.tsx
/**
 * The app rail's material (docs/design/design-language.md, „The app rail“): the
 * rail is the desk beside the page (Paper on a desk). Two things on it are
 * white: the project selector, a press, and where the reader is, a sheet. Every
 * other fill is one step down the ladder from the plane it lies on.
 *
 * Two versions failed before this one. Until 2026-11-06 hairlines cut the rail
 * into four bands and a green „Verbunden“ dot said all day that nothing was
 * wrong. The version after it banned every edge and shadow, so the current
 * section was a pale patch at 1.08:1, the labels were muted at weight 440, and
 * the project selector was a 24px tile of initials beside a name wrapped on two
 * lines: nothing on the band read as a control or as a place.
 *
 * Read from disk rather than rendered, because the defect is a class a person
 * adds without noticing what it does to the whole: one `border-t` to „tidy“ a
 * group, one more white box. Each exception names its function.
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
  'ui/components/shell/project-crumb.tsx',
  'ui/components/shell/phone-project-list.tsx',
  'ui/components/shell/phone-more-sheet.tsx',
  'ui/components/shell/sidebar-user-menu.tsx',
  'ui/components/shell/connection-band.tsx',
  'ui/components/shell/connection-presence-indicator.tsx',
  'ui/components/shell/phone-tab-bar.tsx',
  'ui/components/shell/org-header.tsx',
  'ui/components/shell/shell-count.ts',
  'ui/components/ui/sidebar.tsx',
] as const

/** Rules that carry a function, by file, each with its reason. */
const RULES_ALLOWED: Record<string, { pattern: RegExp; reason: string }[]> = {
  // Paper bar on paper page above a project: the rule is the only edge between the scrolling
  // page and the fixed bar. Inside a project the bar is the desk and draws none.
  'ui/components/shell/phone-tab-bar.tsx': [{ pattern: /'border-border bg-background border-t'/, reason: 'paper on paper' }],
}

/**
 * The white things, by file: each is `bg-sheet` with the one shadow its shape takes (Paper on a
 * desk, principle 4). The project selector in the rail is the kit's `variant="secondary"` and
 * writes no fill of its own.
 */
const WHITE_ALLOWED: Record<string, { fill: RegExp; what: string }[]> = {
  'ui/components/shell/app-sidebar.tsx': [{ fill: /bg-sheet absolute inset-0 rounded-control shadow-xs/, what: 'the current section: a sheet with the thumb’s shadow' }],
  'ui/components/shell/phone-tab-bar.tsx': [{ fill: /in-data-\[scope=project\]:bg-sheet in-data-\[scope=project\]:shadow-xs/, what: 'the current tab: the same sheet' }],
  'ui/components/shell/phone-more-sheet.tsx': [{ fill: /bg-sheet shadow-press/, what: 'the phone’s project selector, the first row of „Mehr“: a press' }],
  // The primitive's own active fill, which the rail's row turns off in favour of the gliding sheet.
  'ui/components/ui/sidebar.tsx': [{ fill: /data-\[active=true\]:bg-sheet/, what: 'the primitive’s active row' }],
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
  it('draws no rule between its parts, under its header or along its edge, in either theme', () => {
    const offenders = RAIL_FILES.filter((file) => /(?<![\w-:])(dark:)?border-[tbrl](?![\w-])|\bdivide-[xy]\b|<Separator\b|bg-border [^'"]*\bw-px\b/.test(source(file)))
    expect(offenders).toEqual([])
  })

  it('keeps white for two things: the project selector (a press) and where the reader is (a sheet)', () => {
    const offenders = RAIL_FILES.filter((file) => {
      let text = source(file)
      for (const { fill } of WHITE_ALLOWED[file] ?? []) {
        if (!fill.test(text)) return true
        text = text.replace(fill, '')
      }
      return /\bbg-(sheet|card|white|popover)\b|\bshadow-(xs|sm|md|lg|raised|press)\b/.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('names the plane of every fill: the desk, the picked grey or the pressed grey, never „the grey“ or a step of one', () => {
    const offenders = RAIL_FILES.filter((file) =>
      /\bbg-(muted|accent|secondary|surface-sunken|on-sunken|mark-on-sunken)\b|\bbg-[a-z-]+\/\d+|\btext-(foreground|sidebar-foreground|muted-foreground)\/\d+/.test(source(file))
    )
    expect(offenders).toEqual([])
  })

  it('sets the project selector as one press with the name on one line', () => {
    const rail = source('ui/components/shell/project-switcher.tsx')
    const phone = source('ui/components/shell/phone-more-sheet.tsx')
    // The kit's press, not a hand-rolled box, and the name through the atom that cuts a middle.
    expect(rail).toMatch(/<Button[\s\S]*?variant="secondary"[\s\S]*?data-project-selector=""/)
    expect(rail).toMatch(/<MiddleTruncate text=\{name\}/)
    expect(phone).toMatch(/data-project-selector=""[\s\S]*?<MiddleTruncate text=\{projectName\}[^>]*text-section/)
    for (const text of [rail, phone]) expect(text).not.toMatch(/line-clamp|whitespace-normal|text-pretty/)
    // Initials stand in the icon rail's tile and nowhere else: not beside a name.
    const withInitials = RAIL_FILES.filter((file) => /projectInitials|ProjectMark/.test(source(file)))
    expect(withInitials).toEqual(['ui/components/shell/project-switcher.tsx'])
  })

  it('on a phone, keeps the project selector in „Mehr“: the top band and the chat’s context row name the project and open nothing', () => {
    const band = source('ui/components/shell/app-sidebar.tsx')
    const chat = withoutComments(readFileSync(join(ROOT, 'ui/features/layout/components/ChatProjectContext.tsx'), 'utf8'))
    const crumb = source('ui/components/shell/project-crumb.tsx')
    for (const text of [band, chat]) {
      // The name is the quiet line, and nothing in either place opens a project list.
      expect(text).toMatch(/<ProjectCrumb\b/)
      expect(text).not.toMatch(/ProjectPill|PhoneProjectList|data-project-selector|setMoreSheetOpen|projectSwitcher\.switch/)
    }
    // A line of text, not a control: muted, the name's 13/20/500, one line cut in the middle.
    expect(crumb).toMatch(/text-muted-foreground text-name/)
    expect(crumb).toMatch(/<MiddleTruncate\b/)
    expect(crumb).not.toMatch(/<button|onClick|role=|aria-haspopup|bg-sheet|shadow-/)
    // The band is the search glyph's 44px, not the 56px that stood round the press.
    expect(band).toMatch(/flex min-h-11 items-center gap-1 pl-\[max/)
    expect(band).not.toMatch(/min-h-14/)
    // The list has one door on a phone.
    const doors = RAIL_FILES.filter((file) => /<PhoneProjectList\b/.test(source(file)))
    expect(doors).toEqual(['ui/components/shell/phone-more-sheet.tsx'])
  })

  it('sets a row in ink at 500 and where the reader is at 600, never muted at 440', () => {
    const rail = source('ui/components/shell/app-sidebar.tsx')
    expect(rail).toMatch(/'text-foreground h-9 [^']*text-sm font-medium/)
    expect(rail).toMatch(/font-semibold data-\[active=true\]:font-semibold/)
  })

  it('sets its labels at 12px or larger: no 10.5px or 11px fine print', () => {
    const offenders = RAIL_FILES.filter((file) => /\btext-\[(10|10\.5|11|11\.5)px\]/.test(source(file)))
    expect(offenders).toEqual([])
  })
})
