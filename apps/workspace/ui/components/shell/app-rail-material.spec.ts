// @disk-inputs: ui/components/shell/*.tsx, ui/components/shell/*.ts, ui/components/ui/sidebar.tsx, ui/features/layout/components/ChatConnectionLine.tsx, ui/features/layout/components/ChatToolbar.tsx
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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')

/** The rail, its phone shapes and the shell chrome beside them. */
const RAIL_FILES = [
  'ui/components/shell/app-sidebar.tsx',
  'ui/components/shell/sidebar-brand.tsx',
  'ui/components/shell/project-switcher.tsx',
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
  // The rail's one edge, to the page (owner decision 2026-11-11): the desk's 1.08:1 step alone left the rail without an end.
  'ui/components/ui/sidebar.tsx': [{ pattern: /'group-data-\[side=left\]:border-r group-data-\[side=right\]:border-l border-sidebar-border'/, reason: 'the rail’s edge to the page' }],
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
  it('draws no rule between its parts or under its header, and one hairline along the page’s edge', () => {
    expect(readFileSync(join(ROOT, 'ui/components/ui/sidebar.tsx'), 'utf8')).toMatch(RULES_ALLOWED['ui/components/ui/sidebar.tsx'][0].pattern)
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

  it('on a phone, names the project in „Mehr“ and nowhere above a page: no band, no crumb, no line over the chat', () => {
    const band = source('ui/components/shell/app-sidebar.tsx')
    const frame = source('ui/components/shell/project-section-frame.tsx')
    const chatLine = withoutComments(readFileSync(join(ROOT, 'ui/features/layout/components/ChatConnectionLine.tsx'), 'utf8'))
    const chat = withoutComments(readFileSync(join(ROOT, 'ui/features/layout/components/ChatToolbar.tsx'), 'utf8'))
    // The shell's top, the chat's toolbar and its line never read a project's name, and open no project list.
    for (const text of [band, chat, chatLine]) {
      expect(text).not.toMatch(/\bprojectName\b|\bactiveProject\b|project\.name|projects\.find|ProjectCrumb|ProjectPill|PhoneProjectList|data-project-selector|projectSwitcher\.switch/)
    }
    // The page's header shows the project only in Dateien's crumb, and that crumb is the desk's alone.
    // Once as the crumb's text and once as its title: cut on a deep path, the whole name stays in reach.
    expect(frame.match(/\{projectName\}/g)).toHaveLength(2)
    expect(frame).toMatch(/<span className="[^"]*\btruncate\b[^"]*" title=\{projectName\}>\{projectName\}<\/span>/)
    // At desk width only, but for a phone's way inside a folder (`place.phoneTrail`), which names no project.
    expect(frame).toMatch(/crumbClassName=\{phone \? 'text-\[13px\] leading-5' : 'max-md:hidden'\}/)
    expect(frame).not.toMatch(/ProjectCrumb|MiddleTruncate|PhoneProjectList|data-project-selector/)
    // The title's line holds what a phone's top holds: one way back, and the app's search (not beside a page's own).
    // Inside a folder of Alle Dateien the way back is the folder's way up; elsewhere the page's link.
    expect(frame).toMatch(/titleStart=\{\s*place \? \([\s\S]*?\) : back && \(\s*<Link/)
    expect(frame.match(/<ShellSearchButton\b/g)).toHaveLength(1)
    expect(frame).toMatch(/\{!ownSearch && <ShellSearchButton className="-mr-2\.5 md:hidden" \/>\}/)
    // The shell draws a line of its own only where the page has no header (a bare flow): a way back and the search.
    expect(band).toMatch(/\{!pageHasHeader && \(\s*<div data-slot="phone-bare-line"/)
    expect(band.match(/<ShellSearchButton\b/g)).toHaveLength(1)
    expect(band).not.toMatch(/min-h-14/)
    // Dateien has no second way back: its places are tabs, and an opened mail hands the header its own.
    expect(source('ui/components/shell/phone-tabs.ts')).not.toMatch(/\/files\/`\)\) return/)
    // The list has one door on a phone, and the atom that drew the name at the top is gone.
    const doors = RAIL_FILES.filter((file) => /<PhoneProjectList\b/.test(source(file)))
    expect(doors).toEqual(['ui/components/shell/phone-more-sheet.tsx'])
    expect(existsSync(join(ROOT, 'ui/components/shell/project-crumb.tsx'))).toBe(false)
  })

  it('sets a row at 13px, muted at 440 at rest and ink at 500 where the reader is: never 14px or 600', () => {
    // Owner decision 2026-11-11: 14px rows in ink at 500, the current one at 600, read as too large and too heavy.
    const rail = source('ui/components/shell/app-sidebar.tsx')
    expect(rail).toMatch(/'text-muted-foreground h-9 [^']*text-\[13px\] font-normal/)
    expect(rail).toMatch(/font-medium data-\[active=true\]:font-medium/)
    for (const file of ['ui/components/shell/app-sidebar.tsx', 'ui/components/shell/rail-chats.tsx']) expect(source(file)).not.toMatch(/\bfont-semibold\b/)
    // The selector's name too; 600 stays only on the icon rail's initials, the one place no name fits.
    expect(source('ui/components/shell/project-switcher.tsx').match(/\bfont-semibold\b/g)).toHaveLength(1)
    expect(source('ui/components/shell/project-switcher.tsx')).toMatch(/<MiddleTruncate text=\{name\}[^>]*text-\[13px\] font-medium/)
    expect(source('ui/components/shell/rail-chats.tsx')).not.toMatch(/\btext-(sm|name)\b/)
  })

  it('lists the last chats under the sections as the one part that scrolls, between two parts that stand still', () => {
    const rail = source('ui/components/shell/app-sidebar.tsx')
    const chats = source('ui/components/shell/rail-chats.tsx')
    // A list of its own after the sections' nav, not rows nested under „Chat“.
    expect(rail).toMatch(/<SidebarMenu className="gap-0\.5">\{projectItems\.map\(railItem\)\}<\/SidebarMenu>[\s\S]*?<RailChatList /)
    expect(chats).toMatch(/\{t\('recentChats'\)\}/)
    expect(chats).toMatch(/<ul [^>]*className="[^"]*\boverflow-y-auto\b/)
    // A scroll box clips on every side, and the current row's edge is a 1px ring outside it: the list keeps 1px of its
    // own all round (`p-px`, given back by `-mx-px`), or the sheet loses its edge at the left and right (2026-11-11).
    expect(chats).toMatch(/<ul [^>]*className="(?=[^"]*(?<![\w-])-mx-px\b)(?=[^"]*(?<![\w-])p-px\b)[^"]*\boverflow-y-auto\b/)
    // The box round the sections does not scroll, so the office's doorways at the foot stay put.
    expect(rail).toMatch(/'mt-3 min-h-0 flex-1 gap-0 overflow-hidden'/)
  })

  it('sets its labels at 12px or larger: no 10.5px or 11px fine print', () => {
    const offenders = RAIL_FILES.filter((file) => /\btext-\[(10|10\.5|11|11\.5)px\]/.test(source(file)))
    expect(offenders).toEqual([])
  })
})
